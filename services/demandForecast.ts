/**
 * Demand forecast service.
 *
 * With EXPO_PUBLIC_FORECAST_API_URL set, the secure proxy's `forecast` action
 * calls that external API first. Otherwise (or when it fails or returns
 * nothing) the forecast is fitted here on the client by the statistical
 * engine in services/forecasting/: the proxy only returns history
 * (`forecastHistory`, `listForecastSignals`), because hosting allows 10 ms of
 * CPU per request.
 */
import { getSessionToken } from '@/services/authToken';
import type { ForecastModelName } from '@/services/forecasting/models';
import {
  DEFAULT_INTERVAL_LEVEL,
  DEFAULT_SERVICE_LEVEL,
  statisticalForecastAsync,
  type ForecastSignal,
  type HistoryDay,
  type RoleModelSummary,
} from '@/services/forecasting/statisticalForecast';
import { getDeviceTimeZone } from '@/utils/businessTimeZone';
import { addDaysToKey, isDateKey, todayKey } from '@/utils/dateKeys';

export type DemandForecast = {
  date: string;
  role: string;
  /**
   * Staff to plan for. For a statistical forecast this is the forecast at
   * `serviceLevel` (e.g. the 80th percentile), rounded up, not the mean.
   */
  required: number;
  notes?: string;
  confidence?: number;
  /** Prediction interval (`intervalLevel` central coverage) for statistical forecasts. */
  lowerBound?: number;
  upperBound?: number;
  source?: 'model' | 'override';
  /** Statistical forecasts only: the mean forecast, before planning for uncertainty. */
  expected?: number;
  /** Quantile `required` is taken at, e.g. 0.8. */
  serviceLevel?: number;
  /** Central coverage of [lowerBound, upperBound], e.g. 0.8. */
  intervalLevel?: number;
  /** Model chosen for this role by backtesting. */
  model?: ForecastModelName;
  /** Backtest MASE of that model vs. weekly seasonal naive (below 1 is better). */
  mase?: number;
  /** Product of the external-signal multipliers for this date and role, when not 1. */
  signalMultiplier?: number;
};

export type ForecastFilters = {
  date?: string;
  role?: string;
};

export type ForecastDataStatus = {
  hasHistorical: boolean;
  hasExternalSignals: boolean;
  hasExistingTargets: boolean;
  apiAvailable: boolean;
};

export type ForecastGenerationMetadata = ForecastDataStatus & {
  usedApi: boolean;
  usedFallback: boolean;
  apiCallFailed: boolean;
  fallbackReason?: string;
  /** How the forecasts were made: external API, client-side statistics, or not at all. */
  method?: 'api' | 'statistical' | 'none';
  /** Statistical forecasts: the model chosen per role and its backtest accuracy. */
  models?: RoleModelSummary[];
  serviceLevel?: number;
  intervalLevel?: number;
  /** Milliseconds spent fitting (statistical forecasts). */
  fitMs?: number;
  /** True when the history had more shifts than the client fetches; the oldest were left out. */
  historyTruncated?: boolean;
};

export type ForecastOptions = {
  /** Quantile `required` is planned at (default 0.8). */
  serviceLevel?: number;
  /** Central coverage of [lowerBound, upperBound] (default 0.8). */
  intervalLevel?: number;
  /** IANA zone of the business; "today" and the default horizon use it (default: device zone). */
  timeZone?: string;
  /** Days forecast when no date filter is given (default 14, from today). */
  horizonDays?: number;
};

/** Days of history fitted (2 years). */
export const FORECAST_HISTORY_DAYS = 730;
export const DEFAULT_FORECAST_HORIZON_DAYS = 14;
/** Must match the proxy's FORECAST_HISTORY_MAX_PAGES. */
const MAX_HISTORY_PAGES = 40;
const HISTORY_PAGE_CONCURRENCY = 4;

export type ForecastGenerationResult = {
  forecasts: DemandForecast[];
  metadata: ForecastGenerationMetadata;
};

export type UpsertDemandTargetResult = {
  success: boolean;
  target: DemandForecast;
  error?: string;
};

const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

const DEFAULT_FORECAST_METADATA: ForecastGenerationMetadata = {
  hasHistorical: false,
  hasExternalSignals: false,
  hasExistingTargets: false,
  apiAvailable: Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL),
  usedApi: false,
  usedFallback: true,
  apiCallFailed: true,
  fallbackReason: 'Secure forecasting service unavailable; using local estimates.',
};

