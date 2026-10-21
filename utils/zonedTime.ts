/**
 * Wall-clock ↔ instant conversion for an IANA time zone (e.g. "America/Lima").
 *
 * Labor rules and shift windows are written in a location's local wall-clock
 * time, but durations (rest, hours worked) must be measured in elapsed time, so
 * a night shift across a DST change counts 7 or 9 hours, not 8. These helpers
 * use Intl only; they never depend on the device's own time zone.
 */
import { addDaysToKey, isDateKey } from '@/utils/dateKeys';

const MS_PER_MINUTE = 60_000;
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
};

/** True when `timeZone` is an IANA zone this runtime knows. */
export const isValidTimeZone = (timeZone: unknown): timeZone is string => {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
};

export type WallClock = {
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  /** Minutes since local midnight, 0–1439. */
  minuteOfDay: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local wall-clock reading of instant `ms` in `timeZone`. */
export const wallClockAt = (ms: number, timeZone: string): WallClock => {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
};

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (Lima = -300). */
export const offsetMinutesAt = (ms: number, timeZone: string): number => {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MS_PER_MINUTE);
};

export const parseHHMM = (value: string): number => {
  const match = HHMM_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid time "${value}"`);
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * The instant at which the wall clock in `timeZone` reads `dateKey` + `minutes`
 * after midnight. `minutes` may be ≥ 1440 (next day) or negative.
 *
 * DST gaps (a local time that never happens) resolve to the instant after the
 * gap, as a clock that springs forward would read. DST overlaps (a local time
 * that happens twice) resolve to the earlier instant.
 */
export const zonedToUtc = (dateKey: string, minutes: number, timeZone: string): number => {
  if (!isDateKey(dateKey)) throw new RangeError(`Invalid date key: "${dateKey}"`);
  const dayShift = Math.floor(minutes / 1440);
  const key = dayShift === 0 ? dateKey : addDaysToKey(dateKey, dayShift);
  const minuteOfDay = minutes - dayShift * 1440;
  const [y, m, d] = key.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d) + minuteOfDay * MS_PER_MINUTE;

  // Try the offsets in force a day either side; keep candidates that read back
  // as the requested wall time, and pick the earliest.
  const offsets = new Set([
    offsetMinutesAt(naive - 864e5, timeZone),
    offsetMinutesAt(naive, timeZone),
    offsetMinutesAt(naive + 864e5, timeZone),
  ]);
  const matches: number[] = [];
  for (const off of offsets) {
    const candidate = naive - off * MS_PER_MINUTE;
    const wc = wallClockAt(candidate, timeZone);
    if (wc.dateKey === key && wc.minuteOfDay === minuteOfDay) matches.push(candidate);
  }
  if (matches.length) return Math.min(...matches);

  // Inside a spring-forward gap: use the offset in force before the gap, which
  // lands just after it.
  const before = offsetMinutesAt(naive - 6 * 3600_000, timeZone);
  return naive - before * MS_PER_MINUTE;
};

/** Convenience: "YYYY-MM-DD" + "HH:MM" in `timeZone` → epoch ms. */
export const zonedHHMMToUtc = (dateKey: string, hhmm: string, timeZone: string): number =>
  zonedToUtc(dateKey, parseHHMM(hhmm), timeZone);

/**
 * Absolute span of a shift given as local start/end times. An end at or before
 * the start means the shift ends the next local day (overnight).
 *
 * A span that a spring-forward gap makes zero or negative (02:00–03:00 New York
 * on 2026-03-08: both ends resolve to 07:00Z) moves to after the gap with its
 * wall-clock length (03:00–04:00 EDT). This is the auto-assigner's rule
 * (`zonedSpan` in services/shiftAssigner.ts, CHG-087), so the compliance view
 * and auto-assign measure such a shift the same way (CHG-089). Spans that end
 * after the gap keep their elapsed length (01:00–04:00 = 2 h).
 */
export const zonedShiftSpan = (
  dateKey: string,
  startHHMM: string,
  endHHMM: string,
  timeZone: string,
): { start: number; end: number } => {
  const startMin = parseHHMM(startHHMM);
  let endMin = parseHHMM(endHHMM);
  if (endMin <= startMin) endMin += 1440;
  const start = zonedToUtc(dateKey, startMin, timeZone);
  const end = zonedToUtc(dateKey, endMin, timeZone);
  return { start, end: end <= start ? start + (endMin - startMin) * MS_PER_MINUTE : end };
};
