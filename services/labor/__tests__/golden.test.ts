/**
 * QA's labor-rules oracle (qa/labor-rules-golden.md §25, 46 cases, checked
 * 2026-10-18). Each test names its case id. Times are local wall clock in the
 * location's zone; the engine works on elapsed time.
 */
import { addDaysToKey } from '@/utils/dateKeys';
import { zonedShiftSpan, zonedHHMMToUtc } from '@/utils/zonedTime';
import { evaluateShifts } from '../engine';
import type { EvaluationContext, Finding, LaborShift, LaborWorker } from '../types';

const ZONES: Record<string, string> = {
  ES: 'Europe/Madrid', IE: 'Europe/Dublin', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires',
  CA: 'America/Toronto', 'CA-ON': 'America/Toronto', 'CA-QC': 'America/Toronto', 'US-NY-NYC': 'America/New_York',
  'US-WA-SEATTLE': 'America/Los_Angeles', 'US-IL-CHICAGO': 'America/Chicago', 'US-PA-PHILADELPHIA': 'America/New_York',
  'US-CA-BERKELEY': 'America/Los_Angeles', 'US-OR': 'America/Los_Angeles', PE: 'America/Lima', DE: 'Europe/Berlin',
  FR: 'Europe/Paris', MX: 'America/Mexico_City', CO: 'America/Bogota', CL: 'America/Santiago', 'US-CA': 'America/Los_Angeles',
  US: 'America/New_York', 'US-NY': 'America/New_York', NL: 'Europe/Amsterdam', GB: 'Europe/London', AU: 'Australia/Sydney',
};

let seq = 0;
type ShiftOpts = Partial<Omit<LaborShift, 'id' | 'start' | 'end' | 'breaks'>> & { breaks?: [string, string][] };

/** A shift on local date `date` from `from` to `to` (overnight when to ≤ from). */
const at = (code: string, date: string, from: string, to: string, opts: ShiftOpts = {}): LaborShift => {
  const tz = ZONES[code];
  const span = zonedShiftSpan(date, from, to, tz);
  const breaks = (opts.breaks ?? []).map(([bf, bt]) => {
    const b = zonedShiftSpan(date, bf, bt, tz);
    // A break before the shift start on the wall clock is on the next day.
    return b.start < span.start ? { start: b.start + 864e5, end: b.end + 864e5 } : b;
  });
  return { ...opts, id: `s${++seq}`, start: span.start, end: span.end, breaks };
};

const run = (code: string, shifts: LaborShift[], worker: Partial<LaborWorker> = {}, ctx: Partial<EvaluationContext> = {}) =>
  evaluateShifts({ jurisdiction: code, timeZone: ZONES[code], fairWorkweekCovered: true, ...ctx }, { id: 'w1', ...worker }, shifts);

const has = (findings: Finding[], rule: string, verdict?: Finding['verdict']) =>
  findings.filter((f) => f.rule === rule && (!verdict || f.verdict === verdict));

const verdicts = (findings: Finding[], verdict: Finding['verdict']) => findings.filter((f) => f.verdict === verdict);

// Mondays used below.
const MON = '2026-10-19';
const TUE = '2026-10-20';

