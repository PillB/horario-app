import {
  DEFAULT_BACKTEST,
  backtest,
  chooseModel,
  errorModelFromBacktest,
  forecastSeries,
  minSelectionHistory,
  quantileSorted,
  seasonalNaiveScale,
} from '../selection';
import { seasonalRandomWalk, series } from '../testUtils/synthetic';

const OPTIONS = { intervalLevel: 0.8, serviceLevel: 0.8, backtest: DEFAULT_BACKTEST };
const H14 = Array.from({ length: 14 }, (_, i) => i + 1);

describe('MASE scale', () => {
  it('is the in-sample MAE of the weekly seasonal naive', () => {
    const y = [0, 0, 0, 0, 0, 0, 0, 2, -2, 0, 0, 0, 0, 0];
    expect(seasonalNaiveScale(y)).toBeCloseTo(4 / 7, 10);
  });

  it('falls back to 1 (errors in staff) for a flat series', () => {
    expect(seasonalNaiveScale(new Array(30).fill(4))).toBe(1);
  });
});

describe('rolling-origin backtest', () => {
  it('needs 35 / 42 / 56 days for a model to take part', () => {
    expect(minSelectionHistory('seasonalNaive')).toBe(35);
    expect(minSelectionHistory('dowProfile')).toBe(42);
    expect(minSelectionHistory('holtWinters')).toBe(56);
    expect(backtest(series({ length: 34 }))).toBeNull();
    expect(backtest(series({ length: 40 }))!.scores.map((s) => s.model)).toEqual(['seasonalNaive']);
    expect(backtest(series({ length: 50 }))!.scores.map((s) => s.model)).toEqual(['seasonalNaive', 'dowProfile']);
    expect(backtest(series({ length: 60 }))!.scores.map((s) => s.model)).toEqual([
      'seasonalNaive',
      'dowProfile',
      'holtWinters',
    ]);
  });

  it('uses the newest origins, a week apart, all candidates on the same ones', () => {
    const r = backtest(series({ length: 400, noise: 1 }))!;
    expect(r.origins).toHaveLength(DEFAULT_BACKTEST.maxOrigins);
    expect(r.origins[r.origins.length - 1]).toBe(400 - 14);
    expect(r.origins[1] - r.origins[0]).toBe(7);
    for (const errs of Object.values(r.errors)) {
      expect(errs).toHaveLength(14);
      errs!.forEach((atH) => expect(atH).toHaveLength(r.origins.length));
    }
  });

  it.each([1, 2, 3])('picks Holt-Winters for trend + season (seed %i)', (seed) => {
    const r = backtest(series({ length: 400, slope: 0.05, noise: 0.5, seed }))!;
    expect(chooseModel(r.scores).model).toBe('holtWinters');
    const mase = Object.fromEntries(r.scores.map((s) => [s.model, s.mase]));
    expect(mase.holtWinters).toBeLessThan(mase.seasonalNaive);
  });

  it.each([4, 5, 6])('picks the weekday profile for a stable weekly pattern with noise (seed %i)', (seed) => {
    const r = backtest(series({ length: 400, noise: 2, seed }))!;
    const chosen = chooseModel(r.scores);
    expect(chosen.model).toBe('dowProfile');
    expect(chosen.mase).toBeLessThan(1);
  });

  it.each([7, 8, 9])('keeps seasonal naive for a seasonal random walk (seed %i)', (seed) => {
    const r = backtest(seasonalRandomWalk(400, 1.5, seed))!;
    expect(chooseModel(r.scores).model).toBe('seasonalNaive');
  });

  it('prefers the simpler model on a near tie', () => {
    expect(
      chooseModel([
        { model: 'seasonalNaive', mase: 1.0 },
        { model: 'dowProfile', mase: 0.985 },
        { model: 'holtWinters', mase: 0.98 },
      ]).model,
    ).toBe('dowProfile');
    expect(
      chooseModel([
        { model: 'seasonalNaive', mase: 1.0 },
        { model: 'holtWinters', mase: 0.9 },
      ]).model,
    ).toBe('holtWinters');
  });
});

