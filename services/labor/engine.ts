/**
 * Labor-rule engine: checks one worker's shifts against a jurisdiction's rule
 * packs and returns findings (violations, premiums, warnings, refusable shifts,
 * items for review) plus an overtime pay breakdown.
 *
 * Conventions (from QA's golden file, qa/labor-rules-golden.md):
 * - Durations are elapsed time between instants; windows ("22:00–06:00") are
 *   read on the location's wall clock in its IANA zone.
 * - "More than N hours" and "at least N hours" are different triggers; each
 *   rule states which (`inclusive`).
 * - Coverage for fair-workweek laws is an input. When it is unknown the engine
 *   asks for review instead of guessing.
 */
import { addDaysToKey, daysBetweenKeys, weekdayOfKey } from '@/utils/dateKeys';
import { parseHHMM, wallClockAt, zonedToUtc } from '@/utils/zonedTime';
import { getJurisdiction, jurisdictionChain } from './jurisdictions';
import { PACKS } from './packs';
import type {
  BreakTrigger,
  DateKey,
  Dated,
  EvaluationContext,
  EvaluationResult,
  Finding,
  Interval,
  LaborShift,
  LaborWorker,
  MinorRule,
  PayBreakdown,
  RulePack,
  ShiftKindLimits,
  TimeWindow,
  Verdict,
} from './types';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const EPS = 1e-9;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Packs ───────────────────────────────────────────────────────────────────

/** Rules for a jurisdiction: its chain merged, the most specific section winning. */
export const resolvePack = (code: string): RulePack => {
  const chain = jurisdictionChain(code);
  if (chain.length === 0) throw new RangeError(`Unknown jurisdiction "${code}"`);
  const merged = chain.reduce<Partial<RulePack>>((acc, c) => {
    const pack = PACKS[c];
    return pack ? { ...acc, ...pack } : acc;
  }, {});
  return { ...merged, code, currency: merged.currency ?? 'USD' } as RulePack;
};

export const resolveDated = <T>(value: Dated<T>, date: DateKey): T => {
  if (!Array.isArray(value) || !value.length || typeof value[0] !== 'object' || value[0] === null || !('from' in (value[0] as object))) {
    return value as T;
  }
  const entries = value as { from: DateKey; value: T }[];
  let current = entries[0].value;
  for (const e of entries) if (e.from <= date) current = e.value;
  return current;
};

// ─── Time helpers ────────────────────────────────────────────────────────────

type Duty = {
  shifts: LaborShift[];
  start: number;
  end: number;
  /** Work intervals (shift spans minus breaks). */
  work: Interval[];
  workedMs: number;
  /** Break pieces: declared breaks plus gaps between merged shifts. */
  breakPieces: number[];
  overtimeHours: number;
  date: DateKey;
};

const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

const subtract = (span: Interval, cuts: Interval[] = []): Interval[] => {
  let pieces: Interval[] = [span];
  for (const c of cuts) {
    pieces = pieces.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const out: Interval[] = [];
      if (c.start > p.start) out.push({ start: p.start, end: c.start });
      if (c.end < p.end) out.push({ start: c.end, end: p.end });
      return out;
    });
  }
  return pieces;
};

/** The local daily window [from, to) as instants on each local day touching the span. */
const windowInstances = (span: Interval, window: TimeWindow, tz: string): Interval[] => {
  const from = parseHHMM(window[0]);
  let to = parseHHMM(window[1]);
  if (to <= from) to += 1440;
  const firstDay = addDaysToKey(wallClockAt(span.start, tz).dateKey, -1);
  const lastDay = wallClockAt(span.end, tz).dateKey;
  const out: Interval[] = [];
  for (let d = firstDay; d <= lastDay; d = addDaysToKey(d, 1)) {
    out.push({ start: zonedToUtc(d, from, tz), end: zonedToUtc(d, to, tz) });
  }
  return out;
};

const msInWindow = (work: Interval[], window: TimeWindow, tz: string): number =>
  work.reduce((sum, w) => sum + windowInstances(w, window, tz).reduce((s, win) => s + overlap(w, win), 0), 0);

const buildDuties = (shifts: LaborShift[], tz: string, mergeGapHours?: number): Duty[] => {
  const sorted = [...shifts].sort((a, b) => a.start - b.start);
  const duties: Duty[] = [];
  for (const s of sorted) {
    const work = subtract({ start: s.start, end: s.end }, s.breaks);
    const workedMs = work.reduce((n, w) => n + (w.end - w.start), 0);
    const breaks = (s.breaks ?? []).map((b) => b.end - b.start);
    const last = duties[duties.length - 1];
    if (last && mergeGapHours !== undefined && s.start - last.end < mergeGapHours * HOUR) {
      last.breakPieces.push(s.start - last.end, ...breaks);
      last.shifts.push(s);
      last.end = Math.max(last.end, s.end);
      last.work.push(...work);
      last.workedMs += workedMs;
      last.overtimeHours += s.overtimeHours ?? 0;
      continue;
    }
    duties.push({
      shifts: [s],
      start: s.start,
      end: s.end,
      work,
      workedMs,
      breakPieces: breaks,
      overtimeHours: s.overtimeHours ?? 0,
      date: wallClockAt(s.start, tz).dateKey,
    });
  }
  return duties;
};

