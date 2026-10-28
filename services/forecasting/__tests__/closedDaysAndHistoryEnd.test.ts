/**
 * CHG-087 / QA F2 and F3.
 *
 * F2: a weekday with no demand (closed Mondays) was planned for 3 staff: the interval
 * quantiles were pooled over all weekdays and added to a mean of 0. Now the quantiles
 * are weekday-aware (blended with the pooled ones) and a weekday that was 0 in each of
 * its last CLOSED_WEEKDAY_WEEKS weeks is forecast 0.
 *
 * F3: the series ended at the last date with data, so when shifts stopped being logged
 * the forecast continued the old level. Now the history window end is passed in and the
 * trailing days count as 0; `historyEndsDaysAgo` reports the gap.
 *
 * The closed-Monday scenarios are adapted from QA's probe (redteam step 3b).
 */
import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';

import {
  CLOSED_WEEKDAY_WEEKS,
  MIN_WEEKDAY_ERRORS,
  errorModelFromBacktest,
  isClosedWeekday,
} from '../selection';
import { buildRoleSeries, statisticalForecast, type HistoryDay } from '../statisticalForecast';
import { rng } from '../testUtils/synthetic';

const poisson = (random: () => number, lambda: number): number => {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= random();
  } while (p > limit);
  return k - 1;
};

const START = '2024-11-01';
/** Sun … Sat demand weights; Monday closed. */
const WEEK = [1.0, 0, 0.8, 0.9, 1.1, 1.6, 1.8];

const generate = (seed: number, days: number, lambda: (i: number, date: string) => number): HistoryDay[] => {
  const random = rng(seed);
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToKey(START, i);
    return { date, role: 'Cook', shifts: poisson(random, Math.max(0, lambda(i, date))) };
  });
};

/** Forecast `horizon` days after the history; the proxy sends only days with shifts. */
const forecastAfter = (history: HistoryDay[], horizon: number, withWindowEnd = true) => {
  const end = addDaysToKey(history[history.length - 1].date, 1);
  return statisticalForecast({
    history: history.filter((h) => h.shifts > 0),
    signals: [],
    targetDates: Array.from({ length: horizon }, (_, i) => addDaysToKey(end, i)),
    ...(withWindowEnd ? { historyEnd: end } : {}),
  });
};

