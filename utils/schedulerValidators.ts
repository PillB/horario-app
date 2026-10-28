/**
 * Pure validation functions for the scheduler.
 * No React — safe to use in hooks, services, and tests.
 */
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import {
  MINUTES_PER_DAY,
  defaultTimezoneOffsetMinutes,
  getTemplateWindow,
  getWeekdayFromDate,
  isValidTime,
  normalizeDay,
  normalizeWindow,
  parseTimeToMinutes,
  windowsOverlap,
} from './schedulerUtils';
import { addDaysToKey } from './dateKeys';

// ─── ValidationErrorItem ─────────────────────────────────────────────────────

export type ValidationErrorItem = {
  code: string;
  message: string;
  params?: Record<string, string>;
};

export function localizeValidationErrors(
  errors: ValidationErrorItem[],
  t: (key: string, params?: Record<string, string>) => string
): string[] {
  return errors.map((e) => {
    const localized = t(`errors.validation.${e.code}`, e.params);
    // If key not found, t() returns the key path itself — fall back to English
    return localized.includes('errors.validation.') ? e.message : localized;
  });
}

// ─── findCoveringAvailability ─────────────────────────────────────────────────

/** Returns the availability slot (if any) that fully covers the template window on `date`.
 *
 *  Overnight windows are supported on both sides: a template or slot whose end is at or
 *  before its start runs into the next day (21:00–07:00 covers 22:00–06:00), a slot
 *  ending at 23:59 counts as ending at midnight, and an overnight slot from the previous
 *  weekday covers the early hours of `date` (Mon 21:00–07:00 covers Tue 01:00–05:00).
 *  The weekday is that of the business-local date key; the offset argument is
 *  deprecated and ignored. */
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
  const previousLabel = getWeekdayFromDate(addDaysToKey(date, -1));

  const shift = normalizeWindow(getTemplateWindow(template));

  const coveringSlot = worker.availability.find((slot) => {
    const dayShift = slot.day === weekdayLabel ? 0 : slot.day === previousLabel ? -MINUTES_PER_DAY : null;
    if (dayShift === null) return false;
    const rawEnd = parseTimeToMinutes(slot.to);
    const window = normalizeWindow({
      startMinutes: parseTimeToMinutes(slot.from),
      endMinutes: rawEnd === MINUTES_PER_DAY - 1 ? MINUTES_PER_DAY : rawEnd,
    });
    return (
      window.startMinutes + dayShift <= shift.startMinutes &&
      window.endMinutes + dayShift >= shift.endMinutes
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
  errors: ValidationErrorItem[];
  normalizedDay: string | undefined;
  /** The resolved UUID for the worker (may differ from form input if displayId was entered). */
  trimmedWorkerId: string;
  trimmedFrom: string;
  trimmedTo: string;
} => {
  const trimmedWorkerId = form.workerId.trim();
  const trimmedDay = form.day.trim();
  const trimmedFrom = form.from.trim();
  const trimmedTo = form.to.trim();

  const errors: ValidationErrorItem[] = [];
  const normalizedDay = normalizeDay(trimmedDay);

  if (!trimmedWorkerId) errors.push({ code: 'WORKER_REQUIRED', message: 'Worker is required.' });
  if (!trimmedDay) errors.push({ code: 'DAY_REQUIRED', message: 'Day is required.' });
  if (!trimmedFrom || !trimmedTo) errors.push({ code: 'TIMES_REQUIRED', message: 'From and to times are required.' });

  // Resolve displayId (e.g. "W-1") or raw UUID to the actual worker
  const resolvedWorker = trimmedWorkerId
    ? (workers.find((w) => w.displayId === trimmedWorkerId) ?? workers.find((w) => w.id === trimmedWorkerId))
    : undefined;

  if (trimmedWorkerId && !resolvedWorker)
    errors.push({ code: 'WORKER_NOT_FOUND', message: 'Worker ID must match an existing worker.' });

  if (trimmedDay && !normalizedDay)
    errors.push({ code: 'DAY_INVALID', message: 'Day must be one of Mon, Tue, Wed, Thu, Fri, Sat, or Sun.' });

  if (trimmedFrom && !isValidTime(trimmedFrom))
    errors.push({ code: 'FROM_TIME_INVALID', message: 'From time must use the 24-hour HH:MM format.' });

  if (trimmedTo && !isValidTime(trimmedTo))
    errors.push({ code: 'TO_TIME_INVALID', message: 'To time must use the 24-hour HH:MM format.' });

  let fromMinutes: number | null = null;
  let toMinutes: number | null = null;

  if (trimmedFrom && trimmedTo && isValidTime(trimmedFrom) && isValidTime(trimmedTo)) {
    fromMinutes = parseTimeToMinutes(trimmedFrom);
    toMinutes = parseTimeToMinutes(trimmedTo);
    if (fromMinutes >= toMinutes) errors.push({ code: 'FROM_BEFORE_TO', message: 'From time must be earlier than to time.' });
  }

  if (!errors.length) {
    const worker = resolvedWorker;
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
        errors.push({
          code: 'AVAILABILITY_OVERLAP',
          message: `Availability overlaps with an existing interval on ${normalizedDay} from ${overlappingSlot.from} to ${overlappingSlot.to}.`,
          params: { day: normalizedDay, from: overlappingSlot.from, to: overlappingSlot.to },
        });
      }
    }

    if (
      !errors.length &&
      worker?.availability.some(
        (slot) => slot.day === dayKey && slot.from === trimmedFrom && slot.to === trimmedTo
      )
    ) {
      errors.push({ code: 'AVAILABILITY_DUPLICATE', message: 'This availability interval already exists for the worker.' });
    }
  }

  // Return the real UUID so callers don't need to re-resolve displayId
  const resolvedWorkerId = resolvedWorker?.id ?? trimmedWorkerId;
  return { errors, normalizedDay, trimmedWorkerId: resolvedWorkerId, trimmedFrom, trimmedTo };
};

