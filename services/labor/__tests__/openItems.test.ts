/**
 * Items left open by the research audit of 2026-10-28
 * (qa/research-audit-2026-10-28.md), each read in the primary or official
 * source named in the pack's cite on 2026-11-11. Oracle style: a concrete
 * schedule and the verdict the law gives it. Times are local wall clock.
 */
import { addDaysToKey } from '@/utils/dateKeys';
import { zonedShiftSpan } from '@/utils/zonedTime';
import { legalConstraintsFor } from '../assignerConstraints';
import { evaluateShifts, resolveDated, resolvePack } from '../engine';
import { citiesFor, getJurisdiction, jurisdictionChain, regionsFor, resolveJurisdiction } from '../jurisdictions';
import type { EvaluationContext, Finding, LaborShift, LaborWorker } from '../types';

const ZONES: Record<string, string> = {
  MX: 'America/Mexico_City', PL: 'Europe/Warsaw', 'US-WA': 'America/Los_Angeles', 'US-WA-SEATTLE': 'America/Los_Angeles',
  'US-IL': 'America/Chicago', 'US-IL-CHICAGO': 'America/Chicago', 'US-IL-EVANSTON': 'America/Chicago',
  'CA-BC': 'America/Vancouver', 'CA-AB': 'America/Edmonton',
};

let seq = 0;
type ShiftOpts = Partial<Omit<LaborShift, 'id' | 'start' | 'end' | 'breaks'>> & { breaks?: [string, string][] };

const at = (code: string, date: string, from: string, to: string, opts: ShiftOpts = {}): LaborShift => {
  const tz = ZONES[code];
  const span = zonedShiftSpan(date, from, to, tz);
  const breaks = (opts.breaks ?? []).map(([bf, bt]) => zonedShiftSpan(date, bf, bt, tz));
  return { ...opts, id: `o${++seq}`, start: span.start, end: span.end, breaks };
};

const run = (code: string, shifts: LaborShift[], worker: Partial<LaborWorker> = {}, ctx: Partial<EvaluationContext> = {}) =>
  evaluateShifts({ jurisdiction: code, timeZone: ZONES[code], fairWorkweekCovered: true, ...ctx }, { id: 'w1', ...worker }, shifts);

const has = (findings: Finding[], rule: string, verdict?: Finding['verdict']) =>
  findings.filter((f) => f.rule === rule && (!verdict || f.verdict === verdict));

const verdicts = (findings: Finding[], verdict: Finding['verdict']) => findings.filter((f) => f.verdict === verdict);

/** Monday of a week with no clock change in any of the zones above. */
const MON = '2026-11-16';
const day = (n: number, monday = MON) => addDaysToKey(monday, n);

