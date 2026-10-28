/**
 * Greedy shift-assignment algorithm with 2-opt local-search improvement.
 *
 * Hard constraints (must satisfy — assignment is rejected if violated):
 *   1. Worker role must match template role
 *   2. Worker availability must fully cover the template window on the shift date
 *      (overnight windows supported, see "Time model" below)
 *   3. No time overlap with any other shift of the same worker, including shifts in
 *      existingRoster and shifts on the previous/next day that cross midnight
 *   4. (optional) Max daily hours per worker must not be exceeded
 *   5. (optional) Max weekly hours per worker (ISO week Mon–Sun) must not be exceeded
 *   6. (optional) Minimum rest hours between consecutive shifts must be observed
 *
 * Time model:
 *   - Dates and HH:MM times are wall-clock values in the business time zone
 *     (`timeZone`, IANA). Every shift is converted to an absolute interval [start, end)
 *     in elapsed UTC minutes with `utils/zonedTime`, so durations, overlap and rest are
 *     real elapsed time: 22:00–06:00 is 9h on a fall-back night and 7h on a
 *     spring-forward night. A template whose end is <= its start is an overnight shift
 *     ending on the following local day (22:00–06:00 on Mon runs Mon 22:00 → Tue 06:00;
 *     16:00–00:00 ends at Tue 00:00). A local time inside a DST gap resolves to after the
 *     gap (`zonedToUtc`: read with the offset in force before the gap, so 02:30 on a
 *     New York spring-forward day is 03:30 EDT); a repeated local time resolves to its
 *     first occurrence.
 *   - Spans inside a DST gap (CHG-087): when the start resolves past the gap but the end
 *     does not, the elapsed span can come out zero or negative (02:00–03:00 New York on
 *     2026-03-08 is 07:00Z–07:00Z). Such a span moves to after the gap with its
 *     wall-clock length, as if both ends were read with the pre-gap offset: 02:00–03:00
 *     runs 03:00–04:00 EDT, 02:30–03:00 runs 03:30–04:00 EDT. Availability slots use the
 *     same rule. So every span with a positive wall-clock length has a positive elapsed
 *     length; no slot is ever zero-length.
 *   - Weekdays and calendar days come from the business-local date key, never from the
 *     device clock.
 *   - Deprecated: without `timeZone`, a given `timezoneOffsetMinutes` means a fixed-offset
 *     zone (every day is 24h). With neither, the device's IANA zone is used.
 *   - Availability slots use the same rule (Mon 22:00–06:00 runs into Tuesday). A slot
 *     ending at 23:59 is treated as ending at 24:00, because time inputs cannot express
 *     24:00. Slots from the previous, same and next weekday are merged when they touch,
 *     so Mon 18:00–23:59 + Tue 00:00–08:00 covers a Mon 22:00–06:00 shift.
 *   - Overlap and minimum rest are computed on absolute intervals, so they work across
 *     day boundaries and look at shifts on any date (not only the target date).
 *   - Hours attribution: a shift's full elapsed duration counts toward the day (and ISO week)
 *     on which it STARTS. A Sun 22:00–Mon 06:00 shift is 8h on Sunday and in Sunday's week.
 *
 * Soft scoring (higher = preferred):
 *   - Fairness: workers with fewer total assigned hours are preferred
 *     Score contribution: 1 / (1 + existingHoursForWorker)
 *
 * Algorithm:
 *   1. Greedy first-fit: for each template slot, assign the best-scored eligible worker
 *   2. 2-opt local swap: try swapping the workers of any two assignments to improve
 *      fairness. Every swap is re-validated against ALL hard constraints using the true
 *      resulting roster (existing roster + every other current assignment).
 *   3. Refill: try again to fill slots still open after swapping.
 *   4. Report every template whose coverage is not met, with a reason code.
 *
 * Pure function — no side effects, no React imports.
 */
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import {
  MINUTES_PER_DAY,
  getTemplateWindow,
  getWeekdayFromDate,
  normalizeWindow,
  parseTimeToMinutes,
} from '@/utils/schedulerUtils';
import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';
import { isValidTimeZone, zonedToUtc } from '@/utils/zonedTime';
import { getDeviceTimeZone } from '@/utils/businessTimeZone';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Optional labor-law hard constraints applied during assignment.
 * All limits are inclusive upper bounds; omit a field to disable that check.
 */