const handleSecureFetch = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const token = await getSessionToken();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error?.error ?? `Secure proxy responded with status ${response.status}`);
  }

  return (await response.json()) as T;
};

export const getForecastDataStatus = async (filters?: ForecastFilters): Promise<ForecastDataStatus> => {
  try {
    const status = await handleSecureFetch<ForecastGenerationMetadata>({ action: 'status', filters });
    return {
      hasHistorical: status.hasHistorical,
      hasExternalSignals: status.hasExternalSignals,
      hasExistingTargets: status.hasExistingTargets,
      apiAvailable: status.apiAvailable,
    };
  } catch (error) {
    console.warn('Unable to load forecast data status', error);
    return {
      hasHistorical: DEFAULT_FORECAST_METADATA.hasHistorical,
      hasExternalSignals: DEFAULT_FORECAST_METADATA.hasExternalSignals,
      hasExistingTargets: DEFAULT_FORECAST_METADATA.hasExistingTargets,
      apiAvailable: DEFAULT_FORECAST_METADATA.apiAvailable,
    };
  }
};

type HistoryPage = { days: HistoryDay[]; page: number; pageSize: number; rows: number; total: number | null };

/**
 * Shift history in [from, to) summed per date × role. Pages come newest
 * first; page 0 says how many rows there are and the rest are fetched in
 * parallel. Past MAX_HISTORY_PAGES the oldest shifts are left out, and so is
 * the oldest day fetched, which may be incomplete.
 */
