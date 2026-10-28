/**
 * CHG-089: location overrides may only make rules stricter. They are checked
 * against the resolved pack on save and applied stricter-wins by the engine
 * and the auto-assigner's legal constraints.
 */
import { zonedShiftSpan } from '@/utils/zonedTime';
import { legalConstraintsFor } from '../assignerConstraints';
import { evaluateShifts, resolvePack } from '../engine';
import { applyOverrides, isStricter, parseOverride, parseStoredOverrides, validateOverrides } from '../overrides';
import type { LaborShift, LocationOverride } from '../types';

const DAY = '2026-10-21';
let seq = 0;
const at = (date: string, from: string, to: string, tz: string, extra: Partial<LaborShift> = {}): LaborShift => ({
  id: `s${++seq}`, ...zonedShiftSpan(date, from, to, tz), ...extra,
});

describe('parseOverride', () => {
  it.each([
    [{ rule: 'rest.minHours', value: 13 }],
    [{ rule: 'daily.maxHours', value: 8, note: 'Company policy' }],
    [{ rule: 'weekly.maxHours', value: 40 }],
    [{ rule: 'breaks.minMinutes', value: 30, afterHours: 5 }],
  ])('accepts %j', (raw) => {
    expect(parseOverride(raw).ok).toBe(true);
  });

  it.each([
    ['a non-object', 'x', /must be an object/],
    ['an unknown rule', { rule: 'night.premium', value: 1 }, /rule must be one of/],
    ['a missing value', { rule: 'rest.minHours' }, /value/],
    ['a zero value', { rule: 'rest.minHours', value: 0 }, /value/],
    ['a rest above 24 h', { rule: 'rest.minHours', value: 25 }, /value/],
    ['a week above 168 h', { rule: 'weekly.maxHours', value: 169 }, /value/],
    ['fractional break minutes', { rule: 'breaks.minMinutes', value: 12.5, afterHours: 4 }, /whole number/],
    ['a break without afterHours', { rule: 'breaks.minMinutes', value: 30 }, /afterHours/],
    ['afterHours on another rule', { rule: 'rest.minHours', value: 13, afterHours: 4 }, /afterHours is not allowed/],
    ['an unknown key', { rule: 'rest.minHours', value: 13, verdict: 'warning' }, /verdict is not allowed/],
    ['a long note', { rule: 'rest.minHours', value: 13, note: 'x'.repeat(201) }, /note/],
  ])('rejects %s', (_label, raw, message) => {
    const r = parseOverride(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });

  it('keeps only valid stored overrides', () => {
    expect(parseStoredOverrides([{ rule: 'rest.minHours', value: 13 }, {}, { foo: 1 }])).toEqual([{ rule: 'rest.minHours', value: 13 }]);
    expect(parseStoredOverrides(null)).toEqual([]);
  });
});

describe('validateOverrides: stricter than the pack only', () => {
  const ES = resolvePack('ES');
  const ok = (code: string, overrides: LocationOverride[]) => validateOverrides(overrides, resolvePack(code), DAY);

  it('accepts stricter values', () => {
    expect(ok('ES', [{ rule: 'rest.minHours', value: 13 }]).ok).toBe(true); // law: 12 h
    expect(ok('ES', [{ rule: 'daily.maxHours', value: 8 }]).ok).toBe(true); // law: 9 h ordinary
    expect(ok('FR', [{ rule: 'weekly.maxHours', value: 44 }]).ok).toBe(true); // law: 48 h
    expect(ok('ES', [{ rule: 'breaks.minMinutes', value: 30, afterHours: 6 }]).ok).toBe(true); // law: 15 min after 6 h
    expect(ok('ES', [{ rule: 'breaks.minMinutes', value: 10, afterHours: 4 }]).ok).toBe(true); // law: none after 4 h
  });

  it('accepts any limit where the pack has none', () => {
    expect(ok('US', [{ rule: 'rest.minHours', value: 10 }, { rule: 'daily.maxHours', value: 10 }, { rule: 'weekly.maxHours', value: 50 }]).ok).toBe(true);
  });

  it('accepts an equal value when the pack rule is only a warning (it becomes a hard limit)', () => {
    expect(ok('GENERIC', [{ rule: 'rest.minHours', value: 11 }]).ok).toBe(true);
    expect(ok('ES', [{ rule: 'rest.minHours', value: 12 }]).ok).toBe(false);
  });

  it.each([
    ['a shorter rest', 'ES', { rule: 'rest.minHours', value: 10 }, /minimum rest of 10 h between shifts is not stricter than the law in Spain on 2026-10-21, which sets a minimum rest of 12 h/],
    ['an equal rest', 'ES', { rule: 'rest.minHours', value: 12 }, /not stricter/],
    ['a longer day', 'ES', { rule: 'daily.maxHours', value: 10 }, /daily maximum of 10 h is not stricter .* daily maximum of 9 h/],
    ['a longer week', 'FR', { rule: 'weekly.maxHours', value: 50 }, /weekly maximum of 50 h .* weekly maximum of 48 h/],
    ['a shorter break', 'ES', { rule: 'breaks.minMinutes', value: 10, afterHours: 6 }, /break of 10 min after more than 6 h .* break of 15 min/],
    ['a shorter rest in Ontario', 'CA-ON', { rule: 'rest.minHours', value: 6 }, /Ontario/],
  ] as [string, string, LocationOverride, RegExp][])('rejects %s', (_label, code, override, message) => {
    const r = ok(code, [override]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('OVERRIDE_NOT_STRICTER');
      expect(r.message).toMatch(message);
      expect(r.message).toMatch(/can only make a rule stricter/);
    }
  });

  it('rejects duplicates and malformed lists', () => {
    expect(validateOverrides([{ rule: 'rest.minHours', value: 13 }, { rule: 'rest.minHours', value: 14 }], ES, DAY)).toMatchObject({ ok: false, code: 'OVERRIDES_INVALID' });
    expect(validateOverrides({}, ES, DAY)).toMatchObject({ ok: false, code: 'OVERRIDES_INVALID' });
    expect(validateOverrides(Array(21).fill({ rule: 'rest.minHours', value: 13 }), ES, DAY)).toMatchObject({ ok: false, code: 'OVERRIDES_INVALID' });
    // Two break overrides at different thresholds are fine.
    expect(validateOverrides([
      { rule: 'breaks.minMinutes', value: 20, afterHours: 5 },
      { rule: 'breaks.minMinutes', value: 45, afterHours: 8 },
    ], ES, DAY).ok).toBe(true);
  });

  it('uses the value in force on the date (dated pack values)', () => {
    // A pack whose rest minimum rises from 11 h to 13 h on 2027-01-01.
    const pack = { ...ES, restBetweenShifts: { ...ES.restBetweenShifts!, minHours: [{ from: '2000-01-01', value: 11 }, { from: '2027-01-01', value: 13 }] } };
    expect(isStricter(pack, { rule: 'rest.minHours', value: 12 }, '2026-12-31')).toBe(true);
    expect(isStricter(pack, { rule: 'rest.minHours', value: 12 }, '2027-01-01')).toBe(false);
  });
});

describe('overrides in the engine', () => {
  const TZ = 'Europe/Madrid';
  // 12.5 h of rest: legal in Spain (12 h), short under a 13 h override.
  const pair = () => [at('2026-11-02', '14:00', '21:30', TZ), at('2026-11-03', '10:00', '14:00', TZ)];

  it('a rest override flags a rest the law allows, citing the override and the law', () => {
    const shifts = pair();
    const ctx = { jurisdiction: 'ES', timeZone: TZ };
    expect(evaluateShifts(ctx, { id: 'w' }, shifts).findings.filter((f) => f.rule === 'rest.betweenShifts')).toEqual([]);
    const withOverride = evaluateShifts({ ...ctx, overrides: [{ rule: 'rest.minHours', value: 13 }] }, { id: 'w' }, shifts);
    const rest = withOverride.findings.filter((f) => f.rule === 'rest.betweenShifts');
    expect(rest).toHaveLength(1);
    expect(rest[0].verdict).toBe('violation');
    expect(rest[0].cite?.source).toMatch(/^Location override; stricter than Estatuto de los Trabajadores/);
  });

  it('a daily maximum override applies where the law has none (US)', () => {
    const shifts = [at('2026-11-02', '08:00', '18:00', 'America/New_York')];
    const ctx = { jurisdiction: 'US', timeZone: 'America/New_York' };
    expect(evaluateShifts(ctx, { id: 'w' }, shifts).findings.filter((f) => f.rule === 'daily.totalMax')).toEqual([]);
    const r = evaluateShifts({ ...ctx, overrides: [{ rule: 'daily.maxHours', value: 9, note: 'Company policy' }] }, { id: 'w' }, shifts);
    const daily = r.findings.filter((f) => f.rule === 'daily.totalMax');
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ verdict: 'violation', hours: 10 });
    expect(daily[0].cite?.source).toBe('Location override (Company policy)');
  });

  it('a weekly maximum override applies (FR 48 h → 40 h)', () => {
    const TZP = 'Europe/Paris';
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => at(d, '08:00', '17:00', TZP, { breaks: [] }));
    const ctx = { jurisdiction: 'FR', timeZone: TZP };
    expect(evaluateShifts(ctx, { id: 'w' }, week).findings.filter((f) => f.rule === 'weekly.max')).toEqual([]);
    const r = evaluateShifts({ ...ctx, overrides: [{ rule: 'weekly.maxHours', value: 40 }] }, { id: 'w' }, week);
    expect(r.findings.filter((f) => f.rule === 'weekly.max' && f.verdict === 'violation')).toHaveLength(1);
  });

  it('a break override requires a longer break', () => {
    const s = at('2026-11-02', '08:00', '13:30', TZ);
    const ctx = { jurisdiction: 'ES', timeZone: TZ };
    expect(evaluateShifts(ctx, { id: 'w' }, [s]).findings.filter((f) => f.rule === 'breaks.minimum')).toEqual([]);
    const r = evaluateShifts({ ...ctx, overrides: [{ rule: 'breaks.minMinutes', value: 20, afterHours: 5 }] }, { id: 'w' }, [s]);
    expect(r.findings.filter((f) => f.rule === 'breaks.minimum' && f.verdict === 'violation')).toHaveLength(1);
  });

  it('a laxer stored override never loosens the law (stricter wins)', () => {
    const shortRest = [at('2026-11-02', '15:00', '23:00', TZ), at('2026-11-03', '09:00', '13:00', TZ)]; // 10 h
    const r = evaluateShifts({ jurisdiction: 'ES', timeZone: TZ, overrides: [{ rule: 'rest.minHours', value: 8 }] }, { id: 'w' }, shortRest);
    expect(r.findings.filter((f) => f.rule === 'rest.betweenShifts' && f.verdict === 'violation')).toHaveLength(1);
    const pack = applyOverrides(resolvePack('FR'), [{ rule: 'weekly.maxHours', value: 60 }, { rule: 'daily.maxHours', value: 12 }]);
    expect(pack.weeklyMax?.hours).toBe(48);
    expect(pack.dailyTotalMax?.hours).toBe(10);
  });

  it('leaves the pack unchanged without overrides', () => {
    const pack = resolvePack('ES');
    expect(applyOverrides(pack, undefined)).toBe(pack);
    expect(applyOverrides(pack, [])).toBe(pack);
  });
});

describe('overrides in the auto-assigner constraints', () => {
  it('rest, daily and weekly overrides become constraints; laxer ones change nothing', () => {
    expect(legalConstraintsFor('ES', '2026-11-02', [
      { rule: 'rest.minHours', value: 13 },
      { rule: 'daily.maxHours', value: 8 },
      { rule: 'weekly.maxHours', value: 38 },
    ])).toEqual({ minRestHoursBetweenShifts: 13, maxDailyHours: 8, maxWeeklyHours: 38 });
    expect(legalConstraintsFor('ES', '2026-11-02', [{ rule: 'rest.minHours', value: 8 }, { rule: 'daily.maxHours', value: 11 }]))
      .toEqual(legalConstraintsFor('ES', '2026-11-02'));
    // Peru's rest rule is only a warning (no constraint); an override makes it one.
    expect(legalConstraintsFor('PE', '2026-11-02').minRestHoursBetweenShifts).toBeUndefined();
    expect(legalConstraintsFor('PE', '2026-11-02', [{ rule: 'rest.minHours', value: 10 }]).minRestHoursBetweenShifts).toBe(10);
  });
});