export type LaborConstraints = {
  /** Maximum hours a worker may work per day, counting each shift on its start date (e.g. 10). */
  maxDailyHours?: number;
  /** Maximum hours a worker may work in an ISO calendar week Mon–Sun, by shift start date (e.g. 48). */
  maxWeeklyHours?: number;
  /** Minimum rest hours required between the end of one shift and the start of the next (e.g. 12). */
  minRestHoursBetweenShifts?: number;
};

export type AssignmentInput = {
  /** ISO date (YYYY-MM-DD) for which to generate assignments. */
  date: string;
  /** Shift templates to be assigned on this date. */
  templates: ShiftTemplate[];
  /**
   * Full template catalog used to resolve existingRoster entries. `templates` is always
   * merged in, so passing only the catalog of other templates is fine. Pass all known
   * templates when existingRoster contains shifts whose templates are not in `templates`,
   * otherwise those shifts cannot be checked for overlap, hours or rest.
   */
  templateCatalog?: ShiftTemplate[];
  workers: Worker[];
  /** Already-committed roster entries (any date) used for overlap + fairness checks. */
  existingRoster: Shift[];
  /**
   * Business time zone (IANA, e.g. "Europe/Madrid"). Dates and template/availability
   * times are wall-clock times in this zone. Throws RangeError when it is not a valid
   * zone. Defaults to the device zone (UTC if the device zone is invalid).
   */
  timeZone?: string;
  /**
   * @deprecated Use `timeZone`. Only read when `timeZone` is absent: shifts are placed on
   * a fixed-offset timeline where every day is 24h (no DST).
   */
  timezoneOffsetMinutes?: number;
  /** Optional labor-law constraints. Omitting this field disables all constraint checks (backward-compatible). */
  constraints?: LaborConstraints;
};

export type AssignedShift = {
  date: string;
  templateId: string;
  workerId: string;
};

/**
 * Why a slot could not be filled. Determined by filtering the workforce through the
 * hard constraints in order (role → availability → overlap → max hours → min rest);
 * the code names the stage at which the last remaining candidate was eliminated.
 */
export type ShortfallReasonCode =
  | 'no_role_match'
  | 'no_availability'
  | 'overlap'
  | 'max_hours'
  | 'min_rest';

/** A template whose coverage requirement was not fully met on `date`. */
export type CoverageShortfall = {
  templateId: string;
  date: string;
  /** Number of workers the template needs. */
  required: number;
  /** Number of workers assigned to it by this run. */
  assigned: number;
  /** required − assigned (always ≥ 1). */
  missing: number;
  reasonCode: ShortfallReasonCode;
  /** English, human-readable explanation (for logs/banners; UI should localise `reasonCode`). */
  reason: string;
};

export type AssignmentResult = {
  assignments: AssignedShift[];
  /** Every template that is under-covered (partially or fully). Empty when all coverage is met. */
  unassigned: CoverageShortfall[];
};

// ─── Internal types ───────────────────────────────────────────────────────────

/** A roster entry resolved to an absolute interval of elapsed time. */
export type Entry = {
  workerId: string;
  templateId: string;
  /** Business-local start date (YYYY-MM-DD). */
  date: string;
  /** Absolute start, in elapsed minutes since the Unix epoch. */
  start: number;
  /** Absolute end (exclusive). */
  end: number;
};

export type Interval = { start: number; end: number };

const REASON_ORDER: ShortfallReasonCode[] = [
  'no_role_match',
  'no_availability',
  'overlap',
  'max_hours',
  'min_rest',
];

// ─── Time helpers ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Day number of an ISO date on a continuous calendar (no timezone/DST effects). */
const dayIndex = (date: string): number => Math.round(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);

