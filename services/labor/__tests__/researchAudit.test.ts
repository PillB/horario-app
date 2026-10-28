/**
 * Pack corrections from the research audit of 2026-10-28
 * (qa/research-audit-2026-10-28.md), each re-checked against the primary
 * source named in the pack's cite. Oracle style: a concrete schedule and the
 * verdict the law gives it. Times are local wall clock in the location's zone.
 */
import { addDaysToKey } from '@/utils/dateKeys';
import { zonedShiftSpan } from '@/utils/zonedTime';
import { evaluateShifts, resolvePack } from '../engine';
import { getJurisdiction, regionsFor, resolveJurisdiction } from '../jurisdictions';
import type { EvaluationContext, Finding, LaborShift, LaborWorker } from '../types';

const ZONES: Record<string, string> = {
  BR: 'America/Sao_Paulo', CO: 'America/Bogota', PE: 'America/Lima', FR: 'Europe/Paris',
  'US-PA-PHILADELPHIA': 'America/New_York', 'US-IL-EVANSTON': 'America/Chicago', 'US-IL-CHICAGO': 'America/Chicago',
  CA: 'America/Toronto', 'CA-BC': 'America/Vancouver', 'CA-OTHER': 'America/Edmonton',
};

let seq = 0;
type ShiftOpts = Partial<Omit<LaborShift, 'id' | 'start' | 'end' | 'breaks'>> & { breaks?: [string, string][] };

const at = (code: string, date: string, from: string, to: string, opts: ShiftOpts = {}): LaborShift => {
  const tz = ZONES[code];
  const span = zonedShiftSpan(date, from, to, tz);
  const breaks = (opts.breaks ?? []).map(([bf, bt]) => zonedShiftSpan(date, bf, bt, tz));
  return { ...opts, id: `a${++seq}`, start: span.start, end: span.end, breaks };
};

const run = (code: string, shifts: LaborShift[], worker: Partial<LaborWorker> = {}, ctx: Partial<EvaluationContext> = {}) =>
  evaluateShifts({ jurisdiction: code, timeZone: ZONES[code], fairWorkweekCovered: true, ...ctx }, { id: 'w1', ...worker }, shifts);

const has = (findings: Finding[], rule: string, verdict?: Finding['verdict']) =>
  findings.filter((f) => f.rule === rule && (!verdict || f.verdict === verdict));

const verdicts = (findings: Finding[], verdict: Finding['verdict']) => findings.filter((f) => f.verdict === verdict);

const MON = '2026-10-19';
const TUE = '2026-10-20';

describe('Brazil: EC 141/2026 (DOU 2026-10-16)', () => {
  /** Mon–Fri 08:00–17:00 with a 1 h lunch (8 h) and Saturday 08:00–12:00: 44 h on 6 days. */
  const sixDayWeek = (monday: string) =>
    [0, 1, 2, 3, 4].map((d) => at('BR', addDaysToKey(monday, d), '08:00', '17:00', { breaks: [['12:00', '13:00']] }))
      .concat(at('BR', addDaysToKey(monday, 5), '08:00', '12:00'));

  it('BR-04 a 44 h 6x1 week is lawful before 2026-12-16', () => {
    const r = run('BR', sixDayWeek(MON));
    expect(has(r.findings, 'weekly.overtime')).toHaveLength(0);
    expect(has(r.findings, 'rest.weeklyDays')).toHaveLength(0);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
  });

  it('BR-05 the same week in 2027 has 2 h overtime (42 h) and only 1 of the 2 weekly rest days', () => {
    const r = run('BR', sixDayWeek('2027-01-04'));
    expect(has(r.findings, 'weekly.overtime', 'premium')[0].hours).toBe(2);
    const days = has(r.findings, 'rest.weeklyDays', 'violation');
    expect(days).toHaveLength(1);
    expect(days[0].message).toMatch(/2 days/);
  });

  it('BR-06 from 2027-12-16 the limit is 40 h: the same week has 4 h overtime', () => {
    expect(has(run('BR', sixDayWeek('2028-01-03')).findings, 'weekly.overtime', 'premium')[0].hours).toBe(4);
  });

  it('BR-07 a 5x2 week of 40 h in 2027 passes', () => {
    const week = [0, 1, 2, 3, 4].map((d) => at('BR', addDaysToKey('2027-01-04', d), '08:00', '17:00', { breaks: [['12:00', '13:00']] }));
    const r = run('BR', week);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
    expect(verdicts(r.findings, 'premium')).toHaveLength(0);
  });
});

