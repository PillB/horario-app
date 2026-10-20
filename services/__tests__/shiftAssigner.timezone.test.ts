/**
 * QA finding R7: the assigner places shifts with an IANA business time zone, so hours
 * and rest are elapsed time across DST changes. These tests set `timeZone` explicitly
 * and must pass whatever zone the machine runs in (run them under TZ=UTC, Asia/Tokyo,
 * America/Lima).
 */
import { assignShifts, type AssignmentInput } from '../shiftAssigner';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import { getBusinessTimeZone, getDeviceTimeZone } from '@/utils/businessTimeZone';

const tpl = (id: string, start: string, end: string): ShiftTemplate => ({
  id,
  name: id,
  role: 'Nurse',
  start,
  end,
  coverage: 1,
});

const ALL_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => ({ day, from: '00:00', to: '23:59' }));

const worker = (id: string, availability: Worker['availability'] = ALL_DAY): Worker => ({
  id,
  displayId: id,
  name: id,
  role: 'Nurse',
  skills: [],
  availability,
});

const shift = (id: string, date: string, templateId: string, workerId = 'ana'): Shift => ({
  id,
  date,
  workerId,
  templateId,
  location: 'HQ',
  status: 'Published',
  notified: false,
});

const DAY = tpl('day', '09:00', '17:00');
const LATE = tpl('late', '14:00', '22:00');
const NIGHT = tpl('night', '22:00', '06:00');

const run = (overrides: Partial<AssignmentInput> & Pick<AssignmentInput, 'date'>) =>
  assignShifts({
    templates: [NIGHT],
    templateCatalog: [DAY, LATE, NIGHT],
    workers: [worker('ana')],
    existingRoster: [],
    ...overrides,
  });