/** Returns an ISO date string offset by `days` from the given ISO date. */
const offsetDate = (date: string, days: number): string => addDaysToKey(date, days);

/**
 * Maps a business-local wall time (date key + minutes after its midnight, possibly
 * >= 1440 for the next day) to absolute elapsed minutes since the Unix epoch.
 */
export type Timeline = (date: string, minutes: number) => number;

/** Timeline for an IANA zone; conversions are cached for the run. */
const zonedTimeline = (timeZone: string): Timeline => {
  const cache = new Map<string, number>();
  return (date, minutes) => {
    const key = `${date}|${minutes}`;
    let value = cache.get(key);
    if (value === undefined) {
      value = Math.round(zonedToUtc(date, minutes, timeZone) / 60_000);
      cache.set(key, value);
    }
    return value;
  };
};

/** Deprecated fixed-offset timeline: every day is exactly 24h. */
const fixedOffsetTimeline: Timeline = (date, minutes) => dayIndex(date) * MINUTES_PER_DAY + minutes;

/** Picks the timeline for an input: `timeZone`, else a given fixed offset, else the device zone. */
export const timelineFor = (input: AssignmentInput): Timeline => {
  if (input.timeZone !== undefined) {
    if (!isValidTimeZone(input.timeZone)) throw new RangeError(`Invalid time zone: "${input.timeZone}"`);
    return zonedTimeline(input.timeZone);
  }
  if (input.timezoneOffsetMinutes !== undefined) return fixedOffsetTimeline;
  return zonedTimeline(getDeviceTimeZone());
};

/**
 * Absolute interval of the local window [startMinutes, endMinutes) on `date` (end may be
 * ≥ 1440). A span that a DST gap makes zero or negative moves to after the gap with its
 * wall-clock length (see "Spans inside a DST gap" above).
 */
export const zonedSpan = (date: string, startMinutes: number, endMinutes: number, at: Timeline): Interval => {
  const start = at(date, startMinutes);
  const end = at(date, endMinutes);
  const wallLength = endMinutes - startMinutes;
  return { start, end: end <= start && wallLength > 0 ? start + wallLength : end };
};

/** Absolute interval of `template` when it starts on `date`. */
export const shiftInterval = (template: ShiftTemplate, date: string, at: Timeline): Interval => {
  const w = normalizeWindow(getTemplateWindow(template));
  return zonedSpan(date, w.startMinutes, w.endMinutes, at);
};

const entryMinutes = (e: Entry | Interval): number => e.end - e.start;

/**
 * True when two intervals share any instant. A zero-length interval occupies its
 * instant (it overlaps an interval containing it, or another at the same instant), so a
 * worker can never stack zero-length shifts. Minutes are integers, so `start + 1` is
 * the smallest non-empty end.
 */
export const intervalsOverlap = (a: Interval, b: Interval): boolean =>
  a.start < Math.max(b.end, b.start + 1) && b.start < Math.max(a.end, a.start + 1);

/** Absolute interval of an availability slot on `date` (23:59 = end of day, end <= start wraps). */
const availabilityInterval = (from: string, to: string, date: string, at: Timeline): Interval => {
  const start = parseTimeToMinutes(from);
  const rawEnd = parseTimeToMinutes(to);
  const end = rawEnd === MINUTES_PER_DAY - 1 ? MINUTES_PER_DAY : rawEnd;
  const w = normalizeWindow({ startMinutes: start, endMinutes: end });
  return zonedSpan(date, w.startMinutes, w.endMinutes, at);
};

/**
 * Returns the ISO week bounds (Monday and Sunday, inclusive) of the week containing `date`.
 * Exported for unit testing.
 */
export const getWeekBounds = (date: string): { weekStart: string; weekEnd: string } => {
  const dayOfWeek = weekdayOfKey(date); // 0=Sun, 1=Mon, …, 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = addDaysToKey(date, -daysFromMonday);
  return { weekStart, weekEnd: addDaysToKey(weekStart, 6) };
};