describe('F2: closed and quiet weekdays', () => {
  it('plans 0 staff for a weekday closed in every week of history', () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const result = forecastAfter(generate(seed, 730, (_i, d) => 8 * WEEK[weekdayOfKey(d)]), 14);
      const mondays = result.forecasts.filter((f) => weekdayOfKey(f.date) === 1);
      expect(mondays).toHaveLength(2);
      for (const f of mondays) {
        expect(f).toMatchObject({ required: 0, expected: 0, lowerBound: 0, upperBound: 0 });
      }
      // Open days are still planned for.
      expect(result.forecasts.filter((f) => weekdayOfKey(f.date) === 6).every((f) => f.required >= 10)).toBe(true);
    }
  });

  it(`does not force 0 when the weekday had demand within the last ${CLOSED_WEEKDAY_WEEKS} weeks, but plans from that weekday's own errors`, () => {
    const history = generate(7, 730, (_i, d) => 8 * WEEK[weekdayOfKey(d)]);
    // One Monday with a shift three weeks before the end: not "closed", still very quiet.
    const lastMonday = [...history].reverse().find((h) => weekdayOfKey(h.date) === 1)!;
    const quiet = history.find((h) => h.date === addDaysToKey(lastMonday.date, -14))!;
    quiet.shifts = 1;
    const result = forecastAfter(history, 14);
    const mondays = result.forecasts.filter((f) => weekdayOfKey(f.date) === 1);
    expect(mondays.length).toBe(2);
    // Pooled quantiles planned 3 here (QA F2); the weekday-aware blend plans at most 1.
    for (const f of mondays) expect(f.required).toBeLessThanOrEqual(1);
  });

  it('isClosedWeekday needs the last CLOSED_WEEKDAY_WEEKS occurrences to be 0', () => {
    // 35 days; phase 3 sits at indices 3, 10, 17, 24, 31 and is 0 there.
    const y = Array.from({ length: 35 }, (_, i) => (i % 7 === 3 ? 0 : 5));
    expect(CLOSED_WEEKDAY_WEEKS).toBe(4);
    expect(isClosedWeekday(y, 38)).toBe(true); // index 38 has phase 3
    expect(isClosedWeekday(y, 39)).toBe(false);
    y[3] = 1; // 5th-last occurrence: outside the window
    expect(isClosedWeekday(y, 38)).toBe(true);
    y[10] = 1; // 4th-last occurrence
    expect(isClosedWeekday(y, 38)).toBe(false);
    expect(isClosedWeekday(y.slice(0, 20), 24)).toBe(false); // fewer than 4 occurrences
  });

  it('blends a weekday quantile with the pooled one when it has enough errors', () => {
    // 10 origins one week apart, horizon 14: phase (origin + h − 1) mod 7.
    const origins = Array.from({ length: 10 }, (_, k) => 100 + 7 * k);
    const errors = Array.from({ length: 14 }, (_, hi) =>
      origins.map((o, k) => ((o + hi) % 7 === 0 ? 0 : (k % 2 ? 1 : -1) * (1 + (hi % 5)))),
    );
    const pooled = errorModelFromBacktest(errors);
    const aware = errorModelFromBacktest(errors, { origins, length: 170 });
    // Series length 170: horizon h targets index 169 + h; pick the h whose phase is 0.
    const zeroH = [1, 2, 3, 4, 5, 6, 7].find((h) => (169 + h) % 7 === 0)!;
    expect(aware.quantile(zeroH, 0.9)).toBeLessThan(pooled.quantile(zeroH, 0.9));
    expect(aware.quantile(zeroH, 0.9)).toBeGreaterThan(0); // shrunk, not the weekday's own 0
    // Too few errors for a weekday: the pooled quantile.
    const few = errorModelFromBacktest(errors.map((e) => e.slice(0, 5)), { origins: origins.slice(0, 5), length: 170 });
    expect(MIN_WEEKDAY_ERRORS).toBeGreaterThan(10);
    expect(few.quantile(zeroH, 0.9)).toBe(errorModelFromBacktest(errors.map((e) => e.slice(0, 5))).quantile(zeroH, 0.9));
  });
});

describe('F3: history that stops before the window end', () => {
  const stopped = () => generate(2, 730, (i) => (i < 600 ? 6 : 0));

  it('counts the days after the last recorded shift as 0 and reports the gap', () => {
    const result = forecastAfter(stopped(), 7);
    expect(result.forecasts.every((f) => f.required === 0 && f.expected === 0)).toBe(true);
    const lastData = stopped().filter((h) => h.shifts > 0).pop()!.date;
    expect(result.models[0].lastDataDate).toBe(lastData);
    expect(result.historyEndsDaysAgo).toBe(result.models[0].historyEndsDaysAgo);
    expect(result.historyEndsDaysAgo).toBeGreaterThanOrEqual(129);
  });

  it('without a window end the series stops at the last data (old behaviour, kept for callers that pass none)', () => {
    const result = forecastAfter(stopped(), 7, false);
    expect(result.historyEndsDaysAgo).toBe(0);
    expect(result.forecasts.some((f) => f.required > 0)).toBe(true);
  });

  it('buildRoleSeries ends every role the day before historyEnd', () => {
    const series = buildRoleSeries(
      [
        { date: '2026-03-01', role: 'Cook', shifts: 2 },
        { date: '2026-03-03', role: 'Barista', shifts: 4 },
        { date: '2026-03-08', role: 'Cook', shifts: 9 }, // on/after historyEnd: ignored
      ],
      () => 1,
      '2026-03-20',
      '2026-03-08',
    );
    expect(series).toEqual([
      { role: 'Barista', start: '2026-03-03', end: '2026-03-07', lastDataDate: '2026-03-03', values: [4, 0, 0, 0, 0] },
      { role: 'Cook', start: '2026-03-01', end: '2026-03-07', lastDataDate: '2026-03-01', values: [2, 0, 0, 0, 0, 0, 0] },
    ]);
  });
});
