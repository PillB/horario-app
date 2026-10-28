/**
 * Statistical demand forecast for every role, run on the client.
 *
 * Input is daily history (shifts worked per date × role, from the
 * `forecastHistory` proxy action), external signals and the dates to forecast.
 * For each role:
 *   1. build a dense daily series from the role's first day to the end of the
 *      history window (days without shifts are 0, including trailing days after
 *      the last recorded shift when `historyEnd` is given), divided by that day's
 *      signal multiplier so past events do not distort the baseline;
 *   2. pick a model by rolling-origin backtest (selection.ts);
 *   3. forecast, multiply by the target day's signal multiplier, and take the
 *      planned headcount at the service-level quantile, rounded up. A weekday that
 *      was 0 in each of its last 4 weeks (CLOSED_WEEKDAY_WEEKS) is forecast 0.
 *
 * Dates are calendar keys ("YYYY-MM-DD") handled with utils/dateKeys.ts only,
 * so the result never depends on the device time zone or DST.
 */
import type { DemandForecast } from '@/services/demandForecast';
import { addDaysToKey, daysBetweenKeys, isDateKey } from '@/utils/dateKeys';

import type { ForecastModelName } from './models';
import {
  DEFAULT_BACKTEST,
  forecastSeries,
  type BacktestConfig,
  type IntervalSource,
  type ModelScore,
} from './selection';

export type HistoryDay = { date: string; role: string; shifts: number };
export type ForecastSignal = { date: string; role?: string | null; signal_type?: string | null; weight?: number | null };

/** Signals with this role apply to every role that has no signal of its own that day. */
export const GLOBAL_SIGNAL_ROLE = 'global';
/** Signal weights outside (0, MAX_SIGNAL_WEIGHT] are ignored. */
export const MAX_SIGNAL_WEIGHT = 10;

export const DEFAULT_SERVICE_LEVEL = 0.8;
export const DEFAULT_INTERVAL_LEVEL = 0.8;

export type StatisticalForecastOptions = {
  serviceLevel?: number;
  intervalLevel?: number;
  backtest?: Partial<BacktestConfig>;
};

export type RoleModelSummary = {
  role: string;
  model: ForecastModelName;
  /** Backtest MASE of the chosen model vs. weekly seasonal naive; null when history was too short. */
  mase: number | null;
  /** Every candidate's backtest MASE. */
  scores: ModelScore[];
  historyDays: number;
  /** Last date with a recorded shift for this role. */
  lastDataDate: string;
  /** Days from `lastDataDate` to the end of the series (0 when the last day has data). */
  historyEndsDaysAgo: number;
  backtestOrigins: number;
  intervalSource: IntervalSource;
  params: Record<string, number>;
};

export type StatisticalForecastResult = {
  forecasts: DemandForecast[];
  models: RoleModelSummary[];
  /** Requested roles with no shift history (no forecast made). */
  rolesWithoutHistory: string[];
  /**
   * Days between the most recent recorded shift (any role) and the end of the history
   * window; null without history. A large value means shifts stopped being logged.
   */
  historyEndsDaysAgo: number | null;
};

const validWeight = (w: unknown): w is number => typeof w === 'number' && Number.isFinite(w) && w > 0 && w <= MAX_SIGNAL_WEIGHT;

/**
 * Demand multiplier for each date × role. Weights are multipliers (1.2 = 20 %
 * more demand); several signals on the same day multiply. A role's own
 * signals take precedence over global ones on the same day.
 */
export function buildSignalMultipliers(signals: readonly ForecastSignal[]): (date: string, role: string) => number {
  const byRole = new Map<string, number>();
  const global = new Map<string, number>();
  for (const s of signals) {
    if (!s || !isDateKey(String(s.date)) || !validWeight(s.weight)) continue;
    const role = typeof s.role === 'string' ? s.role : GLOBAL_SIGNAL_ROLE;
    if (role.toLowerCase() === GLOBAL_SIGNAL_ROLE) {
      global.set(s.date, (global.get(s.date) ?? 1) * s.weight);
    } else {
      const key = `${s.date}::${role}`;
      byRole.set(key, (byRole.get(key) ?? 1) * s.weight);
    }
  }
  return (date, role) => byRole.get(`${date}::${role}`) ?? global.get(date) ?? 1;
}