/** Coverage requirement of a template (non-finite or < 1 counts as 1). */
export const requiredSlots = (template: ShiftTemplate): number => {
  const raw = template.coverage;
  return Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : 1;
};

// ─── Constraint checks ────────────────────────────────────────────────────────

export type CheckContext = {
  date: string;
  /** The previous, target and next date with their weekday labels (null when invalid). */
  days: { date: string; label: string | null }[];
  constraints?: LaborConstraints;
  /** Business-local wall time → absolute elapsed minutes. */
  at: Timeline;
};

/** Returns true when the worker's availability covers `interval` (a shift starting on ctx.date). */
const workerCoversInterval = (worker: Worker, interval: Interval, ctx: CheckContext): boolean => {
  const slots: Interval[] = [];
  for (const { date: day, label } of ctx.days) {
    if (!label) continue;
    for (const slot of worker.availability) {
      if (slot.day === label) slots.push(availabilityInterval(slot.from, slot.to, day, ctx.at));
    }
  }
  if (slots.length === 0) return false;
  slots.sort((a, b) => a.start - b.start);
  // Merge overlapping / touching slots, then look for one that contains the interval.
  let current = { ...slots[0] };
  for (let i = 1; i <= slots.length; i++) {
    const next = slots[i];
    if (next && next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
      continue;
    }
    if (current.start <= interval.start && current.end >= interval.end) return true;
    if (next) current = { ...next };
  }
  return false;
};

/**
 * Checks every hard constraint for putting `worker` on `template` on `ctx.date`, given
 * all OTHER roster entries (`others`). Returns null when eligible, otherwise the code of
 * the first failing constraint (in REASON_ORDER).
 */
export const checkEligibility = (
  worker: Worker,
  template: ShiftTemplate,
  others: Entry[],
  ctx: CheckContext
): ShortfallReasonCode | null => {
  if (worker.role !== template.role) return 'no_role_match';

  const interval = shiftInterval(template, ctx.date, ctx.at);
  if (!workerCoversInterval(worker, interval, ctx)) return 'no_availability';

  const mine = others.filter((e) => e.workerId === worker.id);
  // A worker never takes two positions of one slot (date × template), whatever its
  // length, and never a slot that shares an instant with one they hold (CHG-087).
  if (mine.some((e) => (e.date === ctx.date && e.templateId === template.id) || intervalsOverlap(e, interval))) {
    return 'overlap';
  }

  const constraints = ctx.constraints;
  if (!constraints) return null;

  const newMinutes = interval.end - interval.start;
  if (constraints.maxDailyHours !== undefined) {
    const daily = mine.reduce((sum, e) => (e.date === ctx.date ? sum + entryMinutes(e) : sum), 0);
    if (daily + newMinutes > constraints.maxDailyHours * 60) return 'max_hours';
  }
  if (constraints.maxWeeklyHours !== undefined) {
    const { weekStart, weekEnd } = getWeekBounds(ctx.date);
    const weekly = mine.reduce(
      (sum, e) => (e.date >= weekStart && e.date <= weekEnd ? sum + entryMinutes(e) : sum),
      0
    );
    if (weekly + newMinutes > constraints.maxWeeklyHours * 60) return 'max_hours';
  }
  if (constraints.minRestHoursBetweenShifts !== undefined) {
    const minRest = constraints.minRestHoursBetweenShifts * 60;
    // Gap between two non-overlapping intervals, whichever comes first.
    if (mine.some((e) => Math.max(interval.start - e.end, e.start - interval.end) < minRest)) {
      return 'min_rest';
    }
  }
  return null;
};

/** Check context for shifts starting on `date`: the previous, same and next local day. */
export const buildCheckContext = (date: string, constraints: LaborConstraints | undefined, at: Timeline): CheckContext => ({
  date,
  // Weekday labels are a property of the business-local date key.
  days: [-1, 0, 1].map((offset) => {
    const day = offsetDate(date, offset);
    return { date: day, label: getWeekdayFromDate(day) };
  }),
  constraints,
  at,
});

