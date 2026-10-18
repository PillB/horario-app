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
 *   - Every shift is converted to an absolute interval [start, end) in minutes on a
 *     continuous business-local timeline (day index × 1440 + minutes). A template whose
 *     end is <= its start is an overnight shift ending on the following day
 *     (22:00–06:00 on Mon runs Mon 22:00 → Tue 06:00; 16:00–00:00 ends at Tue 00:00).
 *     DST transitions are ignored (every day is 24h).
 *   - Availability slots use the same rule (Mon 22:00–06:00 runs into Tuesday). A slot
 *     ending at 23:59 is treated as ending at 24:00, because time inputs cannot express
 *     24:00. Slots from the previous, same and next weekday are merged when they touch,
 *     so Mon 18:00–23:59 + Tue 00:00–08:00 covers a Mon 22:00–06:00 shift.
 *   - Overlap and minimum rest are computed on absolute intervals, so they work across
 *     day boundaries and look at shifts on any date (not only the target date).
 *   - Hours attribution: a shift's full duration counts toward the day (and ISO week)
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
  defaultTimezoneOffsetMinutes,
  getTemplateWindow,
  getWeekdayFromDate,
  normalizeWindow,
  parseTimeToMinutes,
} from '@/utils/schedulerUtils';
import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';

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
  /** Optional business timezone offset for weekday derivation (defaults to device TZ). */
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

/** A roster entry resolved to an absolute interval on the business-local timeline. */
type Entry = {
  workerId: string;
  templateId: string;
  date: string;
  /** Absolute start, in minutes since 1970-01-01 00:00 (business-local wall clock). */
  start: number;
  /** Absolute end (exclusive). */
  end: number;
};

type Interval = { start: number; end: number };

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

/** Absolute interval of `template` when it starts on `date`. */
const shiftInterval = (template: ShiftTemplate, date: string): Interval => {
  const w = normalizeWindow(getTemplateWindow(template));
  const base = dayIndex(date) * MINUTES_PER_DAY;
  return { start: base + w.startMinutes, end: base + w.endMinutes };
};

/** Duration of a template in minutes (overnight-aware). */
const shiftMinutes = (template: ShiftTemplate): number => {
  const w = normalizeWindow(getTemplateWindow(template));
  return w.endMinutes - w.startMinutes;
};

const entryMinutes = (e: Entry): number => e.end - e.start;

/** Absolute interval of an availability slot on `date` (23:59 = end of day, end <= start wraps). */
const availabilityInterval = (from: string, to: string, date: string): Interval => {
  const start = parseTimeToMinutes(from);
  const rawEnd = parseTimeToMinutes(to);
  const end = rawEnd === MINUTES_PER_DAY - 1 ? MINUTES_PER_DAY : rawEnd;
  const w = normalizeWindow({ startMinutes: start, endMinutes: end });
  const base = dayIndex(date) * MINUTES_PER_DAY;
  return { start: base + w.startMinutes, end: base + w.endMinutes };
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

type CheckContext = {
  date: string;
  /** The previous, target and next date with their weekday labels (null when invalid). */
  days: { date: string; label: string | null }[];
  constraints?: LaborConstraints;
};

/** Returns true when the worker's availability covers `interval` (a shift starting on ctx.date). */
const workerCoversInterval = (worker: Worker, interval: Interval, ctx: CheckContext): boolean => {
  const slots: Interval[] = [];
  for (const { date: day, label } of ctx.days) {
    if (!label) continue;
    for (const slot of worker.availability) {
      if (slot.day === label) slots.push(availabilityInterval(slot.from, slot.to, day));
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
const checkEligibility = (
  worker: Worker,
  template: ShiftTemplate,
  others: Entry[],
  ctx: CheckContext
): ShortfallReasonCode | null => {
  if (worker.role !== template.role) return 'no_role_match';

  const interval = shiftInterval(template, ctx.date);
  if (!workerCoversInterval(worker, interval, ctx)) return 'no_availability';

  const mine = others.filter((e) => e.workerId === worker.id);
  if (mine.some((e) => e.start < interval.end && interval.start < e.end)) return 'overlap';

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

/** Fairness score: workers with fewer hours get a higher score. */
const fairnessScore = (workerId: string, accumulatedHours: Map<string, number>): number =>
  1 / (1 + (accumulatedHours.get(workerId) ?? 0));

// ─── Main export ──────────────────────────────────────────────────────────────

export function assignShifts(input: AssignmentInput): AssignmentResult {
  const { date, templates, workers, existingRoster, constraints } = input;
  const tzOffset = input.timezoneOffsetMinutes ?? defaultTimezoneOffsetMinutes;
  const ctx: CheckContext = {
    date,
    days: [-1, 0, 1].map((offset) => {
      const day = offsetDate(date, offset);
      return { date: day, label: getWeekdayFromDate(day, tzOffset) };
    }),
    constraints,
  };

  // Template lookup: full catalog plus today's templates (A6 — existing shifts whose
  // template is not in today's list must still be visible to every check).
  const catalog = new Map<string, ShiftTemplate>();
  for (const t of input.templateCatalog ?? []) catalog.set(t.id, t);
  for (const t of templates) catalog.set(t.id, t);

  const workerById = new Map(workers.map((w) => [w.id, w]));

  // Existing roster resolved to absolute intervals. Entries whose template is unknown
  // cannot be placed on the timeline and are ignored.
  const existing: Entry[] = [];
  for (const shift of existingRoster) {
    const template = catalog.get(shift.templateId);
    if (!template) continue;
    existing.push({
      workerId: shift.workerId,
      templateId: shift.templateId,
      date: shift.date,
      ...shiftInterval(template, shift.date),
    });
  }

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
      assigned.push({ workerId: best.id, templateId: template.id, date, ...shiftInterval(template, date) });
      accumulatedHours.set(best.id, (accumulatedHours.get(best.id) ?? 0) + shiftMinutes(template) / 60);
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

        const hoursA = shiftMinutes(templateA) / 60;
        const hoursB = shiftMinutes(templateB) / 60;
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
function shortfallReason(
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

function describeReason(code: ShortfallReasonCode, template: ShiftTemplate, date: string): string {
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