export const fetchForecastHistory = async (
  from: string,
  to: string,
  role?: string,
): Promise<{ days: HistoryDay[]; truncated: boolean }> => {
  const request = (page: number) =>
    handleSecureFetch<HistoryPage>({ action: 'forecastHistory', from, to, role, page });
  const first = await request(0);
  const pageSize = first.pageSize > 0 ? first.pageSize : 1000;
  const total = typeof first.total === 'number' ? first.total : first.rows;
  const pageCount = Math.min(MAX_HISTORY_PAGES, Math.ceil(total / pageSize));
  const pages: HistoryPage[] = [first];
  for (let next = 1; next < pageCount; next += HISTORY_PAGE_CONCURRENCY) {
    const batch = [];
    for (let page = next; page < Math.min(pageCount, next + HISTORY_PAGE_CONCURRENCY); page += 1) batch.push(request(page));
    pages.push(...(await Promise.all(batch)));
  }
  // A day can straddle two pages: add its parts up.
  const merged = new Map<string, HistoryDay>();
  for (const d of pages.flatMap((p) => p.days ?? [])) {
    const key = `${d.date}::${d.role}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, shifts: prev.shifts + d.shifts } : { date: d.date, role: d.role, shifts: d.shifts });
  }
  let days = Array.from(merged.values());
  const truncated = total > pageCount * pageSize;
  if (truncated && days.length) {
    const oldest = days.reduce((min, d) => (d.date < min ? d.date : min), days[0].date);
    days = days.filter((d) => d.date !== oldest);
  }
  return { days, truncated };
};

export const fetchForecastSignals = async (from: string, to: string, role?: string): Promise<ForecastSignal[]> => {
  const result = await handleSecureFetch<{ signals: ForecastSignal[] }>({ action: 'listForecastSignals', from, to, role });
  return result.signals ?? [];
};

const elapsedMs = (start: number) => Math.round((Date.now() - start) * 10) / 10;

/** Fits the statistical forecast on the client from history fetched through the proxy. */
const generateStatisticalForecast = async (
  filters: ForecastFilters | undefined,
  options: ForecastOptions,
  api: { available: boolean; failed: boolean },
): Promise<ForecastGenerationResult> => {
  const timeZone = options.timeZone ?? getDeviceTimeZone();
  const today = todayKey(timeZone);
  const horizon = Math.min(90, Math.max(1, Math.round(options.horizonDays ?? DEFAULT_FORECAST_HORIZON_DAYS)));
  const targetDates =
    filters?.date && isDateKey(filters.date)
      ? [filters.date]
      : Array.from({ length: horizon }, (_, i) => addDaysToKey(today, i));
  // History ends before today (today is not over) and before the first target.
  const end = targetDates[0] < today ? targetDates[0] : today;
  const from = addDaysToKey(end, -FORECAST_HISTORY_DAYS);
  const signalsTo = addDaysToKey(targetDates[targetDates.length - 1], 1);
  const [history, signals] = await Promise.all([
    fetchForecastHistory(from, end, filters?.role),
    fetchForecastSignals(from, signalsTo, filters?.role),
  ]);

  const serviceLevel = options.serviceLevel ?? DEFAULT_SERVICE_LEVEL;
  const intervalLevel = options.intervalLevel ?? DEFAULT_INTERVAL_LEVEL;
  const started = Date.now();
  const result = await statisticalForecastAsync(
    { history: history.days, signals, targetDates, roles: filters?.role ? [filters.role] : undefined },
    { serviceLevel, intervalLevel },
  );
  const fitMs = elapsedMs(started);

  const produced = result.forecasts.length > 0;
  let fallbackReason: string | undefined;
  if (!produced) {
    fallbackReason = filters?.role
      ? `No shift history for ${filters.role} yet; use quick setup or a manual target.`
      : 'No shift history yet; use quick setup or manual targets.';
  } else if (api.available) {
    fallbackReason = api.failed
      ? 'Forecast API request failed; using the statistical forecast.'
      : 'Forecast API returned no data; using the statistical forecast.';
  }
  return {
    forecasts: result.forecasts,
    metadata: {
      hasHistorical: history.days.length > 0,
      hasExternalSignals: signals.length > 0,
      hasExistingTargets: false,
      apiAvailable: api.available,
      usedApi: false,
      usedFallback: fallbackReason !== undefined,
      apiCallFailed: api.failed,
      fallbackReason,
      method: produced ? 'statistical' : 'none',
      models: result.models,
      // The engine clamps levels to [0.5, 0.99]; report what it used.
      serviceLevel: result.forecasts[0]?.serviceLevel ?? serviceLevel,
      intervalLevel: result.forecasts.find((f) => f.intervalLevel !== undefined)?.intervalLevel ?? intervalLevel,
      fitMs,
      historyTruncated: history.truncated,
    },
  };
};

export const generateDemandForecast = async (
  filters?: ForecastFilters,
  options: ForecastOptions = {},
): Promise<ForecastGenerationResult> => {
  // Read at call time so tests can toggle it; Expo inlines it at build time.
  const apiAvailable = Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL);
  let apiFailed = false;
  if (apiAvailable) {
    try {
      const result = await handleSecureFetch<ForecastGenerationResult>({ action: 'forecast', filters });
      if (result.metadata?.usedApi) return { ...result, metadata: { ...result.metadata, method: 'api' } };
      apiFailed = Boolean(result.metadata?.apiCallFailed);
    } catch (error) {
      console.warn('Unable to generate forecast via secure proxy', error);
      apiFailed = true;
    }
  }
  try {
    return await generateStatisticalForecast(filters, options, { available: apiAvailable, failed: apiFailed });
  } catch (error) {
    console.warn('Unable to generate forecast via secure proxy', error);
    return {
      forecasts: [],
      metadata: {
        ...DEFAULT_FORECAST_METADATA,
        apiAvailable,
        method: 'none',
        fallbackReason: 'Secure forecast service unavailable.',
      },
    };
  }
};

export const loadDemandTargets = async (filters?: ForecastFilters): Promise<DemandForecast[]> => {
  try {
    const result = await handleSecureFetch<{ targets: DemandForecast[] }>({ action: 'loadTargets', filters });
    return (result.targets ?? []).filter((target) => target.source === 'override');
  } catch (error) {
    console.warn('Unable to load demand targets from secure proxy', error);
    return [];
  }
};

export const upsertDemandTarget = async (target: DemandForecast): Promise<UpsertDemandTargetResult> => {
  const normalized = { ...target, required: Number(target.required), source: target.source ?? 'override' };
  try {
    const result = await handleSecureFetch<{ success: boolean; targets: DemandForecast[]; error?: string }>({
      action: 'upsertTargets',
      targets: [normalized],
    });

    if (!result.success) {
      const message = result.error ?? 'Unable to save override';
      return { success: false, target: normalized, error: message };
    }

    return { success: true, target: normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save override';
    return { success: false, target: normalized, error: message };
  }
};
