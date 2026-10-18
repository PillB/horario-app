import {
  addDaysToKey,
  daysBetweenKeys,
  isDateKey,
  parseDateKey,
  toDateKey,
  todayKey,
  weekdayOfKey,
} from '@/utils/dateKeys';

describe('toDateKey with an explicit IANA time zone', () => {
  it('keeps the Lima calendar date in the evening (UTC is already tomorrow)', () => {
    // 2026-10-17 20:30 in Lima (UTC-5) = 2026-10-18 01:30 UTC
    const instant = new Date('2026-10-18T01:30:00Z');
    expect(toDateKey(instant, 'America/Lima')).toBe('2026-10-17');
  });

  it('regression: the old toISOString().slice(0, 10) approach returned tomorrow in Lima', () => {
    const instant = new Date('2026-10-18T01:30:00Z');
    const oldApproach = instant.toISOString().slice(0, 10);
    expect(oldApproach).toBe('2026-10-18');
    expect(toDateKey(instant, 'America/Lima')).not.toBe(oldApproach);
  });

  it('keeps the Tokyo calendar date in the early morning (UTC is still yesterday)', () => {
    // 2026-10-18 07:00 in Tokyo (UTC+9) = 2026-10-17 22:00 UTC
    const instant = new Date('2026-10-17T22:00:00Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-10-17');
    expect(toDateKey(instant, 'Asia/Tokyo')).toBe('2026-10-18');
  });

  it('handles Europe/Madrid summer (UTC+2) and winter (UTC+1) offsets', () => {
    // 2026-07-15 00:30 in Madrid (CEST) = 2026-07-14 22:30 UTC
    expect(toDateKey(new Date('2026-07-14T22:30:00Z'), 'Europe/Madrid')).toBe('2026-07-15');
    // 2026-01-15 00:30 in Madrid (CET) = 2026-01-14 23:30 UTC
    expect(toDateKey(new Date('2026-01-14T23:30:00Z'), 'Europe/Madrid')).toBe('2026-01-15');
    // 2026-01-14 23:59 in Madrid = 22:59 UTC, still the 14th
    expect(toDateKey(new Date('2026-01-14T22:59:00Z'), 'Europe/Madrid')).toBe('2026-01-14');
  });

  describe('America/New_York across DST change days', () => {
    it('spring forward 2026-03-08: late evening is still the 8th', () => {
      // 23:30 EDT (UTC-4) on 2026-03-08 = 2026-03-09 03:30 UTC
      expect(toDateKey(new Date('2026-03-09T03:30:00Z'), 'America/New_York')).toBe('2026-03-08');
      // 01:59 EST just before the jump = 06:59 UTC
      expect(toDateKey(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe('2026-03-08');
      // 03:00 EDT just after the jump = 07:00 UTC
      expect(toDateKey(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toBe('2026-03-08');
      // 23:30 EST on the day before = 2026-03-08 04:30 UTC
      expect(toDateKey(new Date('2026-03-08T04:30:00Z'), 'America/New_York')).toBe('2026-03-07');
    });

    it('fall back 2026-11-01: both 01:30s and late evening are the 1st', () => {
      // 01:30 EDT (first pass) = 05:30 UTC; 01:30 EST (second pass) = 06:30 UTC
      expect(toDateKey(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01');
      expect(toDateKey(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01');
      // 23:30 EST (UTC-5) = 2026-11-02 04:30 UTC
      expect(toDateKey(new Date('2026-11-02T04:30:00Z'), 'America/New_York')).toBe('2026-11-01');
      // 23:30 EDT on Oct 31 = 2026-11-01 03:30 UTC
      expect(toDateKey(new Date('2026-11-01T03:30:00Z'), 'America/New_York')).toBe('2026-10-31');
    });
  });

  it('handles month and year boundaries', () => {
    // 2026-12-31 22:00 in Lima = 2027-01-01 03:00 UTC
    expect(toDateKey(new Date('2027-01-01T03:00:00Z'), 'America/Lima')).toBe('2026-12-31');
    // 2027-01-01 05:00 in Tokyo = 2026-12-31 20:00 UTC
    expect(toDateKey(new Date('2026-12-31T20:00:00Z'), 'Asia/Tokyo')).toBe('2027-01-01');
    // 2026-10-31 21:00 in New York (EDT) = 2026-11-01 01:00 UTC
    expect(toDateKey(new Date('2026-11-01T01:00:00Z'), 'America/New_York')).toBe('2026-10-31');
  });

  it('returns UTC dates for the UTC zone', () => {
    expect(toDateKey(new Date('2026-10-18T01:30:00Z'), 'UTC')).toBe('2026-10-18');
  });

  it('throws for an invalid Date or unknown zone', () => {
    expect(() => toDateKey(new Date('nope'))).toThrow(RangeError);
    expect(() => toDateKey(new Date(), 'Not/AZone')).toThrow(RangeError);
  });
});

describe('toDateKey without a time zone (device zone)', () => {
  it('uses the local calendar fields of the Date', () => {
    const local = new Date(2026, 2, 8, 23, 45); // 2026-03-08 23:45 device-local
    expect(toDateKey(local)).toBe('2026-03-08');
  });
});

describe('todayKey', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the mocked clock with an explicit zone (Lima evening)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T01:30:00Z'));
    expect(todayKey('America/Lima')).toBe('2026-10-17');
    expect(todayKey('Asia/Tokyo')).toBe('2026-10-18');
    expect(todayKey('UTC')).toBe('2026-10-18');
  });

  it('uses the mocked clock with an explicit zone (Tokyo early morning)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T20:00:00Z'));
    expect(todayKey('Asia/Tokyo')).toBe('2027-01-01');
    expect(todayKey('America/New_York')).toBe('2026-12-31');
  });

  it('defaults to the device-local calendar date', () => {
    const now = new Date(2026, 9, 17, 20, 30); // device-local 20:30
    jest.useFakeTimers().setSystemTime(now);
    expect(todayKey()).toBe('2026-10-17');
  });
});

describe('parseDateKey', () => {
  it('returns a local noon Date on the same calendar day', () => {
    const d = parseDateKey('2026-03-08');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(12);
  });

  it('round-trips with toDateKey for DST and boundary days', () => {
    for (const key of ['2026-03-08', '2026-11-01', '2026-12-31', '2027-01-01', '2024-02-29']) {
      expect(toDateKey(parseDateKey(key))).toBe(key);
    }
  });

  it('rejects malformed and impossible keys', () => {
    expect(() => parseDateKey('2026-02-30')).toThrow(RangeError);
    expect(() => parseDateKey('2026-13-01')).toThrow(RangeError);
    expect(() => parseDateKey('2026-1-01')).toThrow(RangeError);
    expect(() => parseDateKey('')).toThrow(RangeError);
  });
});

describe('addDaysToKey', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysToKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToKey('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('is unaffected by DST change days', () => {
    expect(addDaysToKey('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDaysToKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToKey('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDaysToKey('2026-03-01', 30)).toBe('2026-03-31');
  });

  it('returns the same key for 0', () => {
    expect(addDaysToKey('2026-10-18', 0)).toBe('2026-10-18');
  });
});

describe('weekdayOfKey', () => {
  it('returns the weekday of the calendar date itself', () => {
    expect(weekdayOfKey('2026-10-18')).toBe(0); // Sunday
    expect(weekdayOfKey('2026-03-08')).toBe(0); // Sunday (US DST start)
    expect(weekdayOfKey('2026-11-01')).toBe(0); // Sunday (US DST end)
    expect(weekdayOfKey('2024-06-01')).toBe(6); // Saturday
    expect(weekdayOfKey('2027-01-01')).toBe(5); // Friday
  });

  it('does not depend on the clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T01:30:00Z'));
    expect(weekdayOfKey('2026-10-17')).toBe(6);
    jest.useRealTimers();
  });
});

describe('daysBetweenKeys', () => {
  it('counts whole calendar days across DST and year boundaries', () => {
    expect(daysBetweenKeys('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetweenKeys('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetweenKeys('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetweenKeys('2026-10-18', '2026-10-17')).toBe(-1);
  });
});

describe('isDateKey', () => {
  it('accepts real dates and rejects others', () => {
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2025-02-29')).toBe(false);
    expect(isDateKey('2026-10-18T00:00:00Z')).toBe(false);
  });
});
