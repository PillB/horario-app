/**
 * Pure, side-effect-free utilities for the scheduler.
 * No React imports — safe to use in hooks, components, and tests alike.
 */
import { type ShiftTemplate } from '@/utils/schedulerMetrics';

// ─── Form change handler factory ─────────────────────────────────────────────

import React from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

export const defaultTimezoneOffsetMinutes = -new Date().getTimezoneOffset();

// ─── Currency ─────────────────────────────────────────────────────────────────

export const formatCurrency = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

// ─── Date / time validation ───────────────────────────────────────────────────

export const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

export const isValidTime = (value: string): boolean => {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

export const parseTimeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

/** Safe variant — throws RangeError if `value` is not a valid HH:MM time. */
export const parseTimeToMinutesSafe = (value: string): number => {
  if (!isValidTime(value)) throw new RangeError(`Invalid time value: "${value}"`);
  return parseTimeToMinutes(value);
};

// ─── Day normalisation ────────────────────────────────────────────────────────

const DAY_LOOKUP: Record<string, string> = {
  mon: 'Mon', monday: 'Mon',
  tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
  wed: 'Wed', weds: 'Wed', wednesday: 'Wed',
  thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  fri: 'Fri', friday: 'Fri',
  sat: 'Sat', saturday: 'Sat',
  sun: 'Sun', sunday: 'Sun',
};

export const normalizeDay = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed.length > 20) return undefined;
  return DAY_LOOKUP[trimmed.toLowerCase()];
};

// ─── Weekday derivation ───────────────────────────────────────────────────────

/** Returns the 3-letter weekday label (e.g. 'Mon') for an ISO date string,
 *  adjusted for the supplied business timezone offset. */
export const getWeekdayFromDate = (
  value: string,
  timezoneOffsetMinutes = defaultTimezoneOffsetMinutes
): string | null => {
  if (!isValidDate(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;

  const deviceOffset = -parsed.getTimezoneOffset();
  const offsetDelta = timezoneOffsetMinutes - deviceOffset;
  const adjusted = new Date(parsed.getTime() + offsetDelta * 60 * 1000);

  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return labels[adjusted.getDay()];
};

// ─── Shift window helpers ─────────────────────────────────────────────────────

export const getTemplateWindow = (
  template: ShiftTemplate
): { startMinutes: number; endMinutes: number } => ({
  startMinutes: parseTimeToMinutes(template.start),
  endMinutes: parseTimeToMinutes(template.end),
});

export const windowsOverlap = (
  first: { startMinutes: number; endMinutes: number },
  second: { startMinutes: number; endMinutes: number }
): boolean =>
  first.startMinutes < second.endMinutes && second.startMinutes < first.endMinutes;

// ─── ISO date helper ──────────────────────────────────────────────────────────

/** Returns an ISO-8601 date string (YYYY-MM-DD) offset by `days` from today. */
export const isoDate = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Creates a stable change handler for a form state object.
 *  Each returned function updates a single key and calls `onInteraction`. */
export const createChangeHandler =
  <T extends Record<string, string>>(
    setter: React.Dispatch<React.SetStateAction<T>>,
    onInteraction: () => void
  ) =>
  (key: keyof T) =>
  (value: string) => {
    onInteraction();
    setter((prev) => ({ ...prev, [key]: value }));
  };