/** Four 8h day shifts earlier in the ISO week of `monday`: 32h. */
const fourDayShifts = (monday: string): Shift[] =>
  [0, 1, 2, 3].map((i) => {
    const d = new Date(`${monday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return shift(`d${i}`, d.toISOString().slice(0, 10), 'day');
  });

describe('assignShifts with an IANA time zone — America/New_York', () => {
  const timeZone = 'America/New_York';

  it('counts the Sat 22:00–06:00 night before the 2026-11-01 fall-back as 9h toward max weekly hours', () => {
    const existingRoster = fourDayShifts('2026-10-26'); // 32h, Mon–Thu
    // 32 + 9 = 41 > 40: rejected. With a 24h-day model it would be 32 + 8 = 40 and pass.
    const capped = run({ date: '2026-10-31', timeZone, existingRoster, constraints: { maxWeeklyHours: 40 } });
    expect(capped.assignments).toEqual([]);
    expect(capped.unassigned[0].reasonCode).toBe('max_hours');

    const roomy = run({ date: '2026-10-31', timeZone, existingRoster, constraints: { maxWeeklyHours: 41 } });
    expect(roomy.assignments).toEqual([{ date: '2026-10-31', templateId: 'night', workerId: 'ana' }]);

    // The deprecated fixed-offset model still treats every day as 24h.
    const fixed = run({ date: '2026-10-31', timezoneOffsetMinutes: -240, existingRoster, constraints: { maxWeeklyHours: 40 } });
    expect(fixed.assignments).toHaveLength(1);
  });

  it('rejects the fall-back night for an 8h daily cap but accepts the same night a week earlier', () => {
    expect(run({ date: '2026-10-31', timeZone, constraints: { maxDailyHours: 8 } }).assignments).toEqual([]);
    expect(run({ date: '2026-10-24', timeZone, constraints: { maxDailyHours: 8 } }).assignments).toHaveLength(1);
  });

  it('counts the Sat 22:00–06:00 night before the 2026-03-08 spring-forward as 7h', () => {
    const existingRoster = fourDayShifts('2026-03-02'); // 32h
    // 32 + 7 = 39 fits a 39h cap; the same night a week earlier (8h) does not.
    expect(run({ date: '2026-03-07', timeZone, existingRoster, constraints: { maxWeeklyHours: 39 } }).assignments).toHaveLength(1);
    expect(
      run({ date: '2026-02-28', timeZone, existingRoster: fourDayShifts('2026-02-23'), constraints: { maxWeeklyHours: 39 } })
        .assignments,
    ).toEqual([]);
  });

  it('loses the spring-forward hour in rest: Sat 22:00 → Sun 09:00 is 10h, short of an 11h rule', () => {
    const result = run({
      date: '2026-03-08',
      timeZone,
      templates: [DAY],
      existingRoster: [shift('late', '2026-03-07', 'late')],
      constraints: { minRestHoursBetweenShifts: 11 },
    });
    expect(result.assignments).toEqual([]);
    expect(result.unassigned[0].reasonCode).toBe('min_rest');
  });

  it('accepts availability Sat 21:00–07:00 for the 9h fall-back night shift', () => {
    const result = run({ date: '2026-10-31', timeZone, workers: [worker('ana', [{ day: 'Sat', from: '21:00', to: '07:00' }])] });
    expect(result.assignments).toHaveLength(1);
  });
});

describe('assignShifts with an IANA time zone — Europe/Madrid (QA golden case DST-ES-01)', () => {
  const timeZone = 'Europe/Madrid';
  const sundayDay = (date: string, prev: string, options: Partial<AssignmentInput>) =>
    run({
      date,
      templates: [DAY],
      existingRoster: [shift('late', prev, 'late')],
      constraints: { minRestHoursBetweenShifts: 12 },
      ...options,
    });

  it('passes a 12h rest rule because the 2026-10-25 fall-back hour counts (Sat 22:00 → Sun 09:00 = 12h)', () => {
    const result = sundayDay('2026-10-25', '2026-10-24', { timeZone });
    expect(result.assignments).toEqual([{ date: '2026-10-25', templateId: 'day', workerId: 'ana' }]);
  });

  it('fails the same 12h rule on an ordinary weekend (11h) and under the fixed-offset model', () => {
    expect(sundayDay('2026-10-18', '2026-10-17', { timeZone }).unassigned[0].reasonCode).toBe('min_rest');
    expect(sundayDay('2026-10-25', '2026-10-24', { timezoneOffsetMinutes: 120 }).unassigned[0].reasonCode).toBe('min_rest');
  });

  it('counts the fall-back night as 9h toward max weekly hours', () => {
    const existingRoster = fourDayShifts('2026-10-19');
    expect(run({ date: '2026-10-24', timeZone, existingRoster, constraints: { maxWeeklyHours: 40 } }).assignments).toEqual([]);
    expect(run({ date: '2026-10-24', timeZone, existingRoster, constraints: { maxWeeklyHours: 41 } }).assignments).toHaveLength(1);
  });
});

describe('assignShifts with an IANA time zone — Australia/Sydney', () => {
  const timeZone = 'Australia/Sydney';

  it('measures the Sat 22:00–06:00 night before the 2026-10-04 spring-forward as 7h', () => {
    expect(run({ date: '2026-10-03', timeZone, constraints: { maxDailyHours: 7 } }).assignments).toHaveLength(1);
    expect(run({ date: '2026-09-26', timeZone, constraints: { maxDailyHours: 7 } }).assignments).toEqual([]);
  });

  it('uses the local Sunday for availability, although the shift starts on Saturday UTC', () => {
    // Sun 2026-10-04 09:00 in Sydney is Sat 22:00 UTC.
    const result = run({ date: '2026-10-04', timeZone, templates: [DAY], workers: [worker('ana', [{ day: 'Sun', from: '08:00', to: '18:00' }])] });
    expect(result.assignments).toHaveLength(1);
  });
});

describe('assignShifts with an IANA time zone — America/Lima (no DST)', () => {
  const timeZone = 'America/Lima';

  it('keeps every night shift at 8h, including US/EU DST weekends', () => {
    for (const date of ['2026-03-07', '2026-10-24', '2026-10-31', '2026-10-03']) {
      expect(run({ date, timeZone, constraints: { maxDailyHours: 8 } }).assignments).toHaveLength(1);
      expect(run({ date, timeZone, constraints: { maxDailyHours: 7 } }).assignments).toEqual([]);
    }
  });

  it('matches the fixed-offset model exactly', () => {
    const input = {
      date: '2026-10-31',
      templates: [NIGHT, DAY, LATE],
      workers: [worker('ana'), worker('bo'), worker('cy')],
      existingRoster: [shift('x', '2026-10-30', 'late', 'bo')],
      constraints: { maxDailyHours: 10, minRestHoursBetweenShifts: 11 },
    };
    expect(run({ ...input, timeZone })).toEqual(run({ ...input, timezoneOffsetMinutes: -300 }));
  });
});

describe('assignShifts time zone selection', () => {
  it('defaults to the device zone when neither timeZone nor timezoneOffsetMinutes is given', () => {
    const input = { date: '2026-10-31', existingRoster: fourDayShifts('2026-10-26'), constraints: { maxWeeklyHours: 40 } };
    expect(run(input)).toEqual(run({ ...input, timeZone: getDeviceTimeZone() }));
  });

  it('rejects an invalid IANA zone', () => {
    expect(() => run({ date: '2026-10-31', timeZone: 'Mars/Olympus' })).toThrow(RangeError);
  });
});

describe('getDeviceTimeZone / getBusinessTimeZone', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns a valid IANA zone', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: getBusinessTimeZone() })).not.toThrow();
  });

  it('falls back to UTC when the runtime reports an invalid zone', () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: 'Bogus/Zone',
    });
    expect(getDeviceTimeZone()).toBe('UTC');
  });
});