describe('QA golden: rest between shifts / clopenings', () => {
  it('ES-01 11 h rest in Spain is a violation', () => {
    const r = run('ES', [at('ES', MON, '15:00', '23:00', { breaks: [['18:00', '18:30']] }), at('ES', TUE, '10:00', '14:00')]);
    expect(has(r.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
  });

  it('ES-02 exactly 12 h passes (inclusive minimum)', () => {
    const r = run('ES', [at('ES', MON, '14:00', '22:00', { breaks: [['18:00', '18:30']] }), at('ES', TUE, '10:00', '14:00')]);
    expect(has(r.findings, 'rest.betweenShifts')).toHaveLength(0);
  });

  it('IE-01 10 h rest in Ireland is a violation', () => {
    const r = run('IE', [at('IE', MON, '18:00', '22:00'), at('IE', TUE, '08:00', '12:00')]);
    expect(has(r.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
  });

  it('BR-01 10 h rest in Brazil is a violation', () => {
    const r = run('BR', [at('BR', MON, '19:00', '23:00'), at('BR', TUE, '09:00', '13:00')]);
    expect(has(r.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
  });

  it('AR-01 11 h rest fails Argentina (12 h) but passes the EU 11 h floor', () => {
    const ar = run('AR', [at('AR', MON, '18:00', '22:00'), at('AR', TUE, '09:00', '13:00')]);
    expect(has(ar.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
    const eu = evaluateShifts({ jurisdiction: 'EU', timeZone: 'Europe/Vienna' }, { id: 'w' }, [
      { id: 'a', start: zonedHHMMToUtc(MON, '18:00', 'Europe/Vienna'), end: zonedHHMMToUtc(MON, '22:00', 'Europe/Vienna') },
      { id: 'b', start: zonedHHMMToUtc(TUE, '09:00', 'Europe/Vienna'), end: zonedHHMMToUtc(TUE, '13:00', 'Europe/Vienna') },
    ]);
    expect(has(eu.findings, 'rest.betweenShifts')).toHaveLength(0);
  });

  it('CA-FED-01 7 h rest under the Canada Labour Code is a violation', () => {
    const r = run('CA', [at('CA', MON, '19:00', '23:00'), at('CA', TUE, '06:00', '10:00')]);
    expect(has(r.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
  });

  it('ON-01 7 h gap with shifts totalling 13 h passes the 8 h rule; the 11 h daily rule needs review', () => {
    const r = run('CA-ON', [at('CA-ON', MON, '14:00', '22:00', { breaks: [['18:00', '18:30']] }), at('CA-ON', TUE, '05:00', '10:00')]);
    expect(has(r.findings, 'rest.betweenShifts')).toHaveLength(0);
    expect(has(r.findings, 'rest.daily', 'review')).toHaveLength(1);
  });

  it('NYC-FF-01 10 h clopening: violation without consent, $100 with consent', () => {
    const ctx = { industry: 'fast_food' as const };
    const without = run('US-NY-NYC', [at('US-NY-NYC', MON, '15:00', '23:00'), at('US-NY-NYC', TUE, '09:00', '15:00')], {}, ctx);
    expect(has(without.findings, 'fairWorkweek.clopening', 'violation')).toHaveLength(1);
    const withConsent = run('US-NY-NYC', [at('US-NY-NYC', MON, '15:00', '23:00'), at('US-NY-NYC', TUE, '09:00', '15:00', { restConsent: true })], {}, ctx);
    const premium = has(withConsent.findings, 'fairWorkweek.clopening', 'premium');
    expect(premium).toHaveLength(1);
    expect(premium[0].amount).toEqual({ value: 100, currency: 'USD' });
  });

  it('SEA-01 8 h gap with consent earns 2 h at 1.5×', () => {
    const r = run('US-WA-SEATTLE', [at('US-WA-SEATTLE', MON, '15:00', '23:00'), at('US-WA-SEATTLE', TUE, '07:00', '13:00', { restConsent: true })]);
    const p = has(r.findings, 'fairWorkweek.clopening', 'premium');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ hours: 2, multiplier: 1.5 });
  });

  it('CHI-01 9 h gap with consent earns 1.25×', () => {
    const r = run('US-IL-CHICAGO', [at('US-IL-CHICAGO', MON, '14:00', '22:00'), at('US-IL-CHICAGO', TUE, '07:00', '13:00', { restConsent: true })]);
    const p = has(r.findings, 'fairWorkweek.clopening', 'premium');
    expect(p).toHaveLength(1);
    expect(p[0].multiplier).toBe(1.25);
  });

  it('PHL-01 8 h gap earns a $40 premium', () => {
    const r = run('US-PA-PHILADELPHIA', [at('US-PA-PHILADELPHIA', MON, '15:00', '23:00'), at('US-PA-PHILADELPHIA', TUE, '07:00', '13:00')]);
    const p = has(r.findings, 'fairWorkweek.clopening', 'premium');
    expect(p).toHaveLength(1);
    expect(p[0].amount).toEqual({ value: 40, currency: 'USD' });
  });

  it('BRK-01 10 h gap with consent earns 1 h at 1.5×', () => {
    const r = run('US-CA-BERKELEY', [at('US-CA-BERKELEY', MON, '14:00', '22:00', { breaks: [['17:00', '17:30']] }), at('US-CA-BERKELEY', TUE, '08:00', '12:00', { restConsent: true })]);
    const p = has(r.findings, 'fairWorkweek.clopening', 'premium');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ hours: 1, multiplier: 1.5 });
  });

  it('OR-01 9 h gap: violation without consent, 1 h at 1.5× with consent', () => {
    const without = run('US-OR', [at('US-OR', MON, '15:00', '23:00'), at('US-OR', TUE, '08:00', '12:00')]);
    expect(has(without.findings, 'fairWorkweek.clopening', 'violation')).toHaveLength(1);
    const withConsent = run('US-OR', [at('US-OR', MON, '15:00', '23:00'), at('US-OR', TUE, '08:00', '12:00', { restConsent: true })]);
    expect(has(withConsent.findings, 'fairWorkweek.clopening', 'premium')[0]).toMatchObject({ hours: 1, multiplier: 1.5 });
  });

  it('PE-01 2 h rest after a night shift is a warning, not a violation', () => {
    const r = run('PE', [at('PE', MON, '22:00', '06:00', { breaks: [['02:00', '02:45']] }), at('PE', TUE, '08:00', '16:00', { breaks: [['12:00', '12:45']] })]);
    expect(has(r.findings, 'rest.betweenShifts', 'warning')).toHaveLength(1);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
    expect(has(r.findings, 'night.premium', 'premium')).toHaveLength(1);
  });

  it('a covered location with unknown coverage asks for review instead of guessing', () => {
    const r = run('US-OR', [at('US-OR', MON, '15:00', '23:00'), at('US-OR', TUE, '08:00', '12:00')], {}, { fairWorkweekCovered: undefined });
    expect(has(r.findings, 'fairWorkweek.coverage', 'review')).toHaveLength(1);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
  });
});

describe('QA golden: daily maxima, overtime, overnight', () => {
  it('ES-03 a 10 h ordinary shift in Spain is a violation', () => {
    const r = run('ES', [at('ES', MON, '08:00', '18:30', { breaks: [['13:00', '13:30']] })]);
    expect(has(r.findings, 'daily.ordinaryMax', 'violation')).toHaveLength(1);
  });

  it('DE-01 10 h days averaging ≤ 8 h over 24 weeks pass; a 10.5 h day fails', () => {
    const shifts: LaborShift[] = [];
    for (let week = 0; week < 24; week++) {
      for (let day = 0; day < 5; day++) {
        const date = addDaysToKey(MON, week * 7 + day);
        shifts.push(week < 4
          ? at('DE', date, '07:00', '17:45', { breaks: [['12:00', '12:45']] })
          : at('DE', date, '08:00', '14:00'));
      }
    }
    const ok = run('DE', shifts);
    expect(verdicts(ok.findings, 'violation')).toHaveLength(0);
    const long = run('DE', [at('DE', MON, '07:00', '18:15', { breaks: [['12:00', '12:45']] })]);
    expect(has(long.findings, 'daily.totalMax', 'violation')).toHaveLength(1);
  });

  it('DE-02 9 h 15 min of work with a 30 min break is a violation', () => {
    const r = run('DE', [at('DE', MON, '08:00', '17:45', { breaks: [['12:00', '12:30']] })]);
    expect(has(r.findings, 'breaks.minimum', 'violation')).toHaveLength(1);
  });

  it('FR-01 / ES-04 / IE-02 a 6 h shift: France needs a break, Spain and Ireland (15 min after 4.5 h) pass', () => {
    expect(has(run('FR', [at('FR', MON, '09:00', '15:00')]).findings, 'breaks.minimum', 'violation')).toHaveLength(1);
    expect(has(run('ES', [at('ES', MON, '09:00', '15:00')]).findings, 'breaks.minimum')).toHaveLength(0);
    expect(has(run('IE', [at('IE', MON, '09:00', '15:15', { breaks: [['13:30', '13:45']] })]).findings, 'breaks.minimum')).toHaveLength(0);
  });

  it('FR-02 twelve 45 h weeks exceed the 44 h 12-week average', () => {
    const shifts: LaborShift[] = [];
    for (let week = 0; week < 12; week++) {
      for (let day = 0; day < 5; day++) {
        shifts.push(at('FR', addDaysToKey(MON, week * 7 + day), '08:00', '17:30', { breaks: [['12:00', '12:30']] }));
      }
    }
    const r = run('FR', shifts);
    expect(has(r.findings, 'weekly.average', 'violation')).toHaveLength(1);
    expect(has(r.findings, 'weekly.max')).toHaveLength(0);
  });

  it('MX-01 (2030) 8 h + 5 h overtime breaks both the 4 h overtime and 12 h daily limits', () => {
    const r = run('MX', [at('MX', '2030-01-07', '06:00', '19:30', { overtimeHours: 5, breaks: [['12:00', '12:30']] })]);
    expect(has(r.findings, 'daily.overtimeMax', 'violation')).toHaveLength(1);
    expect(has(r.findings, 'daily.totalMax', 'violation')).toHaveLength(1);
  });

  it('MX-02 16:00–00:00 is a night shift (1 h overtime); 15:00–22:30 is mixed and passes', () => {
    const night = run('MX', [at('MX', MON, '16:00', '00:00')]);
    expect(has(night.findings, 'daily.overtime', 'premium')[0].hours).toBe(1);
    const mixed = run('MX', [at('MX', MON, '15:00', '22:30')]);
    expect(has(mixed.findings, 'daily.overtime')).toHaveLength(0);
  });

  it('MX-03 a week spanning the 48 → 46 h change applies 46 h and flags review', () => {
    const shifts = [0, 1, 2, 3, 4, 5].map((d) => at('MX', addDaysToKey('2026-12-28', d), '07:00', d < 5 ? '15:00' : '14:00'));
    const r = run('MX', shifts);
    expect(has(r.findings, 'weekly.limitChanges', 'review')).toHaveLength(1);
    expect(has(r.findings, 'weekly.overtime', 'premium')[0].hours).toBe(1);
  });

  it('CO-01 night premium starts at 19:00 from 2025-12-25, at 21:00 before', () => {
    const after = run('CO', [at('CO', '2026-01-10', '18:00', '22:00')]);
    expect(has(after.findings, 'night.premium')[0].hours).toBe(3);
    const before = run('CO', [at('CO', '2025-12-20', '18:00', '22:00')]);
    expect(has(before.findings, 'night.premium')[0].hours).toBe(1);
  });

  it('CO-02 44 ordinary hours in the week of 2026-07-20 are 2 h overtime; 3 h overtime in a day is a violation', () => {
    const week = [0, 1, 2, 3, 4].map((d) => at('CO', addDaysToKey('2026-07-20', d), '08:00', '16:00')).concat(at('CO', '2026-07-25', '08:00', '12:00'));
    expect(has(run('CO', week).findings, 'weekly.overtime', 'premium')[0].hours).toBe(2);
    const day = run('CO', [at('CO', '2026-07-20', '07:00', '18:00')]);
    expect(has(day.findings, 'daily.overtimeMax', 'violation')).toHaveLength(1);
  });

  it('CL-01 11 h ordinary day and 3 h overtime are violations; 43 h after 2026-04-26 is 1 h overtime', () => {
    expect(has(run('CL', [at('CL', MON, '07:00', '18:30', { breaks: [['13:00', '13:30']] })]).findings, 'daily.ordinaryMax', 'violation')).toHaveLength(1);
    expect(has(run('CL', [at('CL', MON, '07:00', '18:30', { overtimeHours: 3, breaks: [['13:00', '13:30']] })]).findings, 'daily.overtimeMax', 'violation')).toHaveLength(1);
    const week = [0, 1, 2, 3, 4].map((d) => at('CL', addDaysToKey(MON, d), '08:00', d < 3 ? '17:30' : '16:30', { breaks: [['13:00', '13:30']] }));
    const hours = week.reduce((n, s) => n + (s.end - s.start - 1_800_000) / 3_600_000, 0);
    expect(hours).toBe(43);
    expect(has(run('CL', week).findings, 'weekly.overtime', 'premium')[0].hours).toBe(1);
  });

  it('BR-02 22:00–06:00 counts 9 legal hours (52.5 min night hour): 1 h overtime', () => {
    const r = run('BR', [at('BR', MON, '22:00', '06:00', { breaks: [] })]);
    expect(has(r.findings, 'daily.overtime', 'premium')[0].hours).toBe(1);
  });

  it('BR-03 6 h with 15 min break passes; 6 h 01 with 15 min break is a violation', () => {
    expect(has(run('BR', [at('BR', MON, '09:00', '15:15', { breaks: [['12:00', '12:15']] })]).findings, 'breaks.minimum')).toHaveLength(0);
    expect(has(run('BR', [at('BR', MON, '09:00', '15:16', { breaks: [['12:00', '12:15']] })]).findings, 'breaks.minimum', 'violation')).toHaveLength(1);
  });

  it('US-CA-01 / US-FED-01 four 12 h days: CA 16 h at 1.5×, FLSA 8 h at 1.5×', () => {
    const days = (code: string) => [0, 1, 2, 3].map((d) => at(code, addDaysToKey(MON, d), '06:00', '18:00', { mealWaiver: false, breaks: [['10:00', '10:30'], ['15:00', '15:30']] }));
    // 12 h worked: extend the span by the hour of meal breaks.
    const twelve = (code: string) => days(code).map((s) => ({ ...s, end: s.end + 3_600_000 }));
    const ca = run('US-CA', twelve('US-CA'));
    expect(ca.pay).toEqual({ regularHours: 32, overtime: [{ multiplier: 1.5, hours: 16 }] });
    const fed = run('US', twelve('US'));
    expect(fed.pay).toEqual({ regularHours: 40, overtime: [{ multiplier: 1.5, hours: 8 }] });
  });

  it('US-CA-02 seven 8 h days: 8 h at 1.5× on day 6 and day 7, no double time', () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) => at('US-CA', addDaysToKey(MON, d), '08:00', '16:30', { breaks: [['12:00', '12:30']] }));
    const r = run('US-CA', week);
    expect(r.pay).toEqual({ regularHours: 40, overtime: [{ multiplier: 1.5, hours: 16 }] });
  });

  it('US-CA-03 6.5 h with no meal is a violation; 6 h with a waiver passes', () => {
    const r = run('US-CA', [at('US-CA', MON, '11:00', '17:30')]);
    expect(has(r.findings, 'breaks.mealDeadline', 'violation')[0].hours).toBe(1);
    expect(has(run('US-CA', [at('US-CA', MON, '11:00', '17:00', { mealWaiver: true })]).findings, 'breaks.mealDeadline')).toHaveLength(0);
  });

  it('US-NY-01 split shift spanning 12.5 h earns spread-of-hours pay', () => {
    const r = run('US-NY', [at('US-NY', MON, '07:00', '11:00'), at('US-NY', MON, '17:00', '19:30')]);
    expect(has(r.findings, 'daily.spreadOfHours', 'premium')[0].hours).toBe(1);
  });

  it('NL-01 split shift with a 6 h gap is one dienst of 10 h: passes the 12 h limit and the 30 min pause', () => {
    const r = run('NL', [at('NL', MON, '07:00', '11:00'), at('NL', MON, '17:00', '23:00')]);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
  });
});

describe('QA golden: night work, minors, averaging', () => {
  it('NL-02 exactly 1 h in 00:00–06:00 is not a night shift; after a night shift ending past 02:00, rest is 14 h', () => {
    // 18:00–01:00 is not a nachtdienst, so 11 h rest applies (next at 12:00 passes).
    expect(has(run('NL', [at('NL', MON, '18:00', '01:00', { breaks: [['21:00', '21:30']] }), at('NL', TUE, '12:00', '16:00')]).findings, 'rest.betweenShifts')).toHaveLength(0);
    // 18:00–01:30 is a nachtdienst (more than 1 h in the window) but ends before 02:00: still 11 h.
    expect(has(run('NL', [at('NL', MON, '18:00', '01:30', { breaks: [['21:00', '21:30']] }), at('NL', TUE, '12:30', '16:00')]).findings, 'rest.betweenShifts')).toHaveLength(0);
    // 22:00–07:00 ends after 02:00: next shift at 21:00 passes, at 19:00 fails.
    const night = () => at('NL', MON, '22:00', '07:00', { breaks: [['02:00', '02:30'], ['04:00', '04:30']] });
    expect(has(run('NL', [night(), at('NL', TUE, '21:00', '23:00')]).findings, 'rest.betweenShifts')).toHaveLength(0);
    expect(has(run('NL', [night(), at('NL', TUE, '19:00', '23:00')]).findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
  });

  it('ES-05 a 17-year-old 21:00–23:00 is a violation (no night work under 18)', () => {
    const r = run('ES', [at('ES', MON, '21:00', '23:00')], { birthDate: '2009-03-01' });
    expect(has(r.findings, 'minors', 'violation')).toHaveLength(1);
  });

  it('DE-03 16-year-old: retail until 20:30 fails; restaurant until 22:00 passes', () => {
    const worker = { birthDate: '2010-05-01' };
    expect(has(run('DE', [at('DE', MON, '16:00', '20:30')], worker, { industry: 'retail' }).findings, 'minors', 'violation')).toHaveLength(1);
    expect(has(run('DE', [at('DE', MON, '17:30', '22:00')], worker, { industry: 'full_service_restaurant' }).findings, 'minors')).toHaveLength(0);
  });

  it('UK-01 17-year-old: 23:30–00:30 fails; 22:00–23:00 fails unless the contract moves the period to 23:00–07:00', () => {
    const worker = { birthDate: '2009-01-15' };
    expect(has(run('GB', [at('GB', MON, '23:30', '00:30')], worker, { industry: 'retail' }).findings, 'minors', 'violation').length).toBeGreaterThan(0);
    expect(has(run('GB', [at('GB', MON, '22:00', '23:00')], worker).findings, 'minors', 'violation')).toHaveLength(1);
    expect(has(run('GB', [at('GB', MON, '22:00', '23:00')], { ...worker, minorAlternativeNightPeriod: true }).findings, 'minors')).toHaveLength(0);
  });

  it('US-FED-02 15-year-old on an October school day 16:00–19:30 breaks two rules; July 10 passes', () => {
    const worker = { birthDate: '2011-06-01' };
    const oct = run('US', [at('US', '2026-10-21', '16:00', '19:30')], worker, { schoolDays: ['2026-10-21'] });
    expect(has(oct.findings, 'minors', 'violation')).toHaveLength(2);
    const july = run('US', [at('US', '2026-07-10', '16:00', '19:30')], worker);
    expect(has(july.findings, 'minors')).toHaveLength(0);
  });

  it('QC-01 15-year-old in school: 11 h Mon–Fri fails; Saturday until 23:30 fails', () => {
    const worker = { birthDate: '2011-02-01', inCompulsorySchooling: true };
    const schoolDays = [0, 1, 2, 3, 4].map((d) => addDaysToKey(MON, d));
    const weekdays = [0, 1, 2, 3, 4].map((d) => at('CA-QC', addDaysToKey(MON, d), '16:00', d === 0 ? '19:00' : '18:00'));
    expect(has(run('CA-QC', weekdays, worker, { schoolDays }).findings, 'minors', 'violation').length).toBeGreaterThan(0);
    const saturday = run('CA-QC', [at('CA-QC', '2026-10-24', '19:00', '23:30')], worker, { schoolDays });
    expect(has(saturday.findings, 'minors', 'violation')).toHaveLength(1);
  });

  it('ES-06 night worker: ten 9 h nights in 15 days pass; overtime fails; a 10 h night fails', () => {
    const worker = { nightWorker: true };
    // November: no DST change inside the window (one crossing the 2026-10-25
    // fall-back really is a 10 h night).
    const nights = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12].map((d) => at('ES', addDaysToKey('2026-11-02', d), '21:30', '07:00', { breaks: [['02:00', '02:30']] }));
    const ok = run('ES', nights, worker);
    expect(has(ok.findings, 'nightWorker.average')).toHaveLength(0);
    expect(has(ok.findings, 'daily.ordinaryMax')).toHaveLength(0);
    const ot = run('ES', [at('ES', MON, '21:30', '07:00', { breaks: [['02:00', '02:30']], overtimeHours: 1 })], worker);
    expect(has(ot.findings, 'nightWorker.noOvertime', 'violation')).toHaveLength(1);
    const ten = run('ES', [at('ES', MON, '21:00', '07:30', { breaks: [['02:00', '02:30']] })], worker);
    expect(has(ten.findings, 'daily.ordinaryMax', 'violation')).toHaveLength(1);
  });

  it('UK-02 52 h/week over 17 weeks passes with an opt-out; a 9 h/day night worker fails even with one', () => {
    const weeks = (from: string, to: string, days: number) => {
      const shifts: LaborShift[] = [];
      for (let w = 0; w < 17; w++) for (let d = 0; d < days; d++) shifts.push(at('GB', addDaysToKey(MON, w * 7 + d), from, to, { breaks: [['12:00', '12:20']] }));
      return shifts;
    };
    const day52 = weeks('08:00', '18:44', 5); // 10.4 h × 5 = 52 h
    expect(has(run('GB', day52, { weeklyLimitOptOut: true }).findings, 'weekly.average')).toHaveLength(0);
    expect(has(run('GB', day52).findings, 'weekly.average', 'violation')).toHaveLength(1);
    const nights = weeks('22:00', '07:20', 7).map((s) => ({ ...s, breaks: [{ start: s.start + 4 * 3_600_000, end: s.start + 4 * 3_600_000 + 20 * 60_000 }] }));
    const r = run('GB', nights, { nightWorker: true, weeklyLimitOptOut: true });
    expect(has(r.findings, 'nightWorker.average', 'violation')).toHaveLength(1);
  });
});

describe('QA golden: DST (elapsed time)', () => {
  it('DST-US-01 22:00–06:00 on the fall-back night is 9 h: 1 h daily overtime in California', () => {
    const shift = at('US-CA', '2026-10-31', '22:00', '06:00', { mealWaiver: true, breaks: [['01:00', '01:30']] });
    shift.end += 1_800_000; // keep 9 h of work after the meal
    const r = run('US-CA', [shift]);
    expect((shift.end - shift.start) / 3_600_000).toBe(9.5);
    expect(r.pay.overtime).toEqual([{ multiplier: 1.5, hours: 1 }]);
    expect(run('US', [shift]).pay.regularHours).toBe(9);
  });

  it('DST-AU-01 22:00–06:00 when DST starts is 7 elapsed hours but paid as 8 by the clock', () => {
    const shift = at('AU', '2026-10-03', '22:00', '06:00');
    expect((shift.end - shift.start) / 3_600_000).toBe(7);
    expect(has(run('AU', [shift]).findings, 'pay.byClock', 'premium')[0].hours).toBe(8);
  });

  it('DST-ES-01 Saturday 22:00 to Sunday 09:00 across the October fall-back is 12 h: passes', () => {
    const r = run('ES', [at('ES', '2026-10-24', '14:00', '22:00', { breaks: [['18:00', '18:30']] }), at('ES', '2026-10-25', '09:00', '13:00')]);
    expect(has(r.findings, 'rest.betweenShifts')).toHaveLength(0);
  });
});

describe('QA golden: notice and predictability', () => {
  it('OR-02 a schedule posted 10 days ahead is a violation (14 days)', () => {
    const shift = at('US-OR', MON, '09:00', '15:00');
    const r = run('US-OR', [shift], {}, { publishedAt: shift.start - 10 * 864e5 });
    expect(has(r.findings, 'notice.advance', 'violation')).toHaveLength(1);
  });

  it('CA-FED-02 a schedule handed over 72 h ahead is refusable, not illegal', () => {
    const shift = at('CA', MON, '09:00', '15:00', { breaks: [['12:00', '12:30']] });
    const r = run('CA', [shift], {}, { publishedAt: shift.start - 72 * 3_600_000 });
    expect(has(r.findings, 'notice.advance', 'refusable')).toHaveLength(1);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
  });

  it('IE-03 a no-fixed-hours worker told 12 h ahead may refuse', () => {
    const shift = at('IE', MON, '09:00', '13:00');
    const r = run('IE', [shift], { noFixedHours: true }, { publishedAt: shift.start - 12 * 3_600_000 });
    expect(has(r.findings, 'notice.advance', 'refusable')).toHaveLength(1);
    expect(has(run('IE', [shift], {}, { publishedAt: shift.start - 12 * 3_600_000 }).findings, 'notice.advance')).toHaveLength(0);
  });
});