describe('Mexico: weekly overtime cap (LFT arts. 66 and 68, DOF 2026-05-01)', () => {
  /**
   * 06:00–14:30 with a 30 min break is 8 ordinary hours; `ot` more hours are
   * marked as overtime. The day ends by 18:30, so it stays a day shift (LFT 60).
   */
  const mxDay = (date: string, ot = 0) => {
    const end = `${String(14 + Math.floor(ot)).padStart(2, '0')}:30`;
    return at('MX', date, '06:00', end, { overtimeHours: ot, breaks: [['12:00', '12:30']] });
  };
  /** Six 8 h days (48 ordinary hours) with overtime on the first days of the week. */
  const week = (overtime: number[], monday = MON) => [0, 1, 2, 3, 4, 5].map((d) => mxDay(day(d, monday), overtime[d] ?? 0));

  it('MX-04 pins the cap and its phases: 9 h until 2027, 10 h in 2028, 11 h in 2029, 12 h from 2030', () => {
    const rule = resolvePack('MX').weeklyOvertimeMax!;
    expect(resolveDated(rule.hours, '2026-11-11')).toBe(9);
    expect(resolveDated(rule.hours, '2027-12-31')).toBe(9);
    expect(resolveDated(rule.hours, '2028-01-01')).toBe(10);
    expect(resolveDated(rule.hours, '2029-01-01')).toBe(11);
    expect(resolveDated(rule.hours, '2030-01-01')).toBe(12);
    expect(rule.beyond).toEqual({ hours: 4, multiplier: 3 });
    expect(rule.cite.source).toMatch(/art\. 66/);
    expect(rule.cite.url).toMatch(/diputados\.gob\.mx/);
  });

  it('MX-05 pins what is in force on 2026-11-11: 48 h week, 4 h of overtime a day on at most 4 days', () => {
    const pack = resolvePack('MX');
    expect(resolveDated(pack.weeklyOrdinaryMax!.hours, '2026-11-11')).toBe(48);
    expect(resolveDated(pack.weeklyOrdinaryMax!.hours, '2027-01-01')).toBe(46);
    expect(pack.dailyOvertimeMax!.hours).toBe(4);
    expect(pack.overtimeDaysPerWeekMax!.days).toBe(4);
    expect(pack.dailyTotalMax!.hours).toBe(12);
  });

  it('MX-06 a compliant week (3 + 3 + 3 h of overtime on three days) has no overtime finding', () => {
    const r = run('MX', week([3, 3, 3]));
    expect(has(r.findings, 'weekly.overtimeMax')).toHaveLength(0);
    expect(has(r.findings, 'weekly.overtimeDays')).toHaveLength(0);
    expect(has(r.findings, 'daily.overtimeMax')).toHaveLength(0);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
  });

  it('MX-07 exactly 9 h on four days (3 + 2 + 2 + 2) passes', () => {
    const r = run('MX', week([3, 2, 2, 2]));
    expect(has(r.findings, 'weekly.overtimeMax')).toHaveLength(0);
    expect(has(r.findings, 'weekly.overtimeDays')).toHaveLength(0);
  });

  it('MX-08 overtime on a 5th day of the week is a violation', () => {
    const r = run('MX', week([1, 1, 1, 1, 1]));
    expect(has(r.findings, 'weekly.overtimeDays', 'violation')).toHaveLength(1);
    expect(has(r.findings, 'weekly.overtimeMax')).toHaveLength(0);
  });

  it('MX-09 10 h of overtime in a week (4 + 3 + 3): the hour above 9 is paid at 3× and may be refused', () => {
    const over = has(run('MX', week([4, 3, 3])).findings, 'weekly.overtimeMax');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ verdict: 'premium', hours: 1, multiplier: 3 });
    expect(over[0].message).toMatch(/9 h weekly limit/);
  });

  it('MX-10 14 h of overtime in a week (4 + 4 + 3 + 3) is past the 4 extra hours: a violation', () => {
    const over = has(run('MX', week([4, 4, 3, 3])).findings, 'weekly.overtimeMax');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ verdict: 'violation', hours: 14 });
  });

  it('MX-11 hours above the daily limit count toward the cap without being marked as overtime', () => {
    // 06:00–18:30 with a 30 min break is 12 h: 4 h above the 8 h day shift limit, on three days.
    const long = [0, 1, 2].map((d) => at('MX', day(d), '06:00', '18:30', { breaks: [['12:00', '12:30']] }));
    const over = has(run('MX', long).findings, 'weekly.overtimeMax');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ verdict: 'premium', hours: 3 });
  });

  it('MX-12 in 2030 the cap is 12 h: 4 + 4 + 4 passes, 4 + 4 + 4 + 1 does not', () => {
    // 40 h week from 2030: five 8 h days keep the ordinary hours at the limit.
    const five = (ot: number[]) => [0, 1, 2, 3, 4].map((d) => mxDay(day(d, '2030-01-07'), ot[d] ?? 0));
    expect(has(run('MX', five([4, 4, 4])).findings, 'weekly.overtimeMax')).toHaveLength(0);
    expect(has(run('MX', five([4, 4, 4, 1])).findings, 'weekly.overtimeMax', 'premium')[0].hours).toBe(1);
  });
});

