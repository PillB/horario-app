/**
 * Pure validation functions for the scheduler.
 * No React — safe to use in hooks, services, and tests.
 */
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import {
  defaultTimezoneOffsetMinutes,
  getTemplateWindow,
  getWeekdayFromDate,
  isValidTime,
  normalizeDay,
  parseTimeToMinutes,
  windowsOverlap,
} from './schedulerUtils';

// ─── findCoveringAvailability ─────────────────────────────────────────────────

/** Returns the availability slot (if any) that fully covers the template window,
 *  taking the business timezone offset into account. */
export const findCoveringAvailability = (
  worker: Worker,
  template: ShiftTemplate,
  date: string,
  timezoneOffsetMinutes = defaultTimezoneOffsetMinutes
): { coveringSlot: Worker['availability'][number] | undefined; weekdayLabel: string | null } => {
  const weekdayLabel = getWeekdayFromDate(date, timezoneOffsetMinutes);
  if (!weekdayLabel) {
    return { coveringSlot: undefined, weekdayLabel: null };
  }

  const templateWindow = getTemplateWindow(template);

  const coveringSlot = worker.availability.find((slot) => {
    if (slot.day !== weekdayLabel) return false;
    const availabilityWindow = {
      startMinutes: parseTimeToMinutes(slot.from),
      endMinutes: parseTimeToMinutes(slot.to),
    };
    return (
      availabilityWindow.startMinutes <= templateWindow.startMinutes &&
      availabilityWindow.endMinutes >= templateWindow.endMinutes
    );
  });

  return { coveringSlot, weekdayLabel };
};

// ─── validateAvailabilitySubmission ──────────────────────────────────────────

export type AvailabilityFormInput = {
  workerId: string;
  day: string;
  from: string;
  to: string;
};

export const validateAvailabilitySubmission = (
  form: AvailabilityFormInput,
  workers: Worker[]
): {
  errors: string[];
  normalizedDay: string | undefined;
  trimmedWorkerId: string;
  trimmedFrom: string;
  trimmedTo: string;
} => {
  const trimmedWorkerId = form.workerId.trim();
  const trimmedDay = form.day.trim();
  const trimmedFrom = form.from.trim();
  const trimmedTo = form.to.trim();

  const errors: string[] = [];
  const normalizedDay = normalizeDay(trimmedDay);

  if (!trimmedWorkerId) errors.push('Worker is required.');
  if (!trimmedDay) errors.push('Day is required.');
  if (!trimmedFrom || !trimmedTo) errors.push('From and to times are required.');

  if (trimmedWorkerId && !workers.some((w) => w.id === trimmedWorkerId))
    errors.push('Worker ID must match an existing worker.');

  if (trimmedDay && !normalizedDay)
    errors.push('Day must be one of Mon, Tue, Wed, Thu, Fri, Sat, or Sun.');

  if (trimmedFrom && !isValidTime(trimmedFrom))
    errors.push('From time must use the 24-hour HH:MM format.');

  if (trimmedTo && !isValidTime(trimmedTo))
    errors.push('To time must use the 24-hour HH:MM format.');

  let fromMinutes: number | null = null;
  let toMinutes: number | null = null;

  if (trimmedFrom && trimmedTo && isValidTime(trimmedFrom) && isValidTime(trimmedTo)) {
    fromMinutes = parseTimeToMinutes(trimmedFrom);
    toMinutes = parseTimeToMinutes(trimmedTo);
    if (fromMinutes >= toMinutes) errors.push('From time must be earlier than to time.');
  }

  if (!errors.length) {
    const worker = workers.find((w) => w.id === trimmedWorkerId);
    const dayKey = normalizedDay ?? trimmedDay;

    if (worker && normalizedDay && fromMinutes !== null && toMinutes !== null) {
      const overlappingSlot = worker.availability.find((slot) => {
        if (slot.day !== normalizedDay) return false;
        const existingWindow = {
          startMinutes: parseTimeToMinutes(slot.from),
          endMinutes: parseTimeToMinutes(slot.to),
        };
        return windowsOverlap(existingWindow, { startMinutes: fromMinutes!, endMinutes: toMinutes! });
      });

      if (overlappingSlot) {
        errors.push(
          `Availability overlaps with an existing interval on ${normalizedDay} from ${overlappingSlot.from} to ${overlappingSlot.to}.`
        );
      }
    }

    if (
      !errors.length &&
      worker?.availability.some(
        (slot) => slot.day === dayKey && slot.from === trimmedFrom && slot.to === trimmedTo
      )
    ) {
      errors.push('This availability interval already exists for the worker.');
    }
  }

  return { errors, normalizedDay, trimmedWorkerId, trimmedFrom, trimmedTo };
};

// ─── validateShiftReadiness ───────────────────────────────────────────────────

/** Validates that a roster shift is ready to publish.
 *  Returns a list of human-readable errors (empty = valid). */
export const validateShiftReadiness = (
  shift: Shift,
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
  workers: Worker[],
  timezoneOffsetMinutes = defaultTimezoneOffsetMinutes
): { errors: string[] } => {
  const errors: string[] = [];
  const template = shiftTemplates.find((t) => t.id === shift.templateId);
  const worker = workers.find((w) => w.id === shift.workerId);
  const weekdayLabel = getWeekdayFromDate(shift.date, timezoneOffsetMinutes);

  if (!template) errors.push('Template is no longer available for this shift.');
  if (!worker) errors.push('Worker is no longer available for this shift.');

  if (template && worker && worker.role !== template.role)
    errors.push(`Worker role (${worker.role}) must match template role (${template.role}).`);

  if (template && worker && weekdayLabel) {
    const { coveringSlot } = findCoveringAvailability(worker, template, shift.date, timezoneOffsetMinutes);
    if (!coveringSlot)
      errors.push(
        `Worker availability on ${weekdayLabel} must cover the template window ${template.start} - ${template.end}.`
      );
  }

  if (template && weekdayLabel) {
    const newWindow = getTemplateWindow(template);
    const overlappingShift = roster.find((existing) => {
      if (existing.id === shift.id) return false;
      if (existing.workerId !== shift.workerId || existing.date !== shift.date) return false;
      const existingTemplate = shiftTemplates.find((t) => t.id === existing.templateId);
      if (!existingTemplate) return false;
      return windowsOverlap(getTemplateWindow(existingTemplate), newWindow);
    });

    if (overlappingShift) {
      const conflictingTemplate = shiftTemplates.find((t) => t.id === overlappingShift.templateId);
      errors.push(
        `Worker already has a shift on ${shift.date} from ${conflictingTemplate?.start ?? '??'} to ${conflictingTemplate?.end ?? '??'}. Adjust the time window to avoid overlaps.`
      );
    }
  }

  return { errors };
};