const weekStartOf = (date: DateKey, startsOn: number): DateKey =>
  addDaysToKey(date, -((weekdayOfKey(date) - startsOn + 7) % 7));

const ageOn = (birth: DateKey, date: DateKey): number => {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

/** June 1 through the first Monday of September (US Labor Day). */
const isUsSummer = (date: DateKey): boolean => {
  const year = date.slice(0, 4);
  const sept1 = `${year}-09-01`;
  const laborDay = addDaysToKey(sept1, (8 - weekdayOfKey(sept1)) % 7);
  return date >= `${year}-06-01` && date <= laborDay;
};

const breakTriggerMinutes = (triggers: BreakTrigger[], workedHours: number): number =>
  triggers.reduce((req, t) => {
    const hit = t.inclusive ? workedHours >= t.afterHours - EPS : workedHours > t.afterHours + EPS;
    return hit ? Math.max(req, t.minMinutes) : req;
  }, 0);

// ─── Evaluation ──────────────────────────────────────────────────────────────

type Emit = (f: Omit<Finding, 'jurisdiction' | 'workerId'>) => void;

export function evaluateShifts(ctx: EvaluationContext, worker: LaborWorker, shifts: LaborShift[]): EvaluationResult {
  const pack = resolvePack(ctx.jurisdiction);
  const tz = ctx.timeZone;
  const startsOn = ctx.weekStartsOn ?? 1;
  const findings: Finding[] = [];
  const emit: Emit = (f) => findings.push({ ...f, jurisdiction: pack.code, workerId: worker.id });

  if (pack.baselineOnly) {
    emit({ rule: 'jurisdiction.baseline', verdict: 'review', shiftIds: [], message: pack.baselineOnly });
  }

  const duties = buildDuties(shifts, tz, pack.dutyMergeGapHours);
  const ordinaryByDay = checkDaily(pack, ctx, worker, duties, emit);
  checkRest(pack, ctx, duties, emit);
  checkBreaks(pack, duties, emit);
  checkNight(pack, ctx, worker, duties, emit);
  checkWeekly(pack, ctx, worker, duties, ordinaryByDay, startsOn, emit);
  checkNotice(pack, ctx, worker, duties, emit);
  checkMinors(pack, ctx, worker, duties, startsOn, emit);
  const pay = computeOvertimePay(pack, duties, startsOn, emit);
  if (pack.payByClock) checkPayByClock(duties, tz, emit);

  return { findings, pay };
}

/** Evaluates many workers; shifts are grouped by worker id. */
export function evaluateRoster(
  ctx: EvaluationContext,
  workers: LaborWorker[],
  shiftsByWorker: Record<string, LaborShift[]>,
): Finding[] {
  return workers.flatMap((w) => evaluateShifts(ctx, w, shiftsByWorker[w.id] ?? []).findings);
}

const ids = (d: Duty) => d.shifts.map((s) => s.id);
const workedH = (d: Duty) => d.workedMs / HOUR;

// ─── Daily limits ────────────────────────────────────────────────────────────

const classifyShift = (pack: RulePack, d: Duty, tz: string): keyof ShiftKindLimits => {
  const c = pack.shiftClassification;
  if (!c) return 'day';
  const night = msInWindow(d.work, c.night, tz) / HOUR;
  if (night <= EPS) return 'day';
  if (night >= workedH(d) - EPS) return 'night';
  return night < c.mixedIfNightHoursLt ? 'mixed' : 'night';
};

/** Brazil counts each night hour as 52.5 minutes, so the hours that count toward limits grow. */
const countedHours = (pack: RulePack, d: Duty, tz: string): number => {
  const n = pack.night;
  if (!n?.hourMinutes) return workedH(d);
  const nightMs = msInWindow(d.work, resolveDated(n.window, d.date), tz);
  return (d.workedMs - nightMs) / HOUR + nightMs / MINUTE / n.hourMinutes;
};

/**
 * Daily limits apply to everything worked on one local day (a split shift's
 * two halves add up). Returns ordinary hours per day, for the weekly checks.
 */
function checkDaily(pack: RulePack, ctx: EvaluationContext, worker: LaborWorker, duties: Duty[], emit: Emit): Map<DateKey, number> {
  const byDay = new Map<DateKey, Duty[]>();
  for (const d of duties) byDay.set(d.date, [...(byDay.get(d.date) ?? []), d]);
  const ordinaryByDay = new Map<DateKey, number>();

  for (const [date, day] of byDay) {
    const shiftIds = day.flatMap(ids);
    const total = day.reduce((n, d) => n + countedHours(pack, d, ctx.timeZone), 0);
    const designatedOt = Math.min(day.reduce((n, d) => n + d.overtimeHours, 0), total);
    let ordinary = total - designatedOt;
    let overtime = designatedOt;

    const rule = pack.dailyOrdinaryMax;
    if (rule) {
      const raw = resolveDated(rule.hours, date);
      // Mexico: the limit depends on the shift kind; with several shifts, the strictest applies.
      const kinds = typeof raw === 'number' ? [] : day.map((d) => classifyShift(pack, d, ctx.timeZone));
      const limit = typeof raw === 'number' ? raw : Math.min(...kinds.map((k) => raw[k]));
      const kind = kinds.length === 1 && kinds[0] !== 'day' ? `${kinds[0]} shift ` : '';
      const excess = ordinary - limit;
      if (excess > EPS) {
        if (rule.excess === 'violation') {
          emit({
            rule: 'daily.ordinaryMax', verdict: 'violation', shiftIds, hours: round2(excess), cite: rule.cite,
            message: `${round2(ordinary)} h of ordinary time exceeds the ${limit} h daily maximum.`,
          });
        } else {
          overtime += excess;
          ordinary = limit;
          emit({
            rule: 'daily.overtime', verdict: 'premium', shiftIds, hours: round2(excess), cite: rule.cite,
            message: `${round2(excess)} h above the ${limit} h ${kind}limit is overtime.`,
          });
        }
      }
    }

    if (overtime > EPS && worker.nightWorker && pack.nightWorker?.noOvertime) {
      emit({
        rule: 'nightWorker.noOvertime', verdict: 'violation', shiftIds, hours: round2(overtime), cite: pack.nightWorker.cite,
        message: 'Night workers may not work overtime.',
      });
    }
    if (pack.dailyOvertimeMax && overtime > pack.dailyOvertimeMax.hours + EPS) {
      emit({
        rule: 'daily.overtimeMax', verdict: 'violation', shiftIds, hours: round2(overtime), cite: pack.dailyOvertimeMax.cite,
        message: `${round2(overtime)} h of overtime exceeds the ${pack.dailyOvertimeMax.hours} h daily overtime limit.`,
      });
    }
    if (pack.dailyTotalMax && total > pack.dailyTotalMax.hours + EPS) {
      emit({
        rule: 'daily.totalMax', verdict: pack.dailyTotalMax.verdict ?? 'violation', shiftIds, hours: round2(total),
        cite: pack.dailyTotalMax.cite,
        message: `${round2(total)} h in one day exceeds the ${pack.dailyTotalMax.hours} h absolute daily maximum.`,
      });
    }
    if (pack.spreadOfHours) checkSpread(pack.spreadOfHours, day, emit);
    ordinaryByDay.set(date, ordinary);
  }
  return ordinaryByDay;
}

function checkSpread(rule: NonNullable<RulePack['spreadOfHours']>, day: Duty[], emit: Emit) {
  // Spread is the first start to the last end of the day's shifts.
  const spread = (Math.max(...day.map((x) => x.end)) - Math.min(...day.map((x) => x.start))) / HOUR;
  if (spread > rule.overHours + EPS) {
    emit({
      rule: 'daily.spreadOfHours', verdict: 'premium', shiftIds: day.flatMap(ids), hours: rule.premiumHours, cite: rule.cite,
      message: `The workday spans ${round2(spread)} h (more than ${rule.overHours} h): ${rule.premiumHours} extra hour at minimum wage is due.`,
    });
  }
}

// ─── Rest between shifts ─────────────────────────────────────────────────────

const isNightDuty = (pack: RulePack, d: Duty, tz: string): boolean =>
  !!pack.nightDuty && msInWindow(d.work, pack.nightDuty.window, tz) / HOUR > pack.nightDuty.moreThanHours + EPS;

function checkRest(pack: RulePack, ctx: EvaluationContext, duties: Duty[], emit: Emit) {
  const tz = ctx.timeZone;
  for (let i = 1; i < duties.length; i++) {
    const prev = duties[i - 1];
    const next = duties[i];
    const gapH = (next.start - prev.end) / HOUR;
    const pair = [...ids(prev), ...ids(next)];

    const rest = pack.restBetweenShifts;
    if (rest) {
      let min = resolveDated(rest.minHours, next.date);
      let why = `${min} h`;
      const after = rest.afterNightDuty;
      if (after && isNightDuty(pack, prev, tz) && wallClockAt(prev.end, tz).minuteOfDay > parseHHMM(after.endsAfter)) {
        min = Math.max(min, after.minHours);
        why = `${min} h after a night shift ending after ${after.endsAfter}`;
      }
      const exempt = rest.exemptIfPairTotalHoursLte !== undefined && workedH(prev) + workedH(next) <= rest.exemptIfPairTotalHoursLte + EPS;
      if (gapH < min - EPS && !exempt) {
        emit({
          rule: 'rest.betweenShifts', verdict: rest.verdict ?? 'violation', shiftIds: pair, hours: round2(gapH), cite: rest.cite,
          message: rest.verdict === 'warning'
            ? `Only ${round2(gapH)} h of rest between shifts. No statutory minimum is verified here; check the agreed schedule.`
            : `Only ${round2(gapH)} h of rest between shifts; at least ${why} is required.`,
        });
      }
      if (rest.dailyRestReviewHours !== undefined && gapH < rest.dailyRestReviewHours - EPS) {
        emit({
          rule: 'rest.daily', verdict: 'review', shiftIds: pair, hours: round2(gapH), cite: rest.cite,
          message: `Check the ${rest.dailyRestReviewHours} h daily rest against how you define the workday.`,
        });
      }
    }

    const fww = pack.fairWorkweek;
    const clop = fww?.clopening;
    if (clop && gapH < clop.minHours - EPS && (!clop.industries || (ctx.industry && clop.industries.includes(ctx.industry)))) {
      if (ctx.fairWorkweekCovered === false) continue;
      if (ctx.fairWorkweekCovered === undefined) {
        emit({ rule: 'fairWorkweek.coverage', verdict: 'review', shiftIds: pair, cite: clop.cite, message: `Confirm whether this location is covered: ${fww!.coverage}` });
        continue;
      }
      if (clop.consentRequired && !next.shifts[0].restConsent) {
        emit({
          rule: 'fairWorkweek.clopening', verdict: 'violation', shiftIds: pair, hours: round2(gapH), cite: clop.cite,
          message: `Only ${round2(gapH)} h between shifts; under ${clop.minHours} h needs the employee's written consent.`,
        });
        continue;
      }
      const p = clop.premium;
      const base = { rule: 'fairWorkweek.clopening', verdict: 'premium' as Verdict, shiftIds: pair, cite: clop.cite };
      if (p.kind === 'flat') {
        emit({ ...base, amount: { value: p.amount, currency: pack.currency }, message: `Rest under ${clop.minHours} h: a ${pack.currency} ${p.amount} premium is due.` });
      } else if (p.kind === 'hoursInsideGap') {
        const inside = Math.min(clop.minHours - gapH, workedH(next));
        emit({ ...base, hours: round2(inside), multiplier: p.multiplier, message: `${round2(inside)} h worked inside the ${clop.minHours} h rest window are paid at ${p.multiplier}×.` });
      } else if (p.kind === 'wholeShift') {
        emit({ ...base, hours: round2(workedH(next)), multiplier: p.multiplier, message: `The shift after less than ${clop.minHours} h of rest is paid at ${p.multiplier}×.` });
      } else {
        emit({ ...base, verdict: 'review', message: `Rest under ${clop.minHours} h earns a premium; the amount is not verified.` });
      }
    }
  }
}

// ─── Breaks ──────────────────────────────────────────────────────────────────

function checkBreaks(pack: RulePack, duties: Duty[], emit: Emit) {
  for (const d of duties) {
    const worked = workedH(d);
    const rule = pack.breaks;
    if (rule) {
      const required = breakTriggerMinutes(rule.triggers, worked);
      const minBlock = (rule.minBlockMinutes ?? 0) * MINUTE;
      const taken = d.breakPieces.filter((b) => b >= minBlock).reduce((n, b) => n + b, 0) / MINUTE;
      if (required > 0 && taken < required - EPS) {
        emit({
          rule: 'breaks.minimum', verdict: rule.verdict ?? 'violation', shiftIds: ids(d), cite: rule.cite,
          message: `${round2(worked)} h of work needs at least ${required} min of break; ${round2(taken)} min scheduled.`,
        });
      }
    }
    const meal = pack.mealDeadline;
    if (meal && worked > meal.byWorkHours + EPS) {
      const waived = worked <= meal.waivableIfWorkHoursLte + EPS && d.shifts.every((s) => s.mealWaiver);
      // The meal must start before the worker has done `byWorkHours` of work.
      const timely = d.shifts
        .flatMap((s) => s.breaks ?? [])
        .some((b) => b.end - b.start >= meal.minMinutes * MINUTE && workBefore(d, b.start) <= meal.byWorkHours * HOUR + 1);
      if (!waived && !timely) {
        emit({
          rule: 'breaks.mealDeadline', verdict: 'violation', shiftIds: ids(d), hours: meal.premiumHours, cite: meal.cite,
          message: `A ${meal.minMinutes} min meal must start by the end of hour ${meal.byWorkHours}; 1 h of premium pay is due.`,
        });
      }
    }
  }
}

const workBefore = (d: Duty, t: number) => d.work.reduce((n, w) => n + Math.max(0, Math.min(w.end, t) - w.start), 0);

// ─── Night work ──────────────────────────────────────────────────────────────

function checkNight(pack: RulePack, ctx: EvaluationContext, worker: LaborWorker, duties: Duty[], emit: Emit) {
  const tz = ctx.timeZone;
  const night = pack.night;
  if (night?.premiumPct) {
    for (const d of duties) {
      const h = msInWindow(d.work, resolveDated(night.window, d.date), tz) / HOUR;
      if (h > EPS) {
        emit({
          rule: 'night.premium', verdict: 'premium', shiftIds: ids(d), hours: round2(h), multiplier: 1 + night.premiumPct / 100, cite: night.cite,
          message: `${round2(h)} h of night work earn a ${night.premiumPct}% premium.`,
        });
      }
    }
  }
  const nd = pack.nightDuty;
  if (nd?.maxHours !== undefined) {
    for (const d of duties) {
      if (isNightDuty(pack, d, tz) && workedH(d) > nd.maxHours + EPS) {
        emit({ rule: 'night.dutyMax', verdict: 'violation', shiftIds: ids(d), hours: round2(workedH(d)), cite: nd.cite, message: `A night shift may last at most ${nd.maxHours} h.` });
      }
    }
  }
  const nw = pack.nightWorker;
  if (nw && worker.nightWorker && duties.length) {
    const first = duties[0].date;
    const last = duties[duties.length - 1].date;
    const span = daysBetweenKeys(first, last) + 1;
    const windows = Math.max(1, span - nw.referenceDays + 1);
    for (let w = 0; w < windows; w++) {
      const from = addDaysToKey(first, w);
      const to = addDaysToKey(from, nw.referenceDays - 1);
      const inWin = duties.filter((d) => d.date >= from && d.date <= to);
      const avg = inWin.reduce((n, d) => n + workedH(d), 0) / nw.referenceDays;
      if (avg > nw.averageDailyHours + EPS) {
        emit({
          rule: 'nightWorker.average', verdict: 'violation', shiftIds: inWin.flatMap(ids), hours: round2(avg), cite: nw.cite,
          message: `A night worker averages ${round2(avg)} h per day over ${nw.referenceDays} days; the limit is ${nw.averageDailyHours} h (no opt-out).`,
        });
        break;
      }
    }
  }
}

// ─── Weekly limits, averages, weekly rest ────────────────────────────────────

function checkWeekly(
  pack: RulePack, ctx: EvaluationContext, worker: LaborWorker, duties: Duty[], ordinaryByDay: Map<DateKey, number>, startsOn: number, emit: Emit,
) {
  const weeks = new Map<DateKey, { duties: Duty[]; ordinary: number; total: number }>();
  for (const d of duties) {
    const key = weekStartOf(d.date, startsOn);
    const w = weeks.get(key) ?? { duties: [], ordinary: 0, total: 0 };
    w.duties.push(d);
    w.total += workedH(d);
    weeks.set(key, w);
  }
  for (const [date, ordinary] of ordinaryByDay) weeks.get(weekStartOf(date, startsOn))!.ordinary += ordinary;
  const weekKeys = [...weeks.keys()].sort();

  for (const key of weekKeys) {
    const w = weeks.get(key)!;
    const shiftIds = w.duties.flatMap(ids);
    const wom = pack.weeklyOrdinaryMax;
    if (wom) {
      const end = addDaysToKey(key, 6);
      const atStart = resolveDated(wom.hours, key);
      const atEnd = resolveDated(wom.hours, end);
      const limit = Math.min(atStart, atEnd);
      if (atStart !== atEnd) {
        emit({
          rule: 'weekly.limitChanges', verdict: 'review', shiftIds, cite: wom.cite,
          message: `The weekly limit changes from ${atStart} h to ${atEnd} h during this week; the stricter ${limit} h is applied.`,
        });
      }
      if (w.ordinary > limit + EPS) {
        emit({
          rule: 'weekly.overtime', verdict: 'premium', shiftIds, hours: round2(w.ordinary - limit), cite: wom.cite,
          message: `${round2(w.ordinary - limit)} h above the ${limit} h weekly limit are overtime.`,
        });
      }
    }
    if (pack.weeklyMax && w.total > pack.weeklyMax.hours + EPS) {
      emit({
        rule: 'weekly.max', verdict: pack.weeklyMax.verdict ?? 'violation', shiftIds, hours: round2(w.total), cite: pack.weeklyMax.cite,
        message: `${round2(w.total)} h in one week exceeds the ${pack.weeklyMax.hours} h maximum.`,
      });
    }
  }

  for (const avg of pack.averageWeeklyMax ?? []) {
    if (avg.optOutAllowed && worker.weeklyLimitOptOut) continue;
    if (!weekKeys.length) break;
    const first = weekKeys[0];
    const span = Math.floor(daysBetweenKeys(first, weekKeys[weekKeys.length - 1]) / 7) + 1;
    const totalOf = (from: DateKey, n: number) =>
      [...weeks.entries()].filter(([k]) => k >= from && k < addDaysToKey(from, n * 7)).reduce((s, [, v]) => s + v.total, 0);
    const optOut = avg.optOutAllowed ? ' without a signed opt-out' : '';
    if (span >= avg.weeks) {
      for (let i = 0; i + avg.weeks <= span; i++) {
        const from = addDaysToKey(first, i * 7);
        const mean = totalOf(from, avg.weeks) / avg.weeks;
        if (mean > avg.hours + EPS) {
          emit({
            rule: 'weekly.average', verdict: 'violation', shiftIds: [], hours: round2(mean), cite: avg.cite,
            message: `Average of ${round2(mean)} h/week over ${avg.weeks} weeks exceeds ${avg.hours} h${optOut}.`,
          });
          break;
        }
      }
    } else {
      // Fewer weeks than the reference period: only a total that no future
      // schedule can bring under the average is a violation.
      const total = totalOf(first, span);
      const mean = total / span;
      if (total > avg.hours * avg.weeks + EPS) {
        emit({ rule: 'weekly.average', verdict: 'violation', shiftIds: [], hours: round2(mean), cite: avg.cite, message: `These weeks alone exceed the ${avg.hours} h average over ${avg.weeks} weeks${optOut}.` });
      } else if (mean > avg.hours + EPS) {
        emit({ rule: 'weekly.average', verdict: 'warning', shiftIds: [], hours: round2(mean), cite: avg.cite, message: `On track to exceed the ${avg.hours} h average over ${avg.weeks} weeks${optOut}.` });
      }
    }
  }

  const wr = pack.weeklyRest;
  if (wr && duties.length) {
    for (const key of weekKeys) {
      const winStart = zonedToUtc(key, 0, ctx.timeZone);
      const winEnd = zonedToUtc(addDaysToKey(key, 7), 0, ctx.timeZone);
      // Longest gap without work that overlaps this week. A gap reaching into
      // known shifts of the week before or after counts whole; a gap that runs
      // off the edge of the schedule counts only up to the week boundary,
      // because the engine can't see whether those days were worked.
      const sorted = [...duties].sort((a, b) => a.start - b.start);
      const free: Interval[] = [{ start: Math.min(winStart, sorted[0].start), end: sorted[0].start }];
      for (let i = 1; i < sorted.length; i++) free.push({ start: sorted[i - 1].end, end: sorted[i].start });
      free.push({ start: sorted[sorted.length - 1].end, end: Math.max(winEnd, sorted[sorted.length - 1].end) });
      let longest = 0;
      for (const f of free) if (overlap(f, { start: winStart, end: winEnd }) > 0) longest = Math.max(longest, f.end - f.start);
      if (longest < wr.minHours * HOUR - 1) {
        emit({
          rule: 'rest.weekly', verdict: wr.verdict ?? 'violation', shiftIds: weeks.get(key)!.duties.flatMap(ids), hours: round2(longest / HOUR), cite: wr.cite,
          message: `No weekly rest of ${wr.minHours} consecutive hours in the week of ${key}.`,
        });
      }
    }
  }
}

// ─── Notice ──────────────────────────────────────────────────────────────────

function checkNotice(pack: RulePack, ctx: EvaluationContext, worker: LaborWorker, duties: Duty[], emit: Emit) {
  if (ctx.publishedAt === undefined) return;
  const rules = [pack.notice, ctx.fairWorkweekCovered ? pack.fairWorkweek?.notice : undefined];
  for (const rule of rules) {
    if (!rule) continue;
    if (rule.onlyNoFixedHours && !worker.noFixedHours) continue;
    if (rule.industries && (!ctx.industry || !rule.industries.includes(ctx.industry))) continue;
    for (const d of duties) {
      for (const s of d.shifts) {
        const lead = (s.start - ctx.publishedAt) / HOUR;
        if (lead < rule.hours - EPS) {
          emit({
            rule: 'notice.advance', verdict: rule.verdict, shiftIds: [s.id], hours: round2(lead), cite: rule.cite,
            message: rule.verdict === 'refusable'
              ? `Posted ${round2(lead)} h ahead (less than ${rule.hours} h): the employee may refuse this shift.`
              : `Posted ${round2(lead)} h ahead; at least ${rule.hours} h (${round2(rule.hours / 24)} days) of notice is required.`,
          });
        }
      }
    }
  }
}

// ─── Minors ──────────────────────────────────────────────────────────────────

const touchesWindow = (d: Duty, w: TimeWindow, tz: string) => msInWindow(d.work, w, tz) > 0;

/** True when all of the duty's work lies inside the daily window. */
const insideWindow = (d: Duty, w: TimeWindow, tz: string) => msInWindow(d.work, w, tz) >= d.workedMs - 1;

function checkMinors(pack: RulePack, ctx: EvaluationContext, worker: LaborWorker, duties: Duty[], startsOn: number, emit: Emit) {
  if (!pack.minors?.length || !worker.birthDate) return;
  const tz = ctx.timeZone;
  const school = new Set(ctx.schoolDays ?? []);
  const ruleFor = (date: DateKey): MinorRule | undefined => {
    const age = ageOn(worker.birthDate!, date);
    return pack.minors!.find((r) => age >= r.ageFrom && age <= r.ageTo && (!r.onlyInCompulsorySchooling || worker.inCompulsorySchooling));
  };
  const violation = (r: MinorRule, d: Duty[], message: string, hours?: number) =>
    emit({ rule: 'minors', verdict: 'violation', shiftIds: d.flatMap(ids), hours, cite: r.cite, message });

  for (const d of duties) {
    const r = ruleFor(d.date);
    if (!r) continue;
    const h = workedH(d);
    const isSchool = school.has(d.date);
    const dailyCap = isSchool ? r.schoolDayMaxHours ?? r.maxDailyHours : r.nonSchoolDayMaxHours ?? r.maxDailyHours;
    if (dailyCap !== undefined && h > dailyCap + EPS) violation(r, [d], `${round2(h)} h exceeds the ${dailyCap} h daily limit for this young worker${isSchool ? ' on a school day' : ''}.`, round2(h));

    let allowed = r.allowedWindow;
    if (r.summerAllowedWindow && isUsSummer(d.date)) allowed = r.summerAllowedWindow;
    const industryWin = r.industryAllowedWindows?.find((iw) => ctx.industry && iw.industries.includes(ctx.industry));
    if (industryWin) allowed = industryWin.window;
    if (allowed && !insideWindow(d, allowed, tz)) violation(r, [d], `Young workers may only work between ${allowed[0]} and ${allowed[1]}.`);

    const banned = [...(r.bannedWindows ?? [])];
    if (worker.minorAlternativeNightPeriod && r.alternativeBannedWindow && banned.length) banned[0] = r.alternativeBannedWindow;
    for (const b of banned) if (touchesWindow(d, b, tz)) violation(r, [d], `Young workers may not work between ${b[0]} and ${b[1]}.`);

    if (r.noOvertime && d.overtimeHours > 0) violation(r, [d], 'Young workers may not work overtime.');
    if (r.breaks) {
      const req = breakTriggerMinutes(r.breaks, h);
      const taken = d.breakPieces.reduce((n, b) => n + b, 0) / MINUTE;
      if (req > 0 && taken < req - EPS) violation(r, [d], `A young worker needs at least ${req} min of break for ${round2(h)} h of work.`);
    }
  }

  for (let i = 1; i < duties.length; i++) {
    const r = ruleFor(duties[i].date);
    const gap = (duties[i].start - duties[i - 1].end) / HOUR;
    if (r?.minRestHours !== undefined && gap < r.minRestHours - EPS) {
      violation(r, [duties[i - 1], duties[i]], `Young workers need ${r.minRestHours} h of rest between shifts; ${round2(gap)} h scheduled.`, round2(gap));
    }
  }

  const byWeek = new Map<DateKey, Duty[]>();
  for (const d of duties) {
    const k = weekStartOf(d.date, startsOn);
    byWeek.set(k, [...(byWeek.get(k) ?? []), d]);
  }
  for (const [key, list] of byWeek) {
    const r = ruleFor(list[0].date);
    if (!r) continue;
    const total = list.reduce((n, d) => n + workedH(d), 0);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysToKey(key, i));
    const schoolWeek = weekDays.some((k) => school.has(k));
    const cap = schoolWeek ? r.schoolWeekMaxHours ?? r.maxWeeklyHours : r.nonSchoolWeekMaxHours ?? r.maxWeeklyHours;
    if (cap !== undefined && total > cap + EPS) violation(r, list, `${round2(total)} h exceeds the ${cap} h weekly limit for this young worker.`, round2(total));
    if (schoolWeek && r.schoolWeekWeekdayMaxHours !== undefined) {
      const weekdays = list.filter((d) => { const wd = weekdayOfKey(d.date); return wd >= 1 && wd <= 5; });
      const h = weekdays.reduce((n, d) => n + workedH(d), 0);
      if (h > r.schoolWeekWeekdayMaxHours + EPS) violation(r, weekdays, `${round2(h)} h Monday to Friday exceeds the ${r.schoolWeekWeekdayMaxHours} h limit in a school week.`, round2(h));
    }
  }
}

