/**
 * Pure, side-effect-free utilities for the scheduler.
 * No React imports — safe to use in hooks, components, and tests alike.
 */
import { addDaysToKey, todayKey, weekdayOfKey } from '@/utils/dateKeys';
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

/** Returns the 3-letter weekday label (e.g. 'Mon') for a YYYY-MM-DD date key.
 *
 *  Shift dates are business-local calendar dates, so the weekday is a property
 *  of the date itself and does not depend on any timezone. The offset
 *  parameter is accepted for backwards compatibility and ignored; shifting the
 *  date by an offset used to return the wrong weekday (e.g. 2024-06-01, a
 *  Saturday, was reported as Friday for UTC-12). */
export const getWeekdayFromDate = (
  value: string,
  _timezoneOffsetMinutes: number = defaultTimezoneOffsetMinutes
): string | null => {
  if (!isValidDate(value)) return null;
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return labels[weekdayOfKey(value)];
};

// ─── Shift window helpers ─────────────────────────────────────────────────────

export const getTemplateWindow = (
  template: ShiftTemplate
): { startMinutes: number; endMinutes: number } => ({
  startMinutes: parseTimeToMinutes(template.start),
  endMinutes: parseTimeToMinutes(template.end),
});

export const MINUTES_PER_DAY = 1440;

/**
 * Normalises a same-start-day window so that overnight windows are contiguous:
 * when `endMinutes <= startMinutes` the window ends on the following day, so
 * `endMinutes` is shifted by 24h (e.g. 22:00–06:00 → 1320–1800, 16:00–00:00 → 960–1440).
 * A window with equal start and end is treated as a full 24h window, matching the
 * duration rule used for shift hours.
 */
export const normalizeWindow = (window: {
  startMinutes: number;
  endMinutes: number;
}): { startMinutes: number; endMinutes: number } => ({
  startMinutes: window.startMinutes,
  endMinutes:
    window.endMinutes <= window.startMinutes
      ? window.endMinutes + MINUTES_PER_DAY
      : window.endMinutes,
});

/**
 * Returns true when two windows that START ON THE SAME DAY overlap (half-open
 * intervals, so touching windows such as 08:00–16:00 and 16:00–00:00 do not overlap).
 * Overnight windows (end <= start) are normalised first, so 22:00–06:00 overlaps 23:00–01:00.
 * Windows starting on different days must be compared with absolute timestamps instead.
 */
export const windowsOverlap = (
  first: { startMinutes: number; endMinutes: number },
  second: { startMinutes: number; endMinutes: number }
): boolean => {
  const a = normalizeWindow(first);
  const b = normalizeWindow(second);
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
};

// ─── ISO date helper ──────────────────────────────────────────────────────────

/** Returns the device-local date key (YYYY-MM-DD) offset by `days` from today. */
export const isoDate = (days: number): string => addDaysToKey(todayKey(), days);

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
