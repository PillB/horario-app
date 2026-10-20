import fs from 'fs';
import path from 'path';

import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';

import {
  buildRoleSeries,
  buildSignalMultipliers,
  statisticalForecast,
  statisticalForecastAsync,
  type HistoryDay,
} from '../statisticalForecast';
import { normal, rng } from '../testUtils/synthetic';

/** Staff per weekday (0 = Sunday … 6 = Saturday), keyed by the calendar date itself. */
const BY_WEEKDAY = [9, 3, 3, 4, 4, 6, 10];

/** `days` days of history ending the day before `before`, demand by weekday plus noise. */
const history = (role: string, before: string, days: number, noise = 0, seed = 1): HistoryDay[] => {
  const z = normal(rng(seed));
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToKey(before, i - days);
    return { date, role, shifts: Math.max(0, Math.round(BY_WEEKDAY[weekdayOfKey(date)] + noise * z())) };
  });
};

describe('series building', () => {
  it('fills days without shifts with 0, starts each role on its own first day and ends all roles together', () => {
    const series = buildRoleSeries(
      [
        { date: '2026-03-01', role: 'Cook', shifts: 2 },
        { date: '2026-03-04', role: 'Cook', shifts: 1 },
        { date: '2026-03-03', role: 'Barista', shifts: 4 },
        { date: '2026-03-03', role: 'Barista', shifts: 1 },
        { date: '2026-03-09', role: 'Cook', shifts: 9 }, // on/after `before`: ignored
      ],
      () => 1,
      '2026-03-09',
    );
    expect(series).toEqual([
      { role: 'Barista', start: '2026-03-03', end: '2026-03-04', values: [5, 0] },
      { role: 'Cook', start: '2026-03-01', end: '2026-03-04', values: [2, 0, 0, 1] },
    ]);
  });

  it('ignores malformed rows', () => {
    const series = buildRoleSeries(
      [
        { date: '2026-02-30', role: 'Cook', shifts: 2 },
        { date: '2026-03-01', role: '', shifts: 2 },
        { date: '2026-03-01', role: 'Cook', shifts: -1 },
        { date: '2026-03-01', role: 'Cook', shifts: Number.NaN },
        { date: '2026-03-02', role: 'Cook', shifts: 3 },
      ],
      () => 1,
      '2026-04-01',
    );
    expect(series).toEqual([{ role: 'Cook', start: '2026-03-02', end: '2026-03-02', values: [3] }]);
  });
});

describe('external signals', () => {
  const mult = buildSignalMultipliers([
    { date: '2026-05-01', role: 'Cook', signal_type: 'event', weight: 1.5 },
    { date: '2026-05-01', role: 'Cook', signal_type: 'promo', weight: 1.2 },
    { date: '2026-05-01', role: 'global', signal_type: 'holiday', weight: 2 },
    { date: '2026-05-02', role: 'GLOBAL', signal_type: 'holiday', weight: 0.5 },
    { date: '2026-05-03', role: 'Cook', weight: 0 },
    { date: '2026-05-03', role: 'Cook', weight: -2 },
    { date: '2026-05-03', role: 'Cook', weight: 50 },
    { date: '2026-05-03', role: 'Cook', weight: null },
  ]);

  it('multiplies several signals on one day', () => {
    expect(mult('2026-05-01', 'Cook')).toBeCloseTo(1.8, 10);
  });

  it("uses global signals for roles without their own, and a role's own signals first", () => {
    expect(mult('2026-05-01', 'Barista')).toBe(2);
    expect(mult('2026-05-02', 'Cook')).toBe(0.5);
  });

  it('ignores zero, negative, missing and implausible (> 10) weights', () => {
    expect(mult('2026-05-03', 'Cook')).toBe(1);
  });

  it('removes past signals from the history and applies future ones to the forecast', () => {
    const before = '2026-06-01';
    const base = history('Cook', before, 140);
    // A ×2 event two weeks ago doubled demand that day.
    const eventDay = addDaysToKey(before, -14);
    const boosted = base.map((d) => (d.date === eventDay ? { ...d, shifts: d.shifts * 2 } : d));
    const target = addDaysToKey(before, 6);
    const signals = [
      { date: eventDay, role: 'Cook', signal_type: 'event', weight: 2 },
      { date: target, role: 'Cook', signal_type: 'event', weight: 1.5 },
    ];
    const plain = statisticalForecast({ history: base, targetDates: [target] });
    const withSignals = statisticalForecast({ history: boosted, signals, targetDates: [target] });
    expect(withSignals.forecasts[0].expected).toBeCloseTo(plain.forecasts[0].expected! * 1.5, 6);
    expect(withSignals.forecasts[0].signalMultiplier).toBe(1.5);
    expect(withSignals.forecasts[0].required).toBe(Math.ceil(BY_WEEKDAY[weekdayOfKey(target)] * 1.5));
  });
});

