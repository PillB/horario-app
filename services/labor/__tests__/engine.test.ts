import { addDaysToKey } from '@/utils/dateKeys';
import { zonedShiftSpan } from '@/utils/zonedTime';
import { evaluateRoster, evaluateShifts, jurisdictionLabel, resolveDated, resolvePack } from '../engine';
import { JURISDICTIONS, jurisdictionChain, resolveJurisdiction } from '../jurisdictions';
import { PACKS } from '../packs';
import type { LaborShift } from '../types';

const TZ = 'Europe/Madrid';
let n = 0;
const shift = (date: string, from: string, to: string, tz = TZ, extra: Partial<LaborShift> = {}): LaborShift => ({
  id: `x${++n}`, ...zonedShiftSpan(date, from, to, tz), ...extra,
});

describe('jurisdictions', () => {
  it('resolves the most specific place that has a pack', () => {
    expect(resolveJurisdiction({ country: 'us', region: 'ca', city: 'berkeley' })).toBe('US-CA-BERKELEY');
    expect(resolveJurisdiction({ country: 'US', region: 'CA', city: 'Fresno' })).toBe('US-CA');
    expect(resolveJurisdiction({ country: 'US', region: 'TX' })).toBe('US');
    expect(resolveJurisdiction({ country: 'AT' })).toBe('EU');
    expect(resolveJurisdiction({ country: 'JP' })).toBe('GENERIC');
  });

  it('chains from broad to specific', () => {
    expect(jurisdictionChain('US-CA-BERKELEY')).toEqual(['US', 'US-CA', 'US-CA-BERKELEY']);
    expect(jurisdictionChain('ES')).toEqual(['EU', 'ES']);
    expect(jurisdictionLabel('US-CA-BERKELEY')).toBe('Berkeley, California, United States (federal)');
  });

  it('every jurisdiction resolves to a pack with cited rules', () => {
    for (const j of JURISDICTIONS) {
      const pack = resolvePack(j.code);
      expect(pack.code).toBe(j.code);
      expect(jurisdictionChain(j.code).some((c) => PACKS[c])).toBe(true);
    }
    for (const pack of Object.values(PACKS)) {
      for (const [key, value] of Object.entries(pack)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && 'cite' in value) {
          expect([key, (value as { cite: { source: string } }).cite.source.length > 0]).toEqual([key, true]);
        }
      }
    }
  });
});

