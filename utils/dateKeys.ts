/**
 * Pure helpers for calendar date keys ("YYYY-MM-DD").
 *
 * Shift dates in Horario are business-local calendar dates, not UTC instants.
 * `date.toISOString().slice(0, 10)` returns the UTC calendar date, which is
 * tomorrow for users west of UTC in the evening (e.g. Lima 20:00 = 01:00 UTC)
 * and yesterday for users east of UTC in the early morning (e.g. Tokyo 07:00).
 * Use these helpers instead.
 *
 * Arithmetic on keys (`addDaysToKey`, `weekdayOfKey`, `daysBetweenKeys`) is
 * done on the key's own Y/M/D fields via UTC math, so it never depends on the
 * device timezone or DST transitions.
 */

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

const formatKey = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/**
 * Splits a valid date key into its numeric parts. Throws RangeError for
 * malformed keys or impossible calendar dates (e.g. "2024-02-30").
 */
const splitKey = (key: string): { year: number; month: number; day: number } => {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) throw new RangeError(`Invalid date key: "${key}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date key: "${key}"`);
  }
  return { year, month, day };
};

/** UTC-midnight epoch ms for a key — used only for zone-independent arithmetic. */
const keyToUtcMs = (key: string): number => {
  const { year, month, day } = splitKey(key);
  return Date.UTC(year, month - 1, day);
};

const utcMsToKey = (ms: number): string => {
  const d = new Date(ms);
  return formatKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/** Returns true when `key` is a well-formed, real calendar date ("YYYY-MM-DD"). */
export const isDateKey = (key: string): boolean => {
  try {
    splitKey(key);
    return true;
  } catch {
    return false;
  }
};

/**
 * Returns the calendar date (YYYY-MM-DD) of the instant `date` as seen in the
 * IANA `timeZone` (e.g. "America/Lima"). When `timeZone` is omitted the
 * device's local zone is used.
 */
export const toDateKey = (date: Date, timeZone?: string): string => {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid Date');
  if (!timeZone) {
    return formatKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return formatKey(get('year'), get('month'), get('day'));
};

/** Today's calendar date key in `timeZone` (default: device zone). */
export const todayKey = (timeZone?: string): string => toDateKey(new Date(), timeZone);

/**
 * Parses a date key into a device-local Date at 12:00. Noon keeps the Date on
 * the same calendar day across DST transitions (which happen near midnight),
 * unlike `new Date('YYYY-MM-DD')`, which is UTC midnight and displays as the
 * previous day west of UTC.
 */
export const parseDateKey = (key: string): Date => {
  const { year, month, day } = splitKey(key);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

/** Returns the key `days` calendar days after `key` (negative for before). */
export const addDaysToKey = (key: string, days: number): string =>
  utcMsToKey(keyToUtcMs(key) + days * MS_PER_DAY);

/** Weekday of the calendar date itself: 0 = Sunday … 6 = Saturday. */
export const weekdayOfKey = (key: string): number => new Date(keyToUtcMs(key)).getUTCDay();

/** Whole calendar days from `fromKey` to `toKey` (positive when `toKey` is later). */
export const daysBetweenKeys = (fromKey: string, toKey: string): number =>
  Math.round((keyToUtcMs(toKey) - keyToUtcMs(fromKey)) / MS_PER_DAY);
