import {
  formatCurrency,
  getWeekdayFromDate,
  isValidDate,
  isValidTime,
  isoDate,
  normalizeDay,
  parseTimeToMinutes,
  windowsOverlap,
  normalizeWindow,
  getTemplateWindow,
  defaultTimezoneOffsetMinutes,
} from '../schedulerUtils';
import { type ShiftTemplate } from '@/utils/schedulerMetrics';

describe('formatCurrency', () => {
  it('formats zero', () => expect(formatCurrency(0)).toBe('$0'));
  it('formats positive integer', () => expect(formatCurrency(1250)).toBe('$1,250'));
  it('rounds fractional values', () => expect(formatCurrency(99.7)).toBe('$100'));
});

describe('isValidDate', () => {
  it('accepts valid ISO dates', () => {
    expect(isValidDate('2024-12-15')).toBe(true);
    expect(isValidDate('2000-01-01')).toBe(true);
  });
  it('rejects invalid formats', () => {
    expect(isValidDate('2024-13-01')).toBe(false);
    expect(isValidDate('24-12-15')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});

describe('isValidTime', () => {
  it('accepts valid HH:MM times', () => {
    expect(isValidTime('09:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('00:00')).toBe(true);
  });
  it('rejects invalid formats', () => {
    expect(isValidTime('9:00')).toBe(false);
    expect(isValidTime('25:00')).toBe(false);
    expect(isValidTime('09:60')).toBe(false);
    expect(isValidTime('')).toBe(false);
  });
});

describe('parseTimeToMinutes', () => {
  it('converts HH:MM to minutes since midnight', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('17:30')).toBe(1050);
  });
});

describe('normalizeDay', () => {
  it('normalizes full day names', () => {
    expect(normalizeDay('monday')).toBe('Mon');
    expect(normalizeDay('Friday')).toBe('Fri');
    expect(normalizeDay('SUNDAY')).toBe('Sun');
  });
  it('normalizes abbreviations', () => {
    expect(normalizeDay('Mon')).toBe('Mon');
    expect(normalizeDay('Tue')).toBe('Tue');
    expect(normalizeDay('Thur')).toBe('Thu');
  });
  it('returns undefined for unknown values', () => {
    expect(normalizeDay('holiday')).toBeUndefined();
    expect(normalizeDay('')).toBeUndefined();
  });
});

describe('getWeekdayFromDate', () => {
  it('returns the weekday of the calendar date regardless of timezone offset', () => {
    // 2024-06-01 is a Saturday as a business-local calendar date in every zone.
    expect(getWeekdayFromDate('2024-06-01', -720)).toBe('Sat');
    expect(getWeekdayFromDate('2024-06-01', 540)).toBe('Sat');
    expect(getWeekdayFromDate('2024-06-01')).toBe('Sat');
  });
  it('returns null for invalid dates', () => {
    expect(getWeekdayFromDate('not-a-date')).toBeNull();
    expect(getWeekdayFromDate('2024-13-01')).toBeNull();
  });
  it('returns Monday for 2024-12-16 without an offset', () => {
    expect(getWeekdayFromDate('2024-12-16')).toBe('Mon');
  });
});

describe('getTemplateWindow', () => {
  const template: ShiftTemplate = {
    id: 'morning',
    name: 'Morning',
    role: 'Support',
    start: '09:00',
    end: '17:00',
    coverage: 2,
  };
  it('returns start and end in minutes', () => {
    expect(getTemplateWindow(template)).toEqual({ startMinutes: 540, endMinutes: 1020 });
  });
});

describe('windowsOverlap', () => {
  it('detects overlapping windows', () => {
    expect(windowsOverlap({ startMinutes: 0, endMinutes: 600 }, { startMinutes: 300, endMinutes: 900 })).toBe(true);
  });
  it('does not flag adjacent windows as overlapping', () => {
    expect(windowsOverlap({ startMinutes: 0, endMinutes: 600 }, { startMinutes: 600, endMinutes: 900 })).toBe(false);
  });
  it('does not flag non-overlapping windows', () => {
    expect(windowsOverlap({ startMinutes: 0, endMinutes: 300 }, { startMinutes: 600, endMinutes: 900 })).toBe(false);
  });
  // A4 regression: windows crossing midnight
  it('detects overlap between an overnight window and a late-evening window', () => {
    // 22:00–06:00 vs 23:00–23:30
    expect(windowsOverlap({ startMinutes: 1320, endMinutes: 360 }, { startMinutes: 1380, endMinutes: 1410 })).toBe(true);
  });
  it('detects overlap between two overnight windows', () => {
    // 22:00–06:00 vs 23:00–01:00
    expect(windowsOverlap({ startMinutes: 1320, endMinutes: 360 }, { startMinutes: 1380, endMinutes: 60 })).toBe(true);
  });
  it('does not flag a window ending at midnight and one starting right after it on the same day', () => {
    // 08:00–16:00 vs 16:00–00:00 (touching)
    expect(windowsOverlap({ startMinutes: 480, endMinutes: 960 }, { startMinutes: 960, endMinutes: 0 })).toBe(false);
  });
});

describe('normalizeWindow', () => {
  it('leaves a same-day window untouched', () => {
    expect(normalizeWindow({ startMinutes: 540, endMinutes: 1020 })).toEqual({ startMinutes: 540, endMinutes: 1020 });
  });
  it('extends an overnight window into the next day', () => {
    expect(normalizeWindow({ startMinutes: 1320, endMinutes: 360 })).toEqual({ startMinutes: 1320, endMinutes: 1800 });
  });
  it('treats an end of 00:00 as midnight of the next day', () => {
    expect(normalizeWindow({ startMinutes: 960, endMinutes: 0 })).toEqual({ startMinutes: 960, endMinutes: 1440 });
  });
});

describe('isoDate', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  it('returns the device-local date for offset 0 (not the UTC date)', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 17, 23, 30)); // local 23:30
    expect(isoDate(0)).toBe('2026-10-17');
    expect(isoDate(1)).toBe('2026-10-18');
    expect(isoDate(-17)).toBe('2026-09-30');
  });
  it('returns YYYY-MM-DD format', () => {
    expect(isoDate(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('defaultTimezoneOffsetMinutes', () => {
  it('is a finite number', () => {
    expect(Number.isFinite(defaultTimezoneOffsetMinutes)).toBe(true);
  });
});