describe('engine', () => {
  it('inherits parent sections: Berkeley keeps California overtime', () => {
    const tz = 'America/Los_Angeles';
    const r = evaluateShifts({ jurisdiction: 'US-CA-BERKELEY', timeZone: tz }, { id: 'w' }, [
      shift('2026-10-19', '08:00', '19:00', tz, { breaks: [] , mealWaiver: false }),
    ]);
    expect(r.pay.overtime).toEqual([{ multiplier: 1.5, hours: 3 }]);
  });

  it('resolves dated values by date', () => {
    const v = [{ from: '2020-01-01', value: 1 }, { from: '2026-07-15', value: 2 }];
    expect(resolveDated(v, '2026-07-14')).toBe(1);
    expect(resolveDated(v, '2026-07-15')).toBe(2);
    expect(resolveDated(5, '2026-01-01')).toBe(5);
    expect(resolveDated(['22:00', '06:00'], '2026-01-01')).toEqual(['22:00', '06:00']);
  });

  it('adds up split shifts on the same day for daily limits', () => {
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [
      shift('2026-10-19', '08:00', '13:00'),
      shift('2026-10-19', '15:00', '20:00'),
    ]);
    expect(r.findings.filter((f) => f.rule === 'daily.ordinaryMax')).toHaveLength(1);
  });

  it('flags a week with no weekly rest; a shortfall that rests on unseen days is only a warning', () => {
    // Three weeks worked every day: the middle week is fully known, so it is a violation.
    const all = Array.from({ length: 21 }, (_, d) => shift(addDaysToKey('2026-11-02', d), '09:00', '14:00'));
    const weekly = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, all).findings.filter((f) => f.rule === 'rest.weekly');
    // ES weekly rest is itself a warning (14-day accumulation), so test the verdict logic on France.
    expect(weekly).toHaveLength(3);
    const fr = evaluateShifts({ jurisdiction: 'FR', timeZone: 'Europe/Paris' }, { id: 'w' },
      Array.from({ length: 21 }, (_, d) => shift(addDaysToKey('2026-11-02', d), '09:00', '14:00', 'Europe/Paris')));
    const verdicts = fr.findings.filter((f) => f.rule === 'rest.weekly').map((f) => f.verdict);
    expect(verdicts).toEqual(['warning', 'violation', 'warning']);
    const five = all.slice(0, 5);
    expect(evaluateShifts({ jurisdiction: 'FR', timeZone: TZ }, { id: 'w' }, five).findings.filter((f) => f.rule === 'rest.weekly')).toHaveLength(0);
  });

  it('gives the remaining hours budget when a short schedule is on track to exceed an average', () => {
    const tz = 'Europe/Paris';
    const week = [0, 1, 2, 3, 4].map((d) => shift(addDaysToKey('2026-11-02', d), '08:00', '18:00', tz));
    const f = evaluateShifts({ jurisdiction: 'FR', timeZone: tz }, { id: 'w' }, week).findings.find((x) => x.rule === 'weekly.average');
    expect(f?.verdict).toBe('warning');
    expect(f?.hours).toBe(44 * 12 - 50);
    expect(f?.message).toContain('for the other 11 weeks');
  });

  it('requires two days off each week for Spanish minors', () => {
    const six = [0, 1, 2, 3, 4, 5].map((d) => shift(addDaysToKey('2026-11-02', d), '10:00', '14:00'));
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w', birthDate: '2010-01-01' }, six);
    expect(r.findings.some((f) => f.rule === 'minors' && f.message.includes('48 consecutive hours'))).toBe(true);
    const five = six.slice(0, 5);
    expect(evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w', birthDate: '2010-01-01' }, five).findings.some((f) => f.rule === 'minors')).toBe(false);
  });

  it('applies minor rules from the birthday on', () => {
    const tz = 'Europe/Madrid';
    const late = (date: string) => shift(date, '21:00', '23:00', tz);
    const before18 = evaluateShifts({ jurisdiction: 'ES', timeZone: tz }, { id: 'w', birthDate: '2008-10-20' }, [late('2026-10-19')]);
    const on18 = evaluateShifts({ jurisdiction: 'ES', timeZone: tz }, { id: 'w', birthDate: '2008-10-20' }, [late('2026-10-20')]);
    expect(before18.findings.some((f) => f.rule === 'minors')).toBe(true);
    expect(on18.findings.some((f) => f.rule === 'minors')).toBe(false);
  });

  it('says when only a baseline or generic pack applies', () => {
    const tz = 'Asia/Tokyo';
    const r = evaluateShifts({ jurisdiction: 'GENERIC', timeZone: tz }, { id: 'w' }, [shift('2026-10-19', '08:00', '19:00', tz)]);
    expect(r.findings.find((f) => f.rule === 'jurisdiction.baseline')?.verdict).toBe('review');
    expect(r.findings.filter((f) => f.verdict === 'violation')).toHaveLength(0);
    expect(r.findings.some((f) => f.rule === 'daily.totalMax' && f.verdict === 'warning')).toBe(true);
  });

  it('does not depend on the device time zone', () => {
    // The suite also runs under TZ=Asia/Tokyo and TZ=America/Lima in CI checks;
    // here, the result for a Lima location must not change with the zone it is read in.
    const tz = 'America/Lima';
    const shifts = [shift('2026-10-19', '22:00', '06:00', tz), shift('2026-10-20', '08:00', '12:00', tz)];
    const r = evaluateShifts({ jurisdiction: 'PE', timeZone: tz }, { id: 'w' }, shifts);
    expect(r.findings.find((f) => f.rule === 'night.premium')?.hours).toBe(8);
    expect(r.findings.find((f) => f.rule === 'rest.betweenShifts')?.hours).toBe(2);
  });

  it('evaluates a roster per worker', () => {
    const findings = evaluateRoster({ jurisdiction: 'ES', timeZone: TZ }, [{ id: 'a' }, { id: 'b' }], {
      a: [shift('2026-10-19', '08:00', '19:00')],
      b: [shift('2026-10-19', '08:00', '12:00')],
    });
    expect(new Set(findings.map((f) => f.workerId))).toEqual(new Set(['a']));
  });
});