export type RoleSeries = { role: string; start: string; end: string; lastDataDate: string; values: number[] };

/**
 * Dense daily series per role, ending at `end` (inclusive). Rows on or after
 * `before` (or `historyEnd`) are ignored. Each role starts on its own first day with
 * shifts. With `historyEnd` (exclusive end of the fetched window), every series ends
 * the day before it (or before `before`, whichever is earlier), so days after the last
 * recorded shift count as 0 (CHG-087); without it, the series end at the last date
 * with data.
 */
export function buildRoleSeries(
  history: readonly HistoryDay[],
  multiplier: (date: string, role: string) => number,
  before: string,
  historyEnd?: string,
): RoleSeries[] {
  const cutoff = historyEnd && isDateKey(historyEnd) && historyEnd < before ? historyEnd : before;
  const totals = new Map<string, Map<string, number>>();
  const lastData = new Map<string, string>();
  let end: string | null = null;
  for (const row of history) {
    if (!row || !isDateKey(String(row.date)) || typeof row.role !== 'string' || !row.role) continue;
    if (row.date >= cutoff) continue;
    const count = Number(row.shifts);
    if (!Number.isFinite(count) || count < 0) continue;
    let days = totals.get(row.role);
    if (!days) totals.set(row.role, (days = new Map()));
    days.set(row.date, (days.get(row.date) ?? 0) + count);
    if (end === null || row.date > end) end = row.date;
    const seen = lastData.get(row.role);
    if (seen === undefined || row.date > seen) lastData.set(row.role, row.date);
  }
  if (end === null) return [];
  if (historyEnd && isDateKey(historyEnd)) end = addDaysToKey(cutoff, -1);
  const starts = new Map([...totals].map(([role, days]) => [role, [...days.keys()].reduce((a, b) => (a < b ? a : b))]));
  const first = [...starts.values()].reduce((a, b) => (a < b ? a : b));
  // Every calendar day once, shared by all roles.
  const calendar = Array.from({ length: daysBetweenKeys(first, end) + 1 }, (_, i) => addDaysToKey(first, i));
  const out: RoleSeries[] = [];
  for (const [role, days] of totals) {
    const start = starts.get(role)!;
    const offset = daysBetweenKeys(first, start);
    const values = new Array<number>(calendar.length - offset);
    for (let i = 0; i < values.length; i += 1) {
      const date = calendar[offset + i];
      values[i] = (days.get(date) ?? 0) / multiplier(date, role);
    }
    out.push({ role, start, end, lastDataDate: lastData.get(role)!, values });
  }
  return out.sort((a, b) => a.role.localeCompare(b.role));
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export type StatisticalForecastInput = {
  history: readonly HistoryDay[];
  signals?: readonly ForecastSignal[];
  targetDates: readonly string[];
  /** Roles to forecast; default every role in the history. */
  roles?: readonly string[];
  /**
   * Exclusive end of the history window that was fetched. Days in the window after the
   * last recorded shift count as 0 demand. Without it the series end at the last date
   * with data.
   */
  historyEnd?: string;
};

type Plan = {
  targets: string[];
  multiplier: (date: string, role: string) => number;
  series: Map<string, RoleSeries>;
  roles: string[];
  serviceLevel: number;
  intervalLevel: number;
  cfg: BacktestConfig;
};

function plan(input: StatisticalForecastInput, options: StatisticalForecastOptions): Plan {
  const targets = Array.from(new Set(input.targetDates.filter(isDateKey))).sort();
  const multiplier = buildSignalMultipliers(input.signals ?? []);
  const series = new Map(
    (targets.length ? buildRoleSeries(input.history, multiplier, targets[0], input.historyEnd) : []).map(
      (r) => [r.role, r] as const,
    ),
  );
  return {
    targets,
    multiplier,
    series,
    roles: targets.length ? (input.roles?.length ? Array.from(new Set(input.roles)) : [...series.keys()]) : [],
    serviceLevel: clampLevel(options.serviceLevel ?? DEFAULT_SERVICE_LEVEL),
    intervalLevel: clampLevel(options.intervalLevel ?? DEFAULT_INTERVAL_LEVEL),
    cfg: { ...DEFAULT_BACKTEST, ...options.backtest },
  };
}

/** Fits and forecasts one role, adding to `result`. */
function forecastRole(pl: Plan, role: string, result: StatisticalForecastResult): void {
  const s = pl.series.get(role);
  if (!s) {
    result.rolesWithoutHistory.push(role);
    return;
  }
  const { serviceLevel, intervalLevel } = pl;
  const horizons = pl.targets.map((d) => daysBetweenKeys(s.end, d));
  const fc = forecastSeries(s.values, horizons, { serviceLevel, intervalLevel, backtest: pl.cfg });
  result.models.push({
    role,
    model: fc.model,
    mase: fc.mase === null ? null : round(fc.mase, 3),
    scores: fc.scores.map((x) => ({ model: x.model, mase: round(x.mase, 3) })),
    historyDays: s.values.length,
    lastDataDate: s.lastDataDate,
    historyEndsDaysAgo: daysBetweenKeys(s.lastDataDate, s.end),
    backtestOrigins: fc.backtestOrigins,
    intervalSource: fc.intervalSource,
    params: fc.params,
  });
  fc.points.forEach((p, i) => {
    const date = pl.targets[i];
    const m = pl.multiplier(date, role);
    const forecast: DemandForecast = {
      date,
      role,
      // Rounded first so 3.0000000001 plans for 3, not 4.
      required: Math.max(0, Math.ceil(round(p.atServiceLevel * m, 6))),
      expected: round(p.expected * m, 2),
      serviceLevel,
      model: fc.model,
      source: 'model',
    };
    if (fc.mase !== null) forecast.mase = round(fc.mase, 3);
    if (p.lower !== null && p.upper !== null) {
      forecast.lowerBound = round(p.lower * m, 1);
      forecast.upperBound = round(p.upper * m, 1);
      forecast.intervalLevel = intervalLevel;
    }
    if (m !== 1) forecast.signalMultiplier = round(m, 4);
    result.forecasts.push(forecast);
  });
}

const sortForecasts = (result: StatisticalForecastResult) => {
  result.forecasts.sort((a, b) => (a.date === b.date ? a.role.localeCompare(b.role) : a.date < b.date ? -1 : 1));
  result.historyEndsDaysAgo = result.models.length
    ? Math.min(...result.models.map((m) => m.historyEndsDaysAgo))
    : null;
  return result;
};

const emptyResult = (): StatisticalForecastResult => ({
  forecasts: [],
  models: [],
  rolesWithoutHistory: [],
  historyEndsDaysAgo: null,
});

/**
 * Forecasts `targetDates` for each role. Only history before the earliest
 * target date (and before `historyEnd`) is used; the horizon of each target is
 * counted from the end of the series.
 */
export function statisticalForecast(
  input: StatisticalForecastInput,
  options: StatisticalForecastOptions = {},
): StatisticalForecastResult {
  const pl = plan(input, options);
  const result = emptyResult();
  for (const role of pl.roles) forecastRole(pl, role, result);
  return sortForecasts(result);
}

/** Yields to the event loop so input and rendering can run between roles. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Same result as `statisticalForecast`, one role per task: the fit for 2
 * years × 5 roles takes tens of milliseconds, and splitting it per role keeps
 * each task short enough not to freeze input on a slow phone.
 */
export async function statisticalForecastAsync(
  input: StatisticalForecastInput,
  options: StatisticalForecastOptions = {},
  pause: () => Promise<void> = yieldToEventLoop,
): Promise<StatisticalForecastResult> {
  const pl = plan(input, options);
  const result = emptyResult();
  for (const role of pl.roles) {
    await pause();
    forecastRole(pl, role, result);
  }
  return sortForecasts(result);
}

/** Levels are kept within [0.5, 0.99]: below 0.5 would plan under the median. */
function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(0.99, Math.max(0.5, level)) : DEFAULT_SERVICE_LEVEL;
}
