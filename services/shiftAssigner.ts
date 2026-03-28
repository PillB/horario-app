/**
 * Greedy shift-assignment algorithm with 2-opt local-search improvement.
 *
 * Hard constraints (must satisfy — assignment is rejected if violated):
 *   1. Worker role must match template role
 *   2. Worker availability must fully cover the template window on the shift date
 *   3. No time overlap with other shifts assigned to the same worker on the same date
 *      (including shifts already present in existingRoster)
 *   4. (optional) Max daily hours per worker must not be exceeded
 *   5. (optional) Max weekly hours per worker (ISO week Mon–Sun) must not be exceeded
 *   6. (optional) Minimum rest hours between consecutive shifts must be observed
 *
 * Soft scoring (higher = preferred):
 *   - Fairness: workers with fewer total assigned hours are preferred
 *     Score contribution: 1 / (1 + existingHoursForWorker)
 *
 * Algorithm:
 *   1. Build a priority queue of (template, worker) pairs sorted by score desc
 *   2. Greedy first-fit: assign best-scored eligible pair, marking worker+slot as used
 *   3. 2-opt local swap: try swapping any two assignments to see if fairness improves
 *
 * Pure function — no side effects, no React imports.
 */
import { type Shift, type ShiftTemplate } from '@/app/(tabs)/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import {
  defaultTimezoneOffsetMinutes,
  getTemplateWindow,
  getWeekdayFromDate,
  parseTimeToMinutes,
  windowsOverlap,
} from '@/utils/schedulerUtils';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Optional labor-law hard constraints applied during assignment.
 * All limits are inclusive upper bounds; omit a field to disable that check.
 */
export type LaborConstraints = {
  /** Maximum hours a worker may work in a single calendar day (e.g. 10). */
  maxDailyHours?: number;
  /** Maximum hours a worker may work in an ISO calendar week Mon–Sun (e.g. 48). */
  maxWeeklyHours?: number;
  /** Minimum rest hours required between the end of one shift and the start of the next (e.g. 8). */
  minRestHoursBetweenShifts?: number;
};