describe('US fair-workweek clopening', () => {
  it('PHL-02 an 8 h gap without consent is a violation; with consent it earns $40', () => {
    const without = run('US-PA-PHILADELPHIA', [at('US-PA-PHILADELPHIA', MON, '15:00', '23:00'), at('US-PA-PHILADELPHIA', TUE, '07:00', '13:00')]);
    const v = has(without.findings, 'fairWorkweek.clopening', 'violation');
    expect(v).toHaveLength(1);
    // The Philadelphia FAQ asks for consent, not written consent.
    expect(v[0].message).not.toMatch(/written/);
    const withConsent = run('US-PA-PHILADELPHIA', [at('US-PA-PHILADELPHIA', MON, '15:00', '23:00'), at('US-PA-PHILADELPHIA', TUE, '07:00', '13:00', { restConsent: true })]);
    expect(has(withConsent.findings, 'fairWorkweek.clopening', 'premium')[0].amount).toEqual({ value: 40, currency: 'USD' });
  });

  it('EVN-01 a 10 h gap with written consent earns 1 h at 1.5× (Evanston 3-34-7)', () => {
    const r = run('US-IL-EVANSTON', [at('US-IL-EVANSTON', MON, '14:00', '22:00'), at('US-IL-EVANSTON', TUE, '08:00', '12:00', { restConsent: true })]);
    const p = has(r.findings, 'fairWorkweek.clopening', 'premium');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ hours: 1, multiplier: 1.5 });
    expect(has(r.findings, 'fairWorkweek.clopening', 'review')).toHaveLength(0);
  });

  it('CHI-02 the whole-shift 1.25× premium cites the city FAQ with high confidence', () => {
    const r = run('US-IL-CHICAGO', [at('US-IL-CHICAGO', MON, '14:00', '22:00'), at('US-IL-CHICAGO', TUE, '07:00', '13:00', { restConsent: true })]);
    const p = has(r.findings, 'fairWorkweek.clopening', 'premium')[0];
    expect(p).toMatchObject({ hours: 6, multiplier: 1.25 });
    expect(p.cite?.confidence).toBe('high');
    expect(p.cite?.source).not.toMatch(/not verified/);
  });
});

describe('Colombia: Ley 2101/2021 has no adult 8 h daily cap', () => {
  it('CO-03 five 8.4 h days (42 h) in the week of 2026-07-20 are all ordinary time', () => {
    const week = [0, 1, 2, 3, 4].map((d) => at('CO', addDaysToKey('2026-07-20', d), '07:00', '15:24'));
    const r = run('CO', week);
    expect(has(r.findings, 'daily.overtime')).toHaveLength(0);
    expect(has(r.findings, 'weekly.overtime')).toHaveLength(0);
    expect(verdicts(r.findings, 'premium')).toHaveLength(0);
  });

  it('CO-04 a 10 h day is not converted to overtime but asks for review of the agreed distribution', () => {
    const r = run('CO', [at('CO', '2026-07-20', '07:00', '17:00')]);
    expect(has(r.findings, 'daily.overtime')).toHaveLength(0);
    const review = has(r.findings, 'daily.ordinaryMax', 'review');
    expect(review).toHaveLength(1);
    expect(review[0].cite?.source).toMatch(/4-9/);
  });
});

describe('Peru: night work is a pay floor (D.S. 007-2002-TR art. 8)', () => {
  it('PE-02 a night shift shows the monthly floor RMV × 1.35, not a +35% surcharge', () => {
    const r = run('PE', [at('PE', MON, '22:00', '06:00', { breaks: [['02:00', '02:45']] })]);
    expect(has(r.findings, 'night.premium')).toHaveLength(0);
    const floor = has(r.findings, 'night.payFloor', 'review');
    expect(floor).toHaveLength(1);
    expect(floor[0].amount).toEqual({ value: 1660.5, currency: 'PEN' });
    expect(floor[0].multiplier).toBeUndefined();
  });

  it('PE-03 before 2026-10-01 the floor uses the S/ 1,130 RMV', () => {
    const r = run('PE', [at('PE', '2026-09-14', '22:00', '06:00', { breaks: [['02:00', '02:45']] })]);
    expect(has(r.findings, 'night.payFloor')[0].amount).toEqual({ value: 1525.5, currency: 'PEN' });
  });

  it('PE-04 a day shift has no night finding', () => {
    expect(has(run('PE', [at('PE', MON, '08:00', '16:00', { breaks: [['12:00', '12:45']] })]).findings, 'night.payFloor')).toHaveLength(0);
  });
});

