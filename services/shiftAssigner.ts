/**
 * Greedy shift-assignment algorithm with 2-opt local-search improvement.
 *
 * Hard constraints (must satisfy — assignment is rejected if violated):
 *   1. Worker role must match template role
 *   2. Worker availability must fully cover the template window on the shift date
 *   3. No time overlap with other shifts assigned to the same worker on the same date
 *      (including shifts already present in existingRoster)
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

export type AssignmentInput = {
  /** ISO date (YYYY-MM-DD) for which to generate assignments. */
  date: string;
  templates: ShiftTemplate[];
  workers: Worker[];
  /** Already-committed roster entries (any date) used for overlap + fairness checks. */
  existingRoster: Shift[];
  /** Optional business timezone offset for weekday derivation (defaults to device TZ). */
  timezoneOffsetMinutes?: number;
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

/** Fairness score: workers with fewer hours get a higher score. */
const fairnessScore = (workerId: string, accumulatedHours: Map<string, number>): number =>
  1 / (1 + (accumulatedHours.get(workerId) ?? 0));

// ─── Main export ──────────────────────────────────────────────────────────────

export function assignShifts(input: AssignmentInput): AssignmentResult {
  const { date, templates, workers, existingRoster } = input;
  const tzOffset = input.timezoneOffsetMinutes ?? defaultTimezoneOffsetMinutes;

  // Accumulated hours map (seeded from existingRoster for all workers)
  const accumulatedHours = new Map<string, number>();
  for (const worker of workers) {
    accumulatedHours.set(
      worker.id,
      totalHoursForWorker(worker.id, existingRoster, templates)
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
      return true;
    });

    if (candidates.length === 0) {
      unassigned.push({
        templateId: template.id,
        reason: noAssignmentReason(template, workers, date, liveRoster, templates, tzOffset),
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
          workerCoversTemplate(workerB, templateA, date, tzOffset) &&
          !hasTimeOverlap(workerB.id, templateA, date, rosterWithoutBoth, templates);

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
  tzOffset: number
): string {
  const roleMatches = workers.filter((w) => w.role === template.role);
  if (roleMatches.length === 0)
    return `No workers with role "${template.role}" are registered.`;

  const available = roleMatches.filter((w) =>
    workerCoversTemplate(w, template, date, tzOffset)
  );
  if (available.length === 0)
    return `No "${template.role}" workers have availability covering ${template.start}–${template.end} on this day.`;

  return `All eligible "${template.role}" workers have a conflicting shift on ${date}.`;
}
