import {
  isValidTimeZone,
  offsetMinutesAt,
  wallClockAt,
  zonedHHMMToUtc,
  zonedShiftSpan,
  zonedToUtc,
} from '@/utils/zonedTime';

const HOUR = 3600_000;

describe('zonedTime', () => {
  it('converts Lima wall time (no DST) to UTC', () => {
    expect(new Date(zonedHHMMToUtc('2026-10-19', '20:00', 'America/Lima')).toISOString()).toBe('2026-10-20T01:00:00.000Z');
    expect(offsetMinutesAt(Date.UTC(2026, 9, 20), 'America/Lima')).toBe(-300);
  });

  it('reads the wall clock back', () => {
    expect(wallClockAt(Date.UTC(2026, 9, 20, 1, 0), 'America/Lima')).toEqual({ dateKey: '2026-10-19', minuteOfDay: 1200, weekday: 1 });
  });

  it('measures a US fall-back night shift as 9 elapsed hours', () => {
    // 2026-11-01 is the US fall-back Sunday.
    const span = zonedShiftSpan('2026-10-31', '22:00', '06:00', 'America/Los_Angeles');
    expect((span.end - span.start) / HOUR).toBe(9);
  });

  it('measures an Australian spring-forward night shift as 7 elapsed hours', () => {
    // 2026-10-04 is the AU (Sydney) DST start.
    const span = zonedShiftSpan('2026-10-03', '22:00', '06:00', 'Australia/Sydney');
    expect((span.end - span.start) / HOUR).toBe(7);
  });

  it('counts the extra hour across the EU fall-back (Madrid)', () => {
    // 2026-10-25 is the EU fall-back Sunday.
    const end = zonedHHMMToUtc('2026-10-24', '22:00', 'Europe/Madrid');
    const next = zonedHHMMToUtc('2026-10-25', '09:00', 'Europe/Madrid');
    expect((next - end) / HOUR).toBe(12);
  });

  it('resolves a repeated local time to the earlier instant and a skipped one to after the gap', () => {
    const repeated = zonedHHMMToUtc('2026-11-01', '01:30', 'America/New_York');
    expect(new Date(repeated).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    const skipped = zonedHHMMToUtc('2026-03-08', '02:30', 'America/New_York');
    expect(new Date(skipped).toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('resolves a skipped time to after the gap in zones east of UTC+6 (Sydney, Auckland)', () => {
    // Sydney springs forward 2026-10-04 at 02:00 AEST (+10) to 03:00 AEDT (+11).
    const syd = zonedToUtc('2026-10-04', 150, 'Australia/Sydney');
    expect(syd).toBe(Date.UTC(2026, 9, 3, 16, 30));
    expect(wallClockAt(syd, 'Australia/Sydney')).toMatchObject({ dateKey: '2026-10-04', minuteOfDay: 210 });
    // Auckland springs forward 2026-09-27 at 02:00 NZST (+12) to 03:00 NZDT (+13).
    const akl = zonedToUtc('2026-09-27', 150, 'Pacific/Auckland');
    expect(wallClockAt(akl, 'Pacific/Auckland')).toMatchObject({ dateKey: '2026-09-27', minuteOfDay: 210 });
  });

  it('accepts minutes past midnight for the next day', () => {
    expect(zonedToUtc('2026-10-19', 1440 + 60, 'UTC')).toBe(Date.UTC(2026, 9, 20, 1));
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});
