import {
  HW_BOUNDS,
  HW_MAX_TRAIN_DAYS,
  MIN_HISTORY,
  fitDowProfile,
  fitHoltWinters,
  fitModel,
  fitSeasonalNaive,
} from '../models';
import { WEEKLY, series } from '../testUtils/synthetic';

/** Weekly shape of a forecast: each value minus the mean of its week. */
const weeklyShape = (values: number[]) => {
  const m = values.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
  return values.slice(0, 7).map((v) => v - m);
};

describe('seasonal naive', () => {
  it('repeats the same weekday of the last week', () => {
    const y = [1, 2, 3, 4, 5, 6, 7, 10, 20, 30, 40, 50, 60, 70];
    expect(fitSeasonalNaive(y).forecast(9)).toEqual([10, 20, 30, 40, 50, 60, 70, 10, 20]);
  });

  it('uses the mean for weekdays never seen when history is under a week', () => {
    // Day 0..2 seen; days 3..6 of the next positions were never observed.
    expect(fitSeasonalNaive([2, 4, 6]).forecast(5)).toEqual([4, 4, 4, 4, 2]);
    expect(fitSeasonalNaive([]).forecast(2)).toEqual([0, 0]);
  });
});

describe('weekday profile', () => {
  it('recovers the weekly pattern from a noisy stationary series', () => {
    const y = series({ length: 364, level: 12, noise: 1.5, seed: 7 });
    const fc = fitDowProfile(y).forecast(7);
    // 364 days end on a week boundary, so forecast index k is weekday position k.
    fc.forEach((v, k) => expect(v).toBeCloseTo(12 + WEEKLY[k], 0));
  });

  it('picks a short half-life after a level shift and forecasts the new level', () => {
    const y = [...series({ length: 140, level: 5, noise: 0.3, seed: 1 }), ...series({ length: 56, level: 15, noise: 0.3, seed: 2 })];
    const model = fitDowProfile(y);
    expect(model.params.halfLifeWeeks).toBeLessThanOrEqual(2);
    const fc = model.forecast(7);
    const mean = fc.reduce((a, b) => a + b, 0) / 7;
    expect(mean).toBeGreaterThan(14);
  });

  it('with an effectively infinite half-life is the plain weekday mean', () => {
    const y = [1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0];
    expect(fitDowProfile(y, 520).forecast(1)[0]).toBeCloseTo(3, 2);
  });
});

describe('Holt-Winters (additive weekly season, damped trend)', () => {
  it('recovers the weekly seasonality and the level of a trending series', () => {
    const y = series({ length: 364, level: 20, slope: 0.02, noise: 0.5, seed: 11 });
    const fc = fitHoltWinters(y).forecast(14);
    const shape = weeklyShape(fc);
    shape.forEach((v, k) => expect(v).toBeCloseTo(WEEKLY[k], 0));
    // Truth next week: 20 + 0.02·(364..370) + season ≈ 27.3 on average.
    const nextWeekMean = fc.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
    expect(nextWeekMean).toBeGreaterThan(26.5);
    expect(nextWeekMean).toBeLessThan(28.2);
  });

  it('keeps fitted parameters inside their bounds', () => {
    for (const seed of [1, 2, 3]) {
      const { alpha, beta, gamma, phi } = fitHoltWinters(series({ length: 200, slope: 0.1, noise: 2, seed })).params;
      expect(alpha).toBeGreaterThanOrEqual(HW_BOUNDS.alpha[0]);
      expect(alpha).toBeLessThanOrEqual(HW_BOUNDS.alpha[1]);
      expect(beta).toBeGreaterThanOrEqual(0);
      expect(beta).toBeLessThanOrEqual(alpha + 1e-12);
      expect(gamma).toBeGreaterThanOrEqual(0);
      expect(gamma).toBeLessThanOrEqual(1 - alpha + 1e-12);
      expect(phi).toBeGreaterThanOrEqual(HW_BOUNDS.phi[0]);
      expect(phi).toBeLessThanOrEqual(HW_BOUNDS.phi[1]);
    }
  });

  it('damps the trend: week-on-week growth shrinks by φ^7 and the forecast levels off', () => {
    const y = series({ length: 140, level: 10, slope: 0.3, noise: 0, seed: 1 });
    const params = { alpha: 0.3, beta: 0.1, gamma: 0.1, phi: 0.9 };
    const fc = fitHoltWinters(y, { params }).forecast(400);
    const growth = (week: number) => fc[(week + 1) * 7] - fc[week * 7];
    expect(growth(0)).toBeGreaterThan(0);
    expect(growth(1) / growth(0)).toBeCloseTo(params.phi ** 7, 6);
    expect(growth(2) / growth(1)).toBeCloseTo(params.phi ** 7, 6);
    // Bounded: total trend contribution ≤ b·φ/(1−φ), so far horizons barely move.
    expect(Math.abs(fc[399] - fc[392])).toBeLessThan(1e-6);
    // A straight line would be at 10 + 0.3·539 ≈ 172 by then.
    expect(fc[392]).toBeLessThan(100);
  });

  it('fits more slowly growing forecasts than an undamped line on a strong trend', () => {
    const y = series({ length: 120, level: 10, slope: 0.5, noise: 0.2, seed: 5 });
    const fc = fitHoltWinters(y).forecast(56);
    const line = 10 + 0.5 * (120 + 55);
    expect(fc[55]).toBeLessThan(line);
    // Next day: 10 + 0.5·120 + the weekday term.
    expect(Math.abs(fc[0] - (10 + 0.5 * 120 + WEEKLY[120 % 7]))).toBeLessThan(1);
  });

  it('only uses the last 53 weeks, keeping weekday alignment', () => {
    const long = series({ length: 800, level: 10, noise: 0.2, seed: 9 });
    const fc = fitHoltWinters(long).forecast(7);
    // 800 = 114·7 + 2, so the next day is weekday position 2.
    const shape = weeklyShape([...fc.slice(5), ...fc.slice(0, 5)]);
    shape.forEach((v, k) => expect(v).toBeCloseTo(WEEKLY[k], 0));
    expect(HW_MAX_TRAIN_DAYS % 7).toBe(0);
  });

  it('warm-starting from earlier parameters gives a fit as good as a cold search', () => {
    const y = series({ length: 300, slope: 0.05, noise: 1, seed: 4 });
    const cold = fitHoltWinters(y);
    const warm = fitModel('holtWinters', y, fitHoltWinters(y.slice(0, 293)));
    const err = (m: typeof cold) => {
      const truth = series({ length: 314, slope: 0.05, noise: 0, seed: 4 }).slice(300);
      return m.forecast(14).reduce((s, v, i) => s + Math.abs(v - truth[i]), 0);
    };
    expect(err(warm)).toBeLessThan(err(cold) * 1.25 + 1);
  });
});

describe('minimum history', () => {
  it('is documented per model', () => {
    expect(MIN_HISTORY).toEqual({ seasonalNaive: 7, dowProfile: 14, holtWinters: 28 });
  });
});