// ─── Overtime pay (US, Canada) ───────────────────────────────────────────────

function computeOvertimePay(pack: RulePack, duties: Duty[], startsOn: number, emit: Emit): PayBreakdown {
  const totalHours = duties.reduce((n, d) => n + workedH(d), 0);
  const rule = pack.overtimePay;
  if (!rule) return { regularHours: round2(totalHours), overtime: [] };

  const bands = new Map<number, number>();
  const add = (mult: number, h: number) => { if (h > EPS) bands.set(mult, (bands.get(mult) ?? 0) + h); };
  let regularTotal = 0;

  const weeks = new Map<DateKey, Map<DateKey, Duty[]>>();
  for (const d of duties) {
    const wk = weekStartOf(d.date, startsOn);
    const days = weeks.get(wk) ?? new Map<DateKey, Duty[]>();
    days.set(d.date, [...(days.get(d.date) ?? []), d]);
    weeks.set(wk, days);
  }

  for (const [wk, days] of [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let weekRegular = 0;
    const workedAll7 = days.size === 7;
    const dayKeys = [...days.keys()].sort();
    const weekBands: { mult: number; hours: number; date: DateKey }[] = [];
    dayKeys.forEach((date, i) => {
      const h = days.get(date)!.reduce((n, d) => n + workedH(d), 0);
      let regular = h;
      if (rule.seventhDay && workedAll7 && i === 6) {
        weekBands.push({ mult: rule.seventhDay.first8, hours: Math.min(h, 8), date }, { mult: rule.seventhDay.after8, hours: Math.max(0, h - 8), date });
        regular = 0;
      } else if (rule.daily?.length) {
        const sorted = [...rule.daily].sort((a, b) => a.after - b.after);
        regular = Math.min(h, sorted[0].after);
        sorted.forEach((band, j) => {
          const upper = sorted[j + 1]?.after ?? Infinity;
          weekBands.push({ mult: band.multiplier, hours: Math.max(0, Math.min(h, upper) - band.after), date });
        });
      }
      // Weekly overtime applies to regular hours only, so daily and weekly overtime never double count.
      if (rule.weekly) {
        const room = Math.max(0, rule.weekly.after - weekRegular);
        const weeklyOt = Math.max(0, regular - room);
        if (weeklyOt > 0) weekBands.push({ mult: rule.weekly.multiplier, hours: weeklyOt, date });
        regular -= weeklyOt;
      }
      weekRegular += regular;
    });
    regularTotal += weekRegular;
    for (const b of weekBands) add(b.mult, b.hours);
    const otHours = weekBands.reduce((n, b) => n + b.hours, 0);
    if (otHours > EPS) {
      const summary = [...new Set(weekBands.filter((b) => b.hours > EPS).map((b) => b.mult))]
        .map((m) => `${round2(weekBands.filter((b) => b.mult === m).reduce((n, b) => n + b.hours, 0))} h at ${m}×`)
        .join(', ');
      emit({
        rule: 'pay.overtime', verdict: 'premium', shiftIds: [...days.values()].flat().flatMap(ids), hours: round2(otHours), cite: rule.cite,
        message: `Overtime in the week of ${wk}: ${summary}.`,
      });
    }
  }
  return {
    regularHours: round2(regularTotal),
    overtime: [...bands.entries()].sort(([a], [b]) => a - b).map(([multiplier, hours]) => ({ multiplier, hours: round2(hours) })),
  };
}

function checkPayByClock(duties: Duty[], tz: string, emit: Emit) {
  for (const d of duties) {
    const a = wallClockAt(d.start, tz);
    const b = wallClockAt(d.end, tz);
    const clock = (daysBetweenKeys(a.dateKey, b.dateKey) * 1440 + b.minuteOfDay - a.minuteOfDay) / 60;
    const elapsed = (d.end - d.start) / HOUR;
    if (Math.abs(clock - elapsed) > EPS) {
      emit({
        rule: 'pay.byClock', verdict: 'premium', shiftIds: ids(d), hours: round2(clock), cite: { source: 'Fair Work Ombudsman, hours of work (daylight saving)', confidence: 'high' },
        message: `Daylight saving change: paid as ${round2(clock)} h by the clock (${round2(elapsed)} h elapsed) unless the award says otherwise.`,
      });
    }
  }
}

/** Human-readable name of the jurisdiction a pack applies. */
export const jurisdictionLabel = (code: string): string => {
  const chain = jurisdictionChain(code).map((c) => getJurisdiction(c)?.name ?? c);
  return chain.reverse().join(', ');
};