describe('Poland: night period (Kodeks pracy art. 151^7)', () => {
  it('PL-01 the night period is 8 hours inside the 21:00–07:00 bracket the employer chooses from', () => {
    const night = resolvePack('PL').night!;
    expect(night.window).toEqual(['22:00', '06:00']);
    expect(night.setByEmployerWithin).toEqual(['21:00', '07:00']);
    expect(night.premiumPct).toBe(20);
    expect(night.cite.source).toMatch(/151\^7/);
  });

  it('PL-02 a 21:00–07:00 shift has 8 night hours, not 10, and asks to check the employer\'s period', () => {
    const r = run('PL', [at('PL', MON, '21:00', '07:00')]);
    expect(has(r.findings, 'night.premium', 'premium')[0].hours).toBe(8);
    const review = has(r.findings, 'night.window', 'review');
    expect(review).toHaveLength(1);
    expect(review[0].message).toMatch(/21:00–07:00/);
  });

  it('PL-03 work from 06:00 to 07:00 is inside the bracket: no premium is assumed, but it is flagged for review', () => {
    const r = run('PL', [at('PL', MON, '06:00', '11:00')]);
    expect(has(r.findings, 'night.premium')).toHaveLength(0);
    expect(has(r.findings, 'night.window', 'review')).toHaveLength(1);
  });

  it('PL-04 a day shift has no night finding', () => {
    const r = run('PL', [at('PL', MON, '08:00', '16:00', { breaks: [['12:00', '12:15']] })]);
    expect(has(r.findings, 'night.window')).toHaveLength(0);
    expect(has(r.findings, 'night.premium')).toHaveLength(0);
  });

  it('PL-05 a night worker over 8 h in a day is a review item (§3 applies to dangerous or strenuous work)', () => {
    const nine = () => at('PL', MON, '21:00', '06:00');
    const flagged = has(run('PL', [nine()], { nightWorker: true }).findings, 'nightWorker.strenuousMax');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ verdict: 'review', hours: 9 });
    expect(has(run('PL', [nine()]).findings, 'nightWorker.strenuousMax')).toHaveLength(0);
    const eight = at('PL', MON, '22:00', '06:00');
    expect(has(run('PL', [eight], { nightWorker: true }).findings, 'nightWorker.strenuousMax')).toHaveLength(0);
  });

  it('PL-06 the EU floor\'s average for night workers is not applied in Poland', () => {
    expect(resolvePack('PL').nightWorker).toBeUndefined();
    expect(resolvePack('PL').nightWorkerStrenuousMax?.dailyHours).toBe(8);
    // Other member states keep it.
    expect(resolvePack('DE').nightWorker?.averageDailyHours).toBe(8);
  });
});