/** Template lookup: the catalog plus the run's templates (which win on id clashes). */
export const buildCatalog = (input: AssignmentInput): Map<string, ShiftTemplate> => {
  const catalog = new Map<string, ShiftTemplate>();
  for (const t of input.templateCatalog ?? []) catalog.set(t.id, t);
  for (const t of input.templates) catalog.set(t.id, t);
  return catalog;
};

/**
 * Roster entries resolved to absolute intervals. Entries whose template is unknown
 * cannot be placed on the timeline and are ignored.
 */
export const resolveRoster = (roster: Shift[], catalog: Map<string, ShiftTemplate>, at: Timeline): Entry[] => {
  const entries: Entry[] = [];
  for (const shift of roster) {
    const template = catalog.get(shift.templateId);
    if (!template) continue;
    entries.push({
      workerId: shift.workerId,
      templateId: shift.templateId,
      date: shift.date,
      ...shiftInterval(template, shift.date, at),
    });
  }
  return entries;
};

/** Fairness score: workers with fewer hours get a higher score. */
const fairnessScore = (workerId: string, accumulatedHours: Map<string, number>): number =>
  1 / (1 + (accumulatedHours.get(workerId) ?? 0));

// ─── Main export ──────────────────────────────────────────────────────────────

export function assignShifts(input: AssignmentInput): AssignmentResult {
  const { date, templates, workers, existingRoster, constraints } = input;
  const at = timelineFor(input);
  const ctx = buildCheckContext(date, constraints, at);

  // Template lookup: full catalog plus today's templates (A6 — existing shifts whose
  // template is not in today's list must still be visible to every check).
  const catalog = buildCatalog(input);

  const workerById = new Map(workers.map((w) => [w.id, w]));

  // Existing roster resolved to absolute intervals.
  const existing = resolveRoster(existingRoster, catalog, at);

  // Accumulated hours for fairness (seeded from the whole existing roster)
  const accumulatedHours = new Map<string, number>();
  for (const worker of workers) accumulatedHours.set(worker.id, 0);
  for (const e of existing) {
    if (accumulatedHours.has(e.workerId)) {
      accumulatedHours.set(e.workerId, (accumulatedHours.get(e.workerId) ?? 0) + entryMinutes(e) / 60);
    }
  }

  // New assignments made by this run (single source of truth for the live roster).
  const assigned: Entry[] = [];
  const allEntries = (): Entry[] => existing.concat(assigned);
  const countFor = (templateId: string): number =>
    assigned.reduce((n, e) => (e.templateId === templateId ? n + 1 : n), 0);

  /** Fills open slots of `template` with the fairest eligible workers. */
  const fillTemplate = (template: ShiftTemplate): void => {
    const needed = requiredSlots(template);
    while (countFor(template.id) < needed) {
      const roster = allEntries();
      let best: Worker | null = null;
      let bestScore = -Infinity;
      for (const worker of workers) {
        if (checkEligibility(worker, template, roster, ctx) !== null) continue;
        const score = fairnessScore(worker.id, accumulatedHours);
        if (score > bestScore) {
          best = worker;
          bestScore = score;
        }
      }
      if (!best) return;
      const interval = shiftInterval(template, date, at);
      assigned.push({ workerId: best.id, templateId: template.id, date, ...interval });
      accumulatedHours.set(best.id, (accumulatedHours.get(best.id) ?? 0) + entryMinutes(interval) / 60);
    }
  };

  // ── 1. Greedy fill ────────────────────────────────────────────────────────
  for (const template of templates) fillTemplate(template);

  // ── 2. 2-opt local swap improvement ───────────────────────────────────────
  // Swap the workers of two assignments when it improves fairness AND both resulting
  // assignments satisfy every hard constraint against the true resulting roster.
  // Each applied swap strictly increases the total fairness score, so this terminates.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < assigned.length; i++) {
      for (let j = i + 1; j < assigned.length; j++) {
        const a = assigned[i];
        const b = assigned[j];
        if (a.workerId === b.workerId || a.templateId === b.templateId) continue;

        const templateA = catalog.get(a.templateId);
        const templateB = catalog.get(b.templateId);
        const workerA = workerById.get(a.workerId);
        const workerB = workerById.get(b.workerId);
        if (!templateA || !templateB || !workerA || !workerB) continue;

        const hoursA = entryMinutes(a) / 60;
        const hoursB = entryMinutes(b) / 60;
        const swappedHours = new Map(accumulatedHours);
        swappedHours.set(a.workerId, (swappedHours.get(a.workerId) ?? 0) - hoursA + hoursB);
        swappedHours.set(b.workerId, (swappedHours.get(b.workerId) ?? 0) - hoursB + hoursA);

        const currentScore =
          fairnessScore(a.workerId, accumulatedHours) + fairnessScore(b.workerId, accumulatedHours);
        const swappedScore =
          fairnessScore(a.workerId, swappedHours) + fairnessScore(b.workerId, swappedHours);
        if (swappedScore <= currentScore + 0.001) continue;

        // The resulting roster minus the two swapped slots. Worker A's and worker B's
        // constraints only depend on their own shifts, so each new slot is validated
        // against this roster independently.
        const rest = existing.concat(assigned.filter((_, k) => k !== i && k !== j));
        if (checkEligibility(workerA, templateB, rest, ctx) !== null) continue;
        if (checkEligibility(workerB, templateA, rest, ctx) !== null) continue;

        assigned[i] = { ...a, workerId: b.workerId };
        assigned[j] = { ...b, workerId: a.workerId };
        accumulatedHours.set(a.workerId, swappedHours.get(a.workerId) ?? 0);
        accumulatedHours.set(b.workerId, swappedHours.get(b.workerId) ?? 0);
        improved = true;
      }
    }
  }

  // ── 3. Refill slots that may have become fillable after swaps ─────────────
  for (const template of templates) fillTemplate(template);

  // ── 4. Shortfall report ───────────────────────────────────────────────────
  const finalRoster = allEntries();
  const unassigned: CoverageShortfall[] = [];
  for (const template of templates) {
    const required = requiredSlots(template);
    const count = countFor(template.id);
    if (count >= required) continue;
    const reasonCode = shortfallReason(template, workers, finalRoster, ctx);
    unassigned.push({
      templateId: template.id,
      date,
      required,
      assigned: count,
      missing: required - count,
      reasonCode,
      reason: describeReason(reasonCode, template, date),
    });
  }

  return {
    assignments: assigned.map((e) => ({ date: e.date, templateId: e.templateId, workerId: e.workerId })),
    unassigned,
  };
}

