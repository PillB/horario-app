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

  it('flags a week with no weekly rest, but not one that ends before the schedule does', () => {
    const seven = [0, 1, 2, 3, 4, 5, 6].map((d) => shift(addDaysToKey('2026-11-02', d), '09:00', '14:00'));
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, seven);
    expect(r.findings.filter((f) => f.rule === 'rest.weekly')).toHaveLength(1);
    const five = seven.slice(0, 5);
    expect(evaluateShifts({ jurisdiction: 'ES', timeZone: TZ }, { id: 'w' }, five).findings.filter((f) => f.rule === 'rest.weekly')).toHaveLength(0);
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