describe('Washington (WAC 296-126-092, RCW 49.46.130, WAC 296-125)', () => {
  it('WA-01 the state and Seattle resolve, and Seattle keeps its ordinance on top of the state rules', () => {
    expect(resolveJurisdiction({ country: 'US', region: 'WA' })).toBe('US-WA');
    expect(resolveJurisdiction({ country: 'US', region: 'WA', city: 'Seattle' })).toBe('US-WA-SEATTLE');
    expect(resolveJurisdiction({ country: 'US', region: 'WA', city: 'Spokane' })).toBe('US-WA');
    expect(jurisdictionChain('US-WA-SEATTLE')).toEqual(['US', 'US-WA', 'US-WA-SEATTLE']);
    const seattle = resolvePack('US-WA-SEATTLE');
    expect(seattle.fairWorkweek?.clopening?.minHours).toBe(10);
    expect(seattle.mealDeadline).toEqual(resolvePack('US-WA').mealDeadline);
  });

  it('WA-02 pins the meal period and the overtime threshold', () => {
    const pack = resolvePack('US-WA');
    expect(pack.mealDeadline).toMatchObject({ byWorkHours: 5, notBeforeWorkHours: 2, minMinutes: 30 });
    expect(pack.overtimePay).toMatchObject({ weekly: { after: 40, multiplier: 1.5 } });
    expect(pack.overtimePay?.daily).toBeUndefined();
  });

  it('WA-03 6 h without a meal period is a violation; a 30 min meal at hour 3 passes', () => {
    const none = has(run('US-WA', [at('US-WA', MON, '09:00', '15:00')]).findings, 'breaks.mealDeadline', 'violation');
    expect(none).toHaveLength(1);
    expect(none[0].message).toMatch(/between hour 2 and hour 5/);
    expect(none[0].message).not.toMatch(/premium pay/);
    expect(has(run('US-WA', [at('US-WA', MON, '09:00', '15:30', { breaks: [['12:00', '12:30']] })]).findings, 'breaks.mealDeadline')).toHaveLength(0);
  });

  it('WA-04 a meal in the first 2 hours or after the 5th hour does not count', () => {
    const early = run('US-WA', [at('US-WA', MON, '09:00', '15:30', { breaks: [['10:00', '10:30']] })]);
    expect(has(early.findings, 'breaks.mealDeadline', 'violation')).toHaveLength(1);
    const late = run('US-WA', [at('US-WA', MON, '09:00', '16:00', { breaks: [['14:30', '15:00']] })]);
    expect(has(late.findings, 'breaks.mealDeadline', 'violation')).toHaveLength(1);
  });

  it('WA-05 exactly 5 h needs no meal period, and an agreed waiver is accepted', () => {
    expect(has(run('US-WA', [at('US-WA', MON, '09:00', '14:00')]).findings, 'breaks.mealDeadline')).toHaveLength(0);
    expect(has(run('US-WA', [at('US-WA', MON, '09:00', '16:00', { mealWaiver: true })]).findings, 'breaks.mealDeadline')).toHaveLength(0);
  });

  it('WA-06 four 12 h days: 8 h at 1.5× (no daily overtime)', () => {
    const shifts = [0, 1, 2, 3].map((d) => at('US-WA', day(d), '07:00', '19:30', { breaks: [['11:00', '11:30']] }));
    const r = run('US-WA', shifts);
    expect(r.pay).toEqual({ regularHours: 40, overtime: [{ multiplier: 1.5, hours: 8 }] });
    expect(has(r.findings, 'pay.overtime')[0].cite?.source).toMatch(/RCW 49\.46\.130/);
  });

  it('WA-07 a 15-year-old: 17 h in a school week breaks the 16 h state limit (the federal limit is 18 h)', () => {
    const worker = { birthDate: '2011-03-01' };
    const schoolDays = [0, 1, 2, 3, 4].map((d) => day(d));
    // Mon–Fri 16:00–19:00 (3 h) and Saturday 10:00–12:00.
    const week = (saturdayEnd: string) => [0, 1, 2, 3, 4].map((d) => at('US-WA', day(d), '16:00', '19:00')).concat(at('US-WA', day(5), '10:00', saturdayEnd));
    const over = has(run('US-WA', week('12:00'), worker, { schoolDays }).findings, 'minors', 'violation');
    expect(over).toHaveLength(1);
    expect(over[0].message).toMatch(/16 h weekly limit/);
    expect(has(run('US-WA', week('11:00'), worker, { schoolDays }).findings, 'minors')).toHaveLength(0);
  });

  it('WA-08 a 15-year-old needs a 30 min meal for more than 4 h; a 17-year-old may not work past midnight', () => {
    const young = run('US-WA', [at('US-WA', '2026-07-11', '09:00', '14:00')], { birthDate: '2011-03-01' });
    expect(has(young.findings, 'minors', 'violation').filter((f) => /break/.test(f.message))).toHaveLength(1);
    const seventeen = { birthDate: '2009-03-01' };
    const late = run('US-WA', [at('US-WA', '2026-07-11', '20:00', '00:30')], seventeen);
    expect(has(late.findings, 'minors', 'violation').filter((f) => /05:00 and 00:00/.test(f.message))).toHaveLength(1);
    expect(has(run('US-WA', [at('US-WA', '2026-07-11', '20:00', '00:00')], seventeen).findings, 'minors')).toHaveLength(0);
  });

  it('WA-09 a 17-year-old: 21 h in a school week breaks the 20 h limit', () => {
    const schoolDays = [0, 1, 2, 3, 4].map((d) => day(d));
    const week = [0, 1, 2, 3, 4].map((d) => at('US-WA', day(d), '16:00', '20:00')).concat(at('US-WA', day(5), '10:00', '11:00'));
    const f = has(run('US-WA', week, { birthDate: '2009-03-01' }, { schoolDays }).findings, 'minors', 'violation');
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/20 h weekly limit/);
  });
});

