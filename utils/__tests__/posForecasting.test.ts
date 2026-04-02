/**
 * Tests for the POS-based demand forecasting engine.
 */

import {
  rollingAverage,
  forecastDemandFromPOS,
  DEFAULT_POS_CONFIG,
  type PosRow,
} from '../posForecasting';

describe('rollingAverage', () => {
  it('returns empty array for empty input', () => {
    expect(rollingAverage([], 7)).toEqual([]);
  });

  it('returns same values when window <= 1', () => {
    expect(rollingAverage([10, 20, 30], 1)).toEqual([10, 20, 30]);
    expect(rollingAverage([10, 20, 30], 0)).toEqual([10, 20, 30]);
  });

  it('returns overall mean when window exceeds array length', () => {
    const values = [10, 20, 30];
    const result = rollingAverage(values, 10);
    const mean = 20;
    expect(result).toEqual([mean, mean, mean]);
  });

  it('computes centered rolling average for window=3', () => {
    // [10, 20, 30, 40, 50], window=3
    // i=0 (edge, pad with first valid): avg(10,20,30) = 20
    // i=1 (first valid): avg(10,20,30) = 20
    // i=2: avg(20,30,40) = 30
    // i=3 (last valid): avg(30,40,50) = 40
    // i=4 (edge, pad with last valid): avg(30,40,50) = 40
    const result = rollingAverage([10, 20, 30, 40, 50], 3);
    expect(result).toEqual([20, 20, 30, 40, 40]);
  });

  it('returns same length as input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7];
    expect(rollingAverage(input, 3).length).toBe(input.length);
  });
});

describe('forecastDemandFromPOS', () => {
  const baseRows: PosRow[] = [
    { date: '2026-01-01', revenue: 4000, covers: 80, notes: null },
    { date: '2026-01-02', revenue: 4800, covers: 96, notes: null },
    { date: '2026-01-03', revenue: 3600, covers: 72, notes: null },
  ];

  it('returns empty array for empty input', () => {
    expect(forecastDemandFromPOS([], DEFAULT_POS_CONFIG)).toEqual([]);
  });

  it('produces one forecast per input row', () => {
    const result = forecastDemandFromPOS(baseRows, {
      ...DEFAULT_POS_CONFIG,
      role: 'server',
    });
    expect(result.length).toBe(3);
  });

  it('assigns the correct role to all forecasts', () => {
    const result = forecastDemandFromPOS(baseRows, {
      ...DEFAULT_POS_CONFIG,
      role: 'cook',
    });
    result.forEach((r) => expect(r.role).toBe('cook'));
  });

  it('sets source to pos_forecast', () => {
    const result = forecastDemandFromPOS(baseRows, DEFAULT_POS_CONFIG);
    result.forEach((r) => expect(r.source).toBe('pos_forecast'));
  });

  it('required workers are at least 1', () => {
    const lowRevenueRows: PosRow[] = [
      { date: '2026-01-01', revenue: 1, covers: null, notes: null },
    ];
    const result = forecastDemandFromPOS(lowRevenueRows, DEFAULT_POS_CONFIG);
    expect(result[0].required).toBeGreaterThanOrEqual(1);
  });

  it('computes required workers from revenue and config', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 800, covers: null, notes: null },
    ];
    // With revenuePerWorkerHour=100 and avgShiftHours=8:
    // required = ceil(800 / (100 * 8)) = ceil(1) = 1
    const result = forecastDemandFromPOS(rows, {
      ...DEFAULT_POS_CONFIG,
      revenuePerWorkerHour: 100,
      avgShiftHours: 8,
      smoothingWindow: 1,
    });
    expect(result[0].required).toBe(1);
  });

  it('lowerBound is max(1, required-1) and upperBound is required+1', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 2400, covers: null, notes: null },
    ];
    // revenuePerWorkerHour=50, avgShiftHours=8 → required = ceil(2400/400) = 6
    const result = forecastDemandFromPOS(rows, {
      ...DEFAULT_POS_CONFIG,
      revenuePerWorkerHour: 50,
      avgShiftHours: 8,
      smoothingWindow: 1,
    });
    const r = result[0];
    expect(r.required).toBe(6);
    expect(r.lowerBound).toBe(5);
    expect(r.upperBound).toBe(7);
  });

  it('sets confidence to 0.80', () => {
    const result = forecastDemandFromPOS(baseRows, DEFAULT_POS_CONFIG);
    result.forEach((r) => expect(r.confidence).toBe(0.80));
  });

  it('sorts rows by date ascending', () => {
    const unsorted: PosRow[] = [
      { date: '2026-01-03', revenue: 3000, covers: null, notes: null },
      { date: '2026-01-01', revenue: 1000, covers: null, notes: null },
      { date: '2026-01-02', revenue: 2000, covers: null, notes: null },
    ];
    const result = forecastDemandFromPOS(unsorted, { ...DEFAULT_POS_CONFIG, smoothingWindow: 1 });
    expect(result[0].date).toBe('2026-01-01');
    expect(result[1].date).toBe('2026-01-02');
    expect(result[2].date).toBe('2026-01-03');
  });
});