describe('Canada: provincial employers are not under the Canada Labour Code', () => {
  it('CA-RES-01 resolves BC, federal, and other provinces', () => {
    expect(resolveJurisdiction({ country: 'CA', region: 'BC' })).toBe('CA-BC');
    expect(resolveJurisdiction({ country: 'CA', region: 'ON' })).toBe('CA-ON');
    expect(resolveJurisdiction({ country: 'CA', region: 'QC' })).toBe('CA-QC');
    expect(resolveJurisdiction({ country: 'CA', region: 'FED' })).toBe('CA');
    expect(resolveJurisdiction({ country: 'ca', region: 'ab' })).toBe('CA-OTHER');
    expect(resolveJurisdiction({ country: 'CA' })).toBe('CA-OTHER');
    expect(resolveJurisdiction({ country: 'CA', region: null })).toBe('CA-OTHER');
  });

  it('CA-RES-02 the federal code is offered as its own choice next to the provinces', () => {
    const regions = regionsFor('CA').map((j) => j.code);
    expect(regions).toEqual(expect.arrayContaining(['CA', 'CA-ON', 'CA-QC', 'CA-BC']));
    expect(regions).not.toContain('CA-OTHER');
    expect(getJurisdiction('CA')?.name).toMatch(/federally regulated/i);
  });

  it('CA-OTHER-01 an Alberta location gets a review notice and warnings only, not federal 96 h notice', () => {
    const shift = at('CA-OTHER', MON, '09:00', '15:00', { breaks: [['12:00', '12:30']] });
    const r = run('CA-OTHER', [at('CA-OTHER', '2026-10-18', '19:00', '23:00'), shift], {}, { publishedAt: shift.start - 72 * 3_600_000 });
    expect(has(r.findings, 'jurisdiction.baseline', 'review')).toHaveLength(1);
    expect(has(r.findings, 'notice.advance')).toHaveLength(0);
    expect(verdicts(r.findings, 'violation')).toHaveLength(0);
    expect(resolvePack('CA-OTHER').currency).toBe('CAD');
  });

  it('BC-01 7 h between shifts is a violation (ESA s.36(2): 8 h)', () => {
    const r = run('CA-BC', [at('CA-BC', MON, '19:00', '23:00'), at('CA-BC', TUE, '06:00', '10:00')]);
    expect(has(r.findings, 'rest.betweenShifts', 'violation')).toHaveLength(1);
  });

  it('BC-02 a 13 h day: 4 h at 1.5× and 1 h at 2× (ESA s.40)', () => {
    const r = run('CA-BC', [at('CA-BC', MON, '07:00', '20:30', { breaks: [['12:00', '12:30']] })]);
    expect(r.pay.regularHours).toBe(8);
    expect(r.pay.overtime).toEqual(expect.arrayContaining([{ multiplier: 1.5, hours: 4 }, { multiplier: 2, hours: 1 }]));
    expect(has(r.findings, 'breaks.minimum')).toHaveLength(0);
  });

  it('BC-03 6 h without a meal break is a violation (ESA s.32)', () => {
    expect(has(run('CA-BC', [at('CA-BC', MON, '09:00', '15:00')]).findings, 'breaks.minimum', 'violation')).toHaveLength(1);
  });

  it('BC-04 no 32 h off in a week is paid at 1.5×, not forbidden (ESA s.36(1))', () => {
    // Sunday 2026-10-18 through Monday 2026-10-26: 9 days of 09:00–14:00.
    const shifts = Array.from({ length: 9 }, (_, i) => at('CA-BC', addDaysToKey('2026-10-18', i), '09:00', '14:00'));
    const r = run('CA-BC', shifts);
    const weekly = has(r.findings, 'rest.weekly').filter((f) => f.message.includes(MON));
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({ verdict: 'premium', multiplier: 1.5 });
  });
});

describe('France: young workers (Service-Public F2216)', () => {
  const under16 = { birthDate: '2011-01-01' };
  const minors = (findings: Finding[], re: RegExp) => has(findings, 'minors', 'violation').filter((f) => re.test(f.message));

  it('FR-03 under 16: 5 h without a 30 min break is a violation; with it, none', () => {
    expect(minors(run('FR', [at('FR', MON, '09:00', '14:00')], under16).findings, /break/)).toHaveLength(1);
    expect(has(run('FR', [at('FR', MON, '09:00', '14:30', { breaks: [['12:00', '12:30']] })], under16).findings, 'minors')).toHaveLength(0);
  });

  it('FR-04 under 16: 36 h on 6 days breaks the 35 h week and the 2-day weekly rest', () => {
    const week = [0, 1, 2, 3, 4, 5].map((d) => at('FR', addDaysToKey(MON, d), '09:00', '15:30', { breaks: [['12:00', '12:30']] }));
    const f = run('FR', week, under16).findings;
    expect(minors(f, /35 h weekly limit/)).toHaveLength(1);
    expect(minors(f, /48 consecutive hours/)).toHaveLength(1);
  });

  it('FR-05 under 16: designated overtime is a violation', () => {
    expect(minors(run('FR', [at('FR', MON, '09:00', '13:00', { overtimeHours: 1 })], under16).findings, /overtime/)).toHaveLength(1);
  });

  it('FR-06 16-17: 6 days in a week break the 2-day weekly rest', () => {
    const week = [0, 1, 2, 3, 4, 5].map((d) => at('FR', addDaysToKey(MON, d), '09:00', '13:00'));
    expect(minors(run('FR', week, { birthDate: '2009-06-01' }).findings, /48 consecutive hours/)).toHaveLength(1);
  });
});