describe('Illinois (One Day Rest in Seven Act, 820 ILCS 140; Child Labor Law of 2024)', () => {
  it('IL-01 the state, Chicago and Evanston resolve, and the cities keep their ordinances on top of the state rules', () => {
    expect(resolveJurisdiction({ country: 'US', region: 'IL' })).toBe('US-IL');
    expect(resolveJurisdiction({ country: 'US', region: 'IL', city: 'Chicago' })).toBe('US-IL-CHICAGO');
    expect(resolveJurisdiction({ country: 'US', region: 'IL', city: 'Evanston' })).toBe('US-IL-EVANSTON');
    expect(resolveJurisdiction({ country: 'US', region: 'IL', city: 'Springfield' })).toBe('US-IL');
    expect(citiesFor('US', 'IL').map((j) => j.code).sort()).toEqual(['US-IL-CHICAGO', 'US-IL-EVANSTON']);
    expect(jurisdictionChain('US-IL-CHICAGO')).toEqual(['US', 'US-IL', 'US-IL-CHICAGO']);
    expect(jurisdictionChain('US-IL-EVANSTON')).toEqual(['US', 'US-IL', 'US-IL-EVANSTON']);
    const state = resolvePack('US-IL');
    const chicago = resolvePack('US-IL-CHICAGO');
    const evanston = resolvePack('US-IL-EVANSTON');
    expect(chicago.fairWorkweek?.clopening).toMatchObject({ minHours: 10, premium: { kind: 'wholeShift', multiplier: 1.25 } });
    expect(evanston.fairWorkweek?.clopening).toMatchObject({ minHours: 11, premium: { kind: 'hoursInsideGap', multiplier: 1.5 } });
    for (const city of [chicago, evanston]) {
      expect(city.breaks).toEqual(state.breaks);
      expect(city.restInConsecutiveDays).toEqual(state.restInConsecutiveDays);
      expect(city.currency).toBe('USD');
    }
  });

  it('IL-02 pins the Act\'s numbers', () => {
    const pack = resolvePack('US-IL');
    expect(pack.restInConsecutiveDays).toMatchObject({ minHours: 24, days: 7, exemptIfWeeklyHoursLte: 20 });
    expect(pack.breaks?.triggers).toEqual([
      { afterHours: 7.5, inclusive: true, minMinutes: 20 },
      { afterHours: 12, inclusive: true, minMinutes: 40 },
      { afterHours: 16.5, inclusive: true, minMinutes: 60 },
    ]);
    expect(pack.mealDeadline).toMatchObject({ requiredFromWorkHours: 7.5, byWorkHours: 5, minMinutes: 20 });
    expect(pack.overtimePay).toMatchObject({ weekly: { after: 40, multiplier: 1.5 } });
  });

  it('IL-03 7.5 h without a meal period is a violation; 7 h is not', () => {
    const missing = run('US-IL', [at('US-IL', MON, '09:00', '16:30')]);
    expect(has(missing.findings, 'breaks.minimum', 'violation')).toHaveLength(1);
    // Reported once, not also as a late meal.
    expect(has(missing.findings, 'breaks.mealDeadline')).toHaveLength(0);
    expect(verdicts(run('US-IL', [at('US-IL', MON, '09:00', '16:00')]).findings, 'violation')).toHaveLength(0);
  });

  it('IL-04 the meal must begin within 5 hours of the start', () => {
    const late = run('US-IL', [at('US-IL', MON, '09:00', '17:30', { breaks: [['15:00', '15:20']] })]);
    expect(has(late.findings, 'breaks.mealDeadline', 'violation')).toHaveLength(1);
    const timely = run('US-IL', [at('US-IL', MON, '09:00', '17:30', { breaks: [['13:00', '13:20']] })]);
    expect(verdicts(timely.findings, 'violation')).toHaveLength(0);
  });

  it('IL-05 12 h of work needs a second 20 min meal period', () => {
    const one = run('US-IL', [at('US-IL', MON, '07:00', '19:20', { breaks: [['11:00', '11:20']] })]);
    expect(has(one.findings, 'breaks.minimum', 'violation')[0].message).toMatch(/40 min/);
    const two = run('US-IL', [at('US-IL', MON, '07:00', '19:40', { breaks: [['11:00', '11:20'], ['16:00', '16:20']] })]);
    expect(has(two.findings, 'breaks.minimum')).toHaveLength(0);
  });

  it('IL-06 seven days in a row with no 24 h of rest is a violation, also across two calendar weeks', () => {
    // Wednesday to the next Tuesday, 09:00–15:00.
    const seven = Array.from({ length: 7 }, (_, i) => at('US-IL', day(2 + i), '09:00', '15:00'));
    const f = has(run('US-IL', seven).findings, 'rest.consecutiveDays', 'violation');
    expect(f).toHaveLength(1);
    expect(f[0].shiftIds).toHaveLength(7);
    expect(f[0].cite?.source).toMatch(/820 ILCS 140\/2/);
  });

  it('IL-07 six days in a row pass, and so does a part-time week of 20 h or less', () => {
    const six = Array.from({ length: 6 }, (_, i) => at('US-IL', day(i), '09:00', '15:00'));
    expect(has(run('US-IL', six).findings, 'rest.consecutiveDays')).toHaveLength(0);
    // Monday to Sunday, 2 h a day: 14 h in the week.
    const partTime = Array.from({ length: 7 }, (_, i) => at('US-IL', day(i), '09:00', '11:00'));
    expect(has(run('US-IL', partTime).findings, 'rest.consecutiveDays')).toHaveLength(0);
  });

  it('IL-08 a 24 h rest inside the run resets it, without a whole calendar day off', () => {
    // Thursday ends 08:00, Friday starts 09:00: 25 h of rest, work on every calendar day.
    const shifts = [0, 1, 2].map((d) => at('US-IL', day(d), '09:00', '15:00'))
      .concat(at('US-IL', day(3), '02:00', '08:00'))
      .concat([4, 5, 6].map((d) => at('US-IL', day(d), '09:00', '15:00')));
    expect(has(run('US-IL', shifts).findings, 'rest.consecutiveDays')).toHaveLength(0);
  });

  it('IL-09 Chicago applies the state meal period next to its clopening premium', () => {
    const r = run('US-IL-CHICAGO', [at('US-IL-CHICAGO', MON, '14:00', '22:00'), at('US-IL-CHICAGO', day(1), '07:00', '13:00', { restConsent: true })]);
    expect(has(r.findings, 'fairWorkweek.clopening', 'premium')[0]).toMatchObject({ hours: 6, multiplier: 1.25 });
    expect(has(r.findings, 'breaks.minimum', 'violation')).toHaveLength(1);
  });

  it('IL-10 a 15-year-old: 18 h in a school week passes, 19 h does not; 5.5 h needs a 30 min meal', () => {
    const worker = { birthDate: '2011-03-01' };
    const schoolDays = [0, 1, 2, 3, 4].map((d) => day(d));
    const week = (saturdayEnd: string) => [0, 1, 2, 3, 4].map((d) => at('US-IL', day(d), '16:00', '19:00')).concat(at('US-IL', day(5), '10:00', saturdayEnd));
    expect(has(run('US-IL', week('13:00'), worker, { schoolDays }).findings, 'minors')).toHaveLength(0);
    expect(has(run('US-IL', week('14:00'), worker, { schoolDays }).findings, 'minors', 'violation')[0].message).toMatch(/18 h weekly limit/);
    const noMeal = run('US-IL', [at('US-IL', '2026-07-11', '09:00', '14:30')], worker);
    expect(has(noMeal.findings, 'minors', 'violation').filter((f) => /break/.test(f.message))).toHaveLength(1);
  });
});