// ─── validateShiftReadiness ───────────────────────────────────────────────────

/** Validates that a roster shift is ready to publish.
 *  Returns a list of typed error items (empty = valid). */
export const validateShiftReadiness = (
  shift: Shift,
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
  workers: Worker[],
  timezoneOffsetMinutes = defaultTimezoneOffsetMinutes
): { errors: ValidationErrorItem[] } => {
  const errors: ValidationErrorItem[] = [];
  const template = shiftTemplates.find((t) => t.id === shift.templateId);
  const worker = workers.find((w) => w.id === shift.workerId);
  const weekdayLabel = getWeekdayFromDate(shift.date, timezoneOffsetMinutes);

  if (!template) errors.push({ code: 'TEMPLATE_MISSING', message: 'Template is no longer available for this shift.' });
  if (!worker) errors.push({ code: 'WORKER_MISSING', message: 'Worker is no longer available for this shift.' });

  if (template && worker && worker.role !== template.role)
    errors.push({
      code: 'ROLE_MISMATCH',
      message: `Worker role (${worker.role}) must match template role (${template.role}).`,
      params: { workerRole: worker.role, templateRole: template.role },
    });

  if (template && worker && weekdayLabel) {
    const { coveringSlot } = findCoveringAvailability(worker, template, shift.date, timezoneOffsetMinutes);
    if (!coveringSlot)
      errors.push({
        code: 'COVERAGE_MISSING',
        message: `Worker availability on ${weekdayLabel} must cover the template window ${template.start} - ${template.end}.`,
        params: { weekday: weekdayLabel, start: template.start, end: template.end },
      });
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
      errors.push({
        code: 'SHIFT_OVERLAP',
        message: `Worker already has a shift on ${shift.date} from ${conflictingTemplate?.start ?? '??'} to ${conflictingTemplate?.end ?? '??'}. Adjust the time window to avoid overlaps.`,
        params: {
          date: shift.date,
          start: conflictingTemplate?.start ?? '??',
          end: conflictingTemplate?.end ?? '??',
        },
      });
    }
  }

  return { errors };
};