export type AssignmentInput = {
  /** ISO date (YYYY-MM-DD) for which to generate assignments. */
  date: string;
  /** Shift templates to be assigned on this date. */
  templates: ShiftTemplate[];
  /**
   * Full template catalog used to look up shift durations for existingRoster entries.
   * If omitted, falls back to `templates`. Pass all known templates when existingRoster
   * contains shifts whose templates are not in the current day's `templates` list.
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

export type UnassignedTemplate = {
  templateId: string;
  reason: string;
};

export type AssignmentResult = {
  assignments: AssignedShift[];
  unassigned: UnassignedTemplate[];
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Returns the total scheduled hours for a worker across all shifts in a list. */
const totalHoursForWorker = (workerId: string, shifts: Shift[], templates: ShiftTemplate[]): number =>
  shifts.reduce((total, shift) => {
    if (shift.workerId !== workerId) return total;
    const template = templates.find((t) => t.id === shift.templateId);
    if (!template) return total;
    const { startMinutes, endMinutes } = getTemplateWindow(template);
    // Handle overnight shifts (end < start, e.g. 16:00–00:00)
    const hours =
      endMinutes > startMinutes
        ? (endMinutes - startMinutes) / 60
        : (endMinutes + 1440 - startMinutes) / 60;
    return total + hours;
  }, 0);

/** Returns true when the worker's availability covers the template window on the given date. */
const workerCoversTemplate = (
  worker: Worker,
  template: ShiftTemplate,
  date: string,
  tzOffset: number
): boolean => {
  const weekdayLabel = getWeekdayFromDate(date, tzOffset);
  if (!weekdayLabel) return false;

  const { startMinutes: tmplStart, endMinutes: tmplEnd } = getTemplateWindow(template);

  return worker.availability.some((slot) => {
    if (slot.day !== weekdayLabel) return false;
    const slotStart = parseTimeToMinutes(slot.from);
    const slotEnd = parseTimeToMinutes(slot.to);
    return slotStart <= tmplStart && slotEnd >= tmplEnd;
  });
};

/** Returns true when adding this template window to the worker's day would overlap
 *  with any existing committed window (from existingRoster + already-assigned templates). */
const hasTimeOverlap = (
  workerId: string,
  newTemplate: ShiftTemplate,
  date: string,
  allShifts: Shift[],
  allTemplates: ShiftTemplate[]
): boolean => {
  const newWindow = getTemplateWindow(newTemplate);
  return allShifts.some((shift) => {
    if (shift.workerId !== workerId || shift.date !== date) return false;
    const existingTemplate = allTemplates.find((t) => t.id === shift.templateId);
    if (!existingTemplate) return false;
    return windowsOverlap(getTemplateWindow(existingTemplate), newWindow);
  });
};

/** Returns an ISO date string offset by `days` from the given ISO date. */
const offsetDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Returns the Monday and Sunday (inclusive) of the ISO calendar week containing `date`.
 * Exported for unit testing.
 */
export const getWeekBounds = (date: string): { weekStart: string; weekEnd: string } => {
  const d = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysFromMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
};

/** Total scheduled hours for a worker on a specific calendar date. */
const dailyHoursForWorker = (
  workerId: string,
  date: string,
  shifts: Shift[],
  templates: ShiftTemplate[]
): number =>
  shifts.reduce((total, shift) => {
    if (shift.workerId !== workerId || shift.date !== date) return total;
    const template = templates.find((t) => t.id === shift.templateId);
    return template ? total + getShiftHours(template, templates) : total;
  }, 0);

/** Total scheduled hours for a worker within an ISO week (weekStart–weekEnd inclusive). */
const weeklyHoursForWorker = (
  workerId: string,
  weekStart: string,
  weekEnd: string,
  shifts: Shift[],
  templates: ShiftTemplate[]
): number =>
  shifts.reduce((total, shift) => {
    if (shift.workerId !== workerId) return total;
    if (shift.date < weekStart || shift.date > weekEnd) return total;
    const template = templates.find((t) => t.id === shift.templateId);
    return template ? total + getShiftHours(template, templates) : total;
  }, 0);

/**
 * Returns true when adding `newTemplate` to `workerId` on `date` would push their
 * daily total above `maxDailyHours`.
 */
const exceedsDailyHours = (
  workerId: string,
  newTemplate: ShiftTemplate,
  date: string,
  allShifts: Shift[],
  allTemplates: ShiftTemplate[],
  maxDailyHours: number
): boolean => {
  const existing = dailyHoursForWorker(workerId, date, allShifts, allTemplates);
  return existing + getShiftHours(newTemplate, allTemplates) > maxDailyHours;
};

/**
 * Returns true when adding `newTemplate` to `workerId` on `date` would push their
 * weekly total above `maxWeeklyHours`.
 */
const exceedsWeeklyHours = (
  workerId: string,
  newTemplate: ShiftTemplate,
  date: string,
  allShifts: Shift[],
  allTemplates: ShiftTemplate[],
  maxWeeklyHours: number
): boolean => {
  const { weekStart, weekEnd } = getWeekBounds(date);
  const existing = weeklyHoursForWorker(workerId, weekStart, weekEnd, allShifts, allTemplates);
  return existing + getShiftHours(newTemplate, allTemplates) > maxWeeklyHours;
};

/**
 * Returns true when the gap between `newTemplate` and any existing shift for `workerId`
 * on the same or adjacent dates is shorter than `minRestHours`.
 *
 * Converts all windows to "minutes relative to midnight of `date`" so cross-midnight
 * gaps (e.g. shift ending 23:00 yesterday, new shift starting 06:00 today) are correctly
 * compared. Overnight shifts (endMinutes < startMinutes) are not supported and are skipped.
 */
const violatesMinRest = (
  workerId: string,
  newTemplate: ShiftTemplate,
  date: string,
  allShifts: Shift[],
  allTemplates: ShiftTemplate[],
  minRestHours: number
): boolean => {
  const minRestMinutes = minRestHours * 60;
  const newWindow = getTemplateWindow(newTemplate);
  // Skip overnight templates for min-rest purposes (end < start would make arithmetic ambiguous)
  if (newWindow.endMinutes <= newWindow.startMinutes) return false;

  const prevDate = offsetDate(date, -1);
  const nextDate = offsetDate(date, 1);

  for (const shift of allShifts) {
    if (shift.workerId !== workerId) continue;
    if (shift.date !== prevDate && shift.date !== date && shift.date !== nextDate) continue;

    const tmpl = allTemplates.find((t) => t.id === shift.templateId);
    if (!tmpl) continue;
    const w = getTemplateWindow(tmpl);
    if (w.endMinutes <= w.startMinutes) continue; // skip overnight existing shifts too

    // Offset shift window to minutes relative to midnight of `date`
    const dayOffset = shift.date === prevDate ? -1440 : shift.date === nextDate ? 1440 : 0;
    const shiftStart = w.startMinutes + dayOffset;
    const shiftEnd = w.endMinutes + dayOffset;

    // Gap when new shift follows the existing shift
    if (shiftEnd <= newWindow.startMinutes && newWindow.startMinutes - shiftEnd < minRestMinutes) {
      return true;
    }
    // Gap when new shift precedes the existing shift
    if (newWindow.endMinutes <= shiftStart && shiftStart - newWindow.endMinutes < minRestMinutes) {
      return true;
    }
  }

  return false;
};

/** Returns true if `workerId` passes all active labor-law constraints for `newTemplate` on `date`. */
const passesConstraints = (
  workerId: string,
  newTemplate: ShiftTemplate,
  date: string,
  allShifts: Shift[],
  allTemplates: ShiftTemplate[],
  constraints: LaborConstraints
): boolean => {
  if (
    constraints.maxDailyHours !== undefined &&
    exceedsDailyHours(workerId, newTemplate, date, allShifts, allTemplates, constraints.maxDailyHours)
  ) return false;
  if (
    constraints.maxWeeklyHours !== undefined &&
    exceedsWeeklyHours(workerId, newTemplate, date, allShifts, allTemplates, constraints.maxWeeklyHours)
  ) return false;
  if (
    constraints.minRestHoursBetweenShifts !== undefined &&
    violatesMinRest(workerId, newTemplate, date, allShifts, allTemplates, constraints.minRestHoursBetweenShifts)
  ) return false;
  return true;
};

/** Fairness score: workers with fewer hours get a higher score. */
const fairnessScore = (workerId: string, accumulatedHours: Map<string, number>): number =>
  1 / (1 + (accumulatedHours.get(workerId) ?? 0));

// ─── Main export ──────────────────────────────────────────────────────────────

export function assignShifts(input: AssignmentInput): AssignmentResult {
  const { date, templates, workers, existingRoster, constraints } = input;
  const tzOffset = input.timezoneOffsetMinutes ?? defaultTimezoneOffsetMinutes;
  // Use templateCatalog for historical lookups; fall back to templates for the current day
  const catalog = input.templateCatalog ?? templates;

  // Accumulated hours map (seeded from existingRoster for all workers)
  const accumulatedHours = new Map<string, number>();
  for (const worker of workers) {
    accumulatedHours.set(
      worker.id,
      totalHoursForWorker(worker.id, existingRoster, catalog)
    );
  }

  // Live roster for this date (grows as we assign)
  const liveRoster: Shift[] = [...existingRoster];

  const assignments: AssignedShift[] = [];
  const unassigned: UnassignedTemplate[] = [];

  for (const template of templates) {
    // Find all eligible workers for this template
    const candidates = workers.filter((worker) => {
      if (worker.role !== template.role) return false;
      if (!workerCoversTemplate(worker, template, date, tzOffset)) return false;
      if (hasTimeOverlap(worker.id, template, date, liveRoster, templates)) return false;
      if (constraints && !passesConstraints(worker.id, template, date, liveRoster, catalog, constraints)) return false;
      return true;
    });

    if (candidates.length === 0) {
      unassigned.push({
        templateId: template.id,
        reason: noAssignmentReason(template, workers, date, liveRoster, catalog, tzOffset, constraints),
      });
      continue;
    }

    // Score and sort candidates (highest score first)
    const scored = candidates.map((worker) => ({
      worker,
      score: fairnessScore(worker.id, accumulatedHours),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0].worker;
    const { startMinutes, endMinutes } = getTemplateWindow(template);
    const hours =
      endMinutes > startMinutes
        ? (endMinutes - startMinutes) / 60
        : (endMinutes + 1440 - startMinutes) / 60;

    // Commit assignment
    assignments.push({ date, templateId: template.id, workerId: best.id });
    accumulatedHours.set(best.id, (accumulatedHours.get(best.id) ?? 0) + hours);

    // Record in live roster for overlap checks on subsequent templates
    liveRoster.push({
      id: `new::${date}::${template.id}::${best.id}`,
      date,
      workerId: best.id,
      templateId: template.id,
      location: 'HQ',
      status: 'Draft',
      notified: false,
    });
  }

  // ── 2-opt local swap improvement ──────────────────────────────────────────
  // Try swapping any two assignments to improve fairness.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a = assignments[i];
        const b = assignments[j];

        const templateA = templates.find((t) => t.id === a.templateId)!;
        const templateB = templates.find((t) => t.id === b.templateId)!;
        const workerA = workers.find((w) => w.id === a.workerId)!;
        const workerB = workers.find((w) => w.id === b.workerId)!;

        if (!templateA || !templateB || !workerA || !workerB) continue;
        // Can only swap if roles match the swapped templates
        if (workerA.role !== templateB.role || workerB.role !== templateA.role) continue;

        // Build roster without these two assignments
        const rosterWithoutBoth = liveRoster.filter(
          (s) =>
            !(s.workerId === a.workerId && s.templateId === a.templateId && s.date === a.date) &&
            !(s.workerId === b.workerId && s.templateId === b.templateId && s.date === b.date)
        );

        // Check if workerA can cover templateB and workerB can cover templateA after swap
        const canSwap =
          workerCoversTemplate(workerA, templateB, date, tzOffset) &&
          !hasTimeOverlap(workerA.id, templateB, date, rosterWithoutBoth, templates) &&
          (!constraints || passesConstraints(workerA.id, templateB, date, rosterWithoutBoth, catalog, constraints)) &&
          workerCoversTemplate(workerB, templateA, date, tzOffset) &&
          !hasTimeOverlap(workerB.id, templateA, date, rosterWithoutBoth, templates) &&
          (!constraints || passesConstraints(workerB.id, templateA, date, rosterWithoutBoth, catalog, constraints));

        if (!canSwap) continue;

        // Evaluate if swap improves total fairness score
        const currentScore =
          fairnessScore(a.workerId, accumulatedHours) +
          fairnessScore(b.workerId, accumulatedHours);

        // Temporarily swap hours
        const hoursA = getShiftHours(templateA, templates);
        const hoursB = getShiftHours(templateB, templates);
        const swappedHours = new Map(accumulatedHours);
        swappedHours.set(a.workerId, (swappedHours.get(a.workerId) ?? 0) - hoursA + hoursB);
        swappedHours.set(b.workerId, (swappedHours.get(b.workerId) ?? 0) - hoursB + hoursA);

        const swappedScore =
          fairnessScore(a.workerId, swappedHours) + fairnessScore(b.workerId, swappedHours);

        if (swappedScore > currentScore + 0.001) {
          // Apply swap
          assignments[i] = { ...a, workerId: b.workerId };
          assignments[j] = { ...b, workerId: a.workerId };
          accumulatedHours.set(a.workerId, swappedHours.get(a.workerId)!);
          accumulatedHours.set(b.workerId, swappedHours.get(b.workerId)!);
          improved = true;
        }
      }
    }
  }

  return { assignments, unassigned };
}