describe('British Columbia: split shifts (ESA s.33)', () => {
  it('BC-05 a split shift that ends 13 h after it started is a violation', () => {
    const r = run('CA-BC', [at('CA-BC', MON, '07:00', '11:00'), at('CA-BC', MON, '16:00', '20:00')]);
    const f = has(r.findings, 'daily.spanMax', 'violation');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ hours: 13 });
    expect(f[0].cite?.source).toMatch(/s\.33/);
  });

  it('BC-06 a split shift completed in exactly 12 h passes', () => {
    const r = run('CA-BC', [at('CA-BC', MON, '07:00', '11:00'), at('CA-BC', MON, '15:00', '19:00')]);
    expect(has(r.findings, 'daily.spanMax')).toHaveLength(0);
  });

  it('BC-07 one unbroken 13 h shift is not a split shift: overtime, but no s.33 finding', () => {
    const r = run('CA-BC', [at('CA-BC', MON, '07:00', '20:30', { breaks: [['12:00', '12:30']] })]);
    expect(has(r.findings, 'daily.spanMax')).toHaveLength(0);
    expect(resolvePack('CA-BC').dailySpanMax).toMatchObject({ hours: 12, splitShiftsOnly: true });
  });
});

describe('Alberta (Employment Standards Code ss.16-19, 21-22)', () => {
  it('AB-01 Alberta resolves to its own pack and is offered next to the other provinces', () => {
    expect(resolveJurisdiction({ country: 'CA', region: 'AB' })).toBe('CA-AB');
    expect(regionsFor('CA').map((j) => j.code)).toContain('CA-AB');
    expect(getJurisdiction('CA-AB')).toMatchObject({ name: 'Alberta', timeZone: 'America/Edmonton' });
    const pack = resolvePack('CA-AB');
    expect(pack.currency).toBe('CAD');
    expect(pack.baselineOnly).toBeUndefined();
    // Provincial law, not the Canada Labour Code: no 96 h notice, no 48 h weekly maximum.
    expect(pack.notice).toBeUndefined();
    expect(pack.weeklyMax).toBeUndefined();
  });

  it('AB-02 pins the Code\'s numbers', () => {
    const pack = resolvePack('CA-AB');
    expect(pack.dailySpanMax).toMatchObject({ hours: 12 });
    expect(pack.dailySpanMax?.splitShiftsOnly).toBeUndefined();
    expect(pack.restBetweenShifts).toMatchObject({ minHours: 8, onlyOnShiftChange: true });
    expect(pack.breaks).toMatchObject({
      measure: 'span', minBlockMinutes: 15,
      triggers: [{ afterHours: 5, minMinutes: 30 }, { afterHours: 10, inclusive: true, minMinutes: 60 }],
    });
    expect(pack.weeklyRest).toMatchObject({ minHours: 24, verdict: 'warning' });
    expect(pack.overtimePay).toMatchObject({ weekly: { after: 44, multiplier: 1.5 }, daily: [{ after: 8, multiplier: 1.5 }] });
  });

  it('AB-03 work spread over 13 h of one day is a violation, split or not; 12 h passes', () => {
    const split = run('CA-AB', [at('CA-AB', MON, '07:00', '11:00'), at('CA-AB', MON, '16:00', '20:00')]);
    expect(has(split.findings, 'daily.spanMax', 'violation')).toHaveLength(1);
    const single = run('CA-AB', [at('CA-AB', MON, '07:00', '20:00', { breaks: [['11:00', '11:30'], ['16:00', '16:30']] })]);
    expect(has(single.findings, 'daily.spanMax', 'violation')).toHaveLength(1);
    const twelve = run('CA-AB', [at('CA-AB', MON, '07:00', '19:00', { breaks: [['11:00', '11:30'], ['15:00', '15:30']] })]);
    expect(verdicts(twelve.findings, 'violation')).toHaveLength(0);
  });

  it('AB-04 breaks follow the length of the shift: none up to 5 h, 30 min over 5 h, two of 30 min from 10 h', () => {
    expect(has(run('CA-AB', [at('CA-AB', MON, '09:00', '14:00')]).findings, 'breaks.minimum')).toHaveLength(0);
    expect(has(run('CA-AB', [at('CA-AB', MON, '09:00', '15:00')]).findings, 'breaks.minimum', 'violation')).toHaveLength(1);
    // A 10 h shift with one 30 min break: 9.5 h worked, but the shift is 10 h long.
    const ten = run('CA-AB', [at('CA-AB', MON, '08:00', '18:00', { breaks: [['12:00', '12:30']] })]);
    expect(has(ten.findings, 'breaks.minimum', 'violation')[0].message).toMatch(/10 h shift needs at least 60 min/);
    // Two periods of 15 min count as the 30 min break.
    const halves = run('CA-AB', [at('CA-AB', MON, '09:00', '15:00', { breaks: [['11:00', '11:15'], ['13:00', '13:15']] })]);
    expect(has(halves.findings, 'breaks.minimum')).toHaveLength(0);
  });

  it('AB-05 7 h between shifts is a review item (8 h are owed on a change of shift), not a violation or a hard limit', () => {
    const r = run('CA-AB', [at('CA-AB', MON, '19:00', '23:00'), at('CA-AB', day(1), '06:00', '10:00')]);
    const rest = has(r.findings, 'rest.betweenShifts');
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ verdict: 'review', hours: 7 });
    expect(has(run('CA-AB', [at('CA-AB', MON, '19:00', '23:00'), at('CA-AB', day(1), '07:00', '11:00')]).findings, 'rest.betweenShifts')).toHaveLength(0);
    expect(legalConstraintsFor('CA-AB', MON).minRestHoursBetweenShifts).toBeUndefined();
    expect(legalConstraintsFor('CA-BC', MON).minRestHoursBetweenShifts).toBe(8);
  });

  it('AB-06 a stricter location override makes the rest a hard limit for every pair of shifts', () => {
    const overrides = [{ rule: 'rest.minHours' as const, value: 10 }];
    const r = run('CA-AB', [at('CA-AB', MON, '19:00', '23:00'), at('CA-AB', day(1), '08:00', '12:00')], {}, { overrides });
    expect(has(r.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
    expect(legalConstraintsFor('CA-AB', MON, overrides).minRestHoursBetweenShifts).toBe(10);
  });

  it('AB-07 overtime is the greater of the daily and the weekly excess', () => {
    const shift = (d: number, to: string) => at('CA-AB', day(d), '08:00', to, { breaks: [['12:00', '12:30']] });
    // Five 10 h days: 10 h over 8 a day, 6 h over 44 a week.
    const daily = run('CA-AB', [0, 1, 2, 3, 4].map((d) => shift(d, '18:30')));
    expect(daily.pay).toEqual({ regularHours: 40, overtime: [{ multiplier: 1.5, hours: 10 }] });
    // Six 8 h days: nothing over 8 a day, 4 h over 44 a week.
    const weekly = run('CA-AB', [0, 1, 2, 3, 4, 5].map((d) => shift(d, '16:30')));
    expect(weekly.pay).toEqual({ regularHours: 44, overtime: [{ multiplier: 1.5, hours: 4 }] });
    // Five 9 h days and one 8 h day (53 h): 5 h daily, 9 h weekly.
    const mixed = run('CA-AB', [0, 1, 2, 3, 4].map((d) => shift(d, '17:30')).concat(shift(5, '16:30')));
    expect(mixed.pay).toEqual({ regularHours: 44, overtime: [{ multiplier: 1.5, hours: 9 }] });
  });

  it('AB-08 seven days worked in a week is a warning (rest days may be taken over up to 4 weeks)', () => {
    const shifts = Array.from({ length: 9 }, (_, i) => at('CA-AB', addDaysToKey(MON, i - 1), '09:00', '13:00'));
    const weekly = has(run('CA-AB', shifts).findings, 'rest.weekly').filter((f) => f.message.includes(MON));
    expect(weekly).toHaveLength(1);
    expect(weekly[0].verdict).toBe('warning');
  });
});