describe('statisticalForecast', () => {
  it('forecasts each role with the planned headcount at the service level, rounded up', () => {
    const before = '2026-10-19';
    const result = statisticalForecast({
      history: [...history('Cook', before, 200, 1, 3), ...history('Barista', before, 200, 1, 4)],
      targetDates: [before, addDaysToKey(before, 1)],
    });
    expect(result.models.map((m) => m.role)).toEqual(['Barista', 'Cook']);
    expect(result.forecasts).toHaveLength(4);
    for (const f of result.forecasts) {
      expect(Number.isInteger(f.required)).toBe(true);
      expect(f.source).toBe('model');
      expect(f.serviceLevel).toBe(0.8);
      expect(f.intervalLevel).toBe(0.8);
      expect(f.required).toBeGreaterThanOrEqual(Math.floor(f.expected!));
      expect(f.lowerBound!).toBeLessThanOrEqual(f.expected!);
      expect(f.upperBound!).toBeGreaterThanOrEqual(f.expected!);
      expect(f.mase).toBeLessThan(1);
      expect(f.required).toBe(Math.ceil(f.required - 1e-9));
    }
    const m = result.models[0];
    expect(m.backtestOrigins).toBe(10);
    expect(m.scores.map((s) => s.model)).toEqual(['seasonalNaive', 'dowProfile', 'holtWinters']);
  });

  it('plans for an exact quantile without adding a worker for rounding noise', () => {
    const before = '2026-10-19';
    const result = statisticalForecast({ history: history('Cook', before, 120), targetDates: [before] });
    // A noiseless weekly pattern: every model is exact and the interval is a point.
    expect(result.forecasts[0].required).toBe(BY_WEEKDAY[weekdayOfKey(before)]);
  });

  it('only uses history before the first target date', () => {
    const before = '2026-01-15';
    const past = history('Cook', before, 100);
    const future = [{ date: before, role: 'Cook', shifts: 500 }, { date: '2026-02-01', role: 'Cook', shifts: 500 }];
    const a = statisticalForecast({ history: past, targetDates: [before] });
    const b = statisticalForecast({ history: [...past, ...future], targetDates: [before] });
    expect(b.forecasts).toEqual(a.forecasts);
  });

  it('reports requested roles with no history and makes no forecast for them', () => {
    const result = statisticalForecast({
      history: history('Cook', '2026-05-01', 60),
      targetDates: ['2026-05-01'],
      roles: ['Cook', 'Sommelier'],
    });
    expect(result.rolesWithoutHistory).toEqual(['Sommelier']);
    expect(result.forecasts.map((f) => f.role)).toEqual(['Cook']);
  });

  it('falls back to seasonal naive with little history', () => {
    const result = statisticalForecast({ history: history('Cook', '2026-05-01', 10), targetDates: ['2026-05-01'] });
    expect(result.models[0]).toMatchObject({ model: 'seasonalNaive', mase: null, backtestOrigins: 0, historyDays: 10 });
    expect(result.forecasts[0].mase).toBeUndefined();
    expect(result.forecasts[0].model).toBe('seasonalNaive');
  });

  it('returns nothing without valid target dates', () => {
    expect(statisticalForecast({ history: history('Cook', '2026-05-01', 60), targetDates: ['2026-13-01'] })).toEqual({
      forecasts: [],
      models: [],
      rolesWithoutHistory: [],
    });
  });

  it('the async variant yields once per role and returns the same result', async () => {
    const input = {
      history: [...history('Cook', '2026-05-01', 90, 1), ...history('Host', '2026-05-01', 90, 1, 2)],
      targetDates: ['2026-05-01', '2026-05-02'],
    };
    const pause = jest.fn(() => Promise.resolve());
    await expect(statisticalForecastAsync(input, {}, pause)).resolves.toEqual(statisticalForecast(input));
    expect(pause).toHaveBeenCalledTimes(2);
  });
});

describe('DST and time-zone safety', () => {
  // US DST: 2026-03-08 and 2026-11-01; EU: 2026-03-29 and 2026-10-25.
  const ACROSS_DST = ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01'];

  it('keeps one entry per calendar day across DST changes', () => {
    const series = buildRoleSeries(history('Cook', '2026-11-15', 300), () => 1, '2026-11-15');
    expect(series[0].values).toHaveLength(300);
    expect(series[0].start).toBe(addDaysToKey('2026-11-15', -300));
  });

  it.each(ACROSS_DST)('forecasts the right weekday on and after %s', (change) => {
    const before = addDaysToKey(change, -3);
    const targets = Array.from({ length: 7 }, (_, i) => addDaysToKey(before, i));
    const result = statisticalForecast({ history: history('Cook', before, 140), targetDates: targets });
    result.forecasts.forEach((f) => expect(f.required).toBe(BY_WEEKDAY[weekdayOfKey(f.date)]));
  });

  it('gives the same result whatever the device time zone', () => {
    const input = { history: history('Cook', '2026-11-03', 200, 1.2, 8), targetDates: ACROSS_DST.map((d) => addDaysToKey(d, 7)) };
    const saved = process.env.TZ;
    const results = ['UTC', 'America/Lima', 'Asia/Tokyo', 'Europe/Madrid', 'Pacific/Kiritimati'].map((tz) => {
      process.env.TZ = tz;
      return JSON.stringify(statisticalForecast(input));
    });
    process.env.TZ = saved;
    expect(new Set(results).size).toBe(1);
  });

  it('never slices toISOString() for a date key', () => {
    const dir = path.resolve(__dirname, '..');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      expect(fs.readFileSync(path.join(dir, file), 'utf8')).not.toMatch(/toISOString\(\)/);
    }
    expect(fs.readFileSync(path.resolve(dir, '..', 'demandForecast.ts'), 'utf8')).not.toMatch(/toISOString\(\)/);
  });
});