describe('prediction intervals', () => {
  it('quantiles interpolate linearly (type 7)', () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantileSorted([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4, 10);
    expect(quantileSorted([0, 10], 0.8)).toBeCloseTo(8, 10);
  });

  it('pools errors from nearby horizons and widens with the horizon', () => {
    const errors = Array.from({ length: 14 }, (_, i) => Array.from({ length: 10 }, (_, k) => (k - 4.5) * (i + 1)));
    const model = errorModelFromBacktest(errors);
    expect(model.source).toBe('backtest');
    expect(model.quantile(14, 0.9)).toBeGreaterThan(model.quantile(1, 0.9));
    // Past the backtest horizon the last window is reused.
    expect(model.quantile(30, 0.9)).toBe(model.quantile(14, 0.9));
  });

  it('covers close to the nominal 80% on synthetic Gaussian noise', () => {
    let inside = 0;
    let atOrBelowPlan = 0;
    let total = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const full = series({ length: 414, noise: 1.5, seed: 1000 + seed });
      const fc = forecastSeries(full.slice(0, 400), H14, OPTIONS);
      expect(fc.intervalSource).toBe('backtest');
      fc.points.forEach((p, i) => {
        const actual = full[400 + i];
        total += 1;
        if (actual >= p.lower! && actual <= p.upper!) inside += 1;
        if (actual <= p.atServiceLevel) atOrBelowPlan += 1;
      });
    }
    expect(inside / total).toBeGreaterThan(0.74);
    expect(inside / total).toBeLessThan(0.86);
    // The planned headcount covers demand about 80% of the time.
    expect(atOrBelowPlan / total).toBeGreaterThan(0.74);
    expect(atOrBelowPlan / total).toBeLessThan(0.86);
  });

  it('a higher service level plans for more staff', () => {
    const y = series({ length: 300, noise: 2, seed: 3 });
    const at80 = forecastSeries(y, [1], OPTIONS).points[0];
    const at95 = forecastSeries(y, [1], { ...OPTIONS, serviceLevel: 0.95 }).points[0];
    expect(at95.atServiceLevel).toBeGreaterThan(at80.atServiceLevel);
    expect(at80.atServiceLevel).toBeGreaterThan(at80.expected);
  });
});

describe('short history', () => {
  it('falls back to seasonal naive with in-sample intervals below 35 days', () => {
    const y = series({ length: 20, noise: 1, seed: 2 });
    const fc = forecastSeries(y, [1, 7], OPTIONS);
    expect(fc.model).toBe('seasonalNaive');
    expect(fc.mase).toBeNull();
    expect(fc.backtestOrigins).toBe(0);
    expect(fc.intervalSource).toBe('in-sample');
    expect(fc.points[0].expected).toBeCloseTo(y[13], 10);
    expect(fc.points[0].lower).not.toBeNull();
  });

  it('gives no interval and plans for the forecast itself with under 2 weeks', () => {
    const fc = forecastSeries([3, 4, 5, 6, 7, 8, 9, 3, 4], [1], OPTIONS);
    expect(fc.model).toBe('seasonalNaive');
    expect(fc.intervalSource).toBe('none');
    expect(fc.points[0]).toEqual({ h: 1, expected: 5, lower: null, upper: null, atServiceLevel: 5, closedWeekday: false });
  });

  it('only scores seasonal naive between 35 and 41 days', () => {
    const fc = forecastSeries(series({ length: 38, noise: 1 }), [1], OPTIONS);
    expect(fc.scores.map((s) => s.model)).toEqual(['seasonalNaive']);
    expect(fc.model).toBe('seasonalNaive');
    expect(fc.mase).not.toBeNull();
  });

  it('never forecasts negative demand', () => {
    const y = Array.from({ length: 120 }, (_, t) => Math.max(0, 30 - t * 0.4));
    const fc = forecastSeries(y, H14, OPTIONS);
    fc.points.forEach((p) => {
      expect(p.expected).toBeGreaterThanOrEqual(0);
      expect(p.lower ?? 0).toBeGreaterThanOrEqual(0);
      expect(p.atServiceLevel).toBeGreaterThanOrEqual(0);
    });
  });
});