// ─── Helper: reason for a shortfall ───────────────────────────────────────────

/** The furthest constraint stage any worker reached before being rejected. */
export function shortfallReason(
  template: ShiftTemplate,
  workers: Worker[],
  roster: Entry[],
  ctx: CheckContext
): ShortfallReasonCode {
  let furthest = 0;
  for (const worker of workers) {
    const code = checkEligibility(worker, template, roster, ctx);
    // A null code cannot happen after fillTemplate; treat it as the last stage defensively.
    const stage = code === null ? REASON_ORDER.length - 1 : REASON_ORDER.indexOf(code);
    furthest = Math.max(furthest, stage);
  }
  return REASON_ORDER[furthest];
}

export function describeReason(code: ShortfallReasonCode, template: ShiftTemplate, date: string): string {
  switch (code) {
    case 'no_role_match':
      return `No workers with role "${template.role}" are registered.`;
    case 'no_availability':
      return `No "${template.role}" workers have availability covering ${template.start}–${template.end} on this day.`;
    case 'overlap':
      return `All eligible "${template.role}" workers have a conflicting shift on ${date}.`;
    case 'max_hours':
      return `All eligible "${template.role}" workers would exceed labor-law hour limits (daily or weekly).`;
    case 'min_rest':
      return `All eligible "${template.role}" workers would break the labor-law minimum rest between shifts.`;
  }
}