describe('QA adversarial regressions', () => {
  const restViolations = (r: ReturnType<typeof evaluateShifts>) =>
    r.findings.filter((f) => f.rule === 'rest.betweenShifts' && f.verdict === 'violation');

  it('ES-SPLIT-01: a split shift on one day is one working day, not a rest violation', () => {
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [
      shift('2026-11-02', '10:00', '14:00'),
      shift('2026-11-02', '17:00', '21:00'),
    ]);
    expect(restViolations(r)).toHaveLength(0);
    expect(r.findings.some((f) => f.rule === 'daily.ordinaryMax')).toBe(false);
  });

  it('ES-SPLIT-02: a split shift across midnight is one working day', () => {
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [
      shift('2026-11-02', '20:00', '23:30'),
      shift('2026-11-03', '00:30', '04:00'),
    ]);
    expect(restViolations(r)).toHaveLength(0);
  });

  it('GB-REST-SPLIT-01: a short overnight rest is not merged into one working day', () => {
    const tz = 'Europe/London';
    const rest = (code: string, zone: string, a: [string, string], b: [string, string]) =>
      evaluateShifts({ jurisdiction: code, timeZone: zone }, { id: 'w' }, [
        shift('2026-11-02', a[0], a[1], zone), shift('2026-11-03', b[0], b[1], zone),
      ]).findings.filter((f) => f.rule === 'rest.betweenShifts');
    expect(rest('GB', tz, ['16:00', '23:00'], ['04:00', '08:00']).map((f) => f.hours)).toEqual([5]);
    expect(rest('IE', 'Europe/Dublin', ['18:00', '23:00'], ['04:00', '08:00'])).toHaveLength(1);
    expect(rest('ES', TZ, ['15:00', '23:00'], ['04:00', '08:00'])).toHaveLength(1);
    expect(rest('DE', 'Europe/Berlin', ['14:00', '22:00'], ['03:00', '07:00'])).toHaveLength(1);
  });

  it('ES-DRIP-01: short shifts with short gaps do not chain into a multi-day working day', () => {
    // 1.5 h shifts every 7 h 20 min (5 h 50 min gaps) for two and a half days.
    const start = zonedShiftSpan('2026-11-02', '06:00', '07:30', TZ).start;
    const drip: LaborShift[] = Array.from({ length: 8 }, (_, i) => {
      const s = start + i * (7 * 60 + 20) * 60e3;
      return { id: `d${i}`, start: s, end: s + 90 * 60e3 };
    });
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, drip);
    expect(restViolations(r).length).toBeGreaterThan(0);
  });

  it('keeps a long Spanish split day (09-14 + 17-22) as one working day', () => {
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [
      shift('2026-11-02', '09:00', '14:00'),
      shift('2026-11-02', '17:00', '22:00'),
    ]);
    expect(restViolations(r)).toHaveLength(0);
  });

  it('still flags short rest between two separate working days', () => {
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [
      shift('2026-11-02', '14:00', '22:00'),
      shift('2026-11-03', '06:00', '12:00'),
    ]);
    expect(restViolations(r)).toHaveLength(1);
  });

  it('counts only the days worked as a minor toward the minor weekly cap', () => {
    const tz = 'Europe/Berlin';
    const week = [0, 1, 2, 3, 4, 5].map((d) => shift(addDaysToKey('2026-10-19', d), '08:00', '16:00', tz));
    const weeklyMinor = (birthDate: string) => evaluateShifts({ jurisdiction: 'DE', timeZone: tz }, { id: 'w', birthDate }, week)
      .findings.filter((f) => f.rule === 'minors' && f.message.includes('weekly limit for this young worker'));
    // Turns 18 on Thursday: only Mon to Wed (24 h) count, under the 40 h cap.
    expect(weeklyMinor('2008-10-22')).toHaveLength(0);
    expect(weeklyMinor('2009-10-22')).toHaveLength(1);
  });

  it('ignores breaks outside the shift', () => {
    const outside = shift('2026-11-02', '08:00', '17:00', TZ, { breaks: [zonedShiftSpan('2026-11-02', '18:00', '20:00', TZ)] });
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [outside]);
    expect(r.findings.some((f) => f.rule === 'breaks.minimum')).toBe(true);
    expect(r.findings.some((f) => f.rule === 'daily.ordinaryMax')).toBe(false);
  });

  it('reports invalid shifts without throwing and flags overlaps', () => {
    const bad: LaborShift[] = [
      { id: 'inv', start: Date.UTC(2026, 10, 2, 10), end: Date.UTC(2026, 10, 2, 8) },
      { id: 'nan', start: Number.NaN, end: Date.UTC(2026, 10, 2, 8) },
    ];
    const ok = [shift('2026-11-02', '08:00', '12:00'), shift('2026-11-02', '11:00', '14:00')];
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, [...bad, ...ok]);
    expect(r.findings.filter((f) => f.rule === 'input.invalid').map((f) => f.shiftIds[0]).sort()).toEqual(['inv', 'nan']);
    expect(r.findings.filter((f) => f.rule === 'shift.overlap').map((f) => f.shiftIds)).toEqual([[ok[0].id, ok[1].id]]);
  });

  it('allows Mexican overtime on at most four days a week', () => {
    const tz = 'America/Mexico_City';
    const days = (count: number) => Array.from({ length: count }, (_, d) =>
      shift(addDaysToKey('2030-01-07', d), '08:00', '17:00', tz, { overtimeHours: 1 }));
    const otDays = (count: number) => evaluateShifts({ jurisdiction: 'MX', timeZone: tz }, { id: 'w' }, days(count))
      .findings.filter((f) => f.rule === 'weekly.overtimeDays');
    expect(otDays(4)).toHaveLength(0);
    expect(otDays(5)).toHaveLength(1);
  });
});