// ─── Helper: shift hours ──────────────────────────────────────────────────────

function getShiftHours(template: ShiftTemplate, _templates: ShiftTemplate[]): number {
  const { startMinutes, endMinutes } = getTemplateWindow(template);
  return endMinutes > startMinutes
    ? (endMinutes - startMinutes) / 60
    : (endMinutes + 1440 - startMinutes) / 60;
}

// ─── Helper: human-readable reason for no assignment ─────────────────────────

function noAssignmentReason(
  template: ShiftTemplate,
  workers: Worker[],
  date: string,
  liveRoster: Shift[],
  templates: ShiftTemplate[],
  tzOffset: number,
  constraints?: LaborConstraints
): string {
  const roleMatches = workers.filter((w) => w.role === template.role);
  if (roleMatches.length === 0)
    return `No workers with role "${template.role}" are registered.`;

  const available = roleMatches.filter((w) =>
    workerCoversTemplate(w, template, date, tzOffset)
  );
  if (available.length === 0)
    return `No "${template.role}" workers have availability covering ${template.start}–${template.end} on this day.`;

  if (constraints) {
    const passConstraint = available.filter((w) =>
      passesConstraints(w.id, template, date, liveRoster, templates, constraints)
    );
    if (passConstraint.length === 0)
      return `All eligible "${template.role}" workers would exceed labor-law limits (daily/weekly hours or minimum rest).`;
  }

  return `All eligible "${template.role}" workers have a conflicting shift on ${date}.`;
}
