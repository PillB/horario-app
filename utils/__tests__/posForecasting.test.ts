/**
 * Tests for the POS-based demand forecasting engine.
 */

import {
  rollingAverage,
  forecastDemandFromPOS,
  DEFAULT_POS_CONFIG,
  forecastDemandFromPOSMultiRole,
  STAFFING_PRESETS,
  type PosRow,
  type RoleRatio,
  type StaffingMix,
  type StaffingPresetKey,
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

describe('STAFFING_PRESETS', () => {
  it('all preset keys exist', () => {
    const expectedKeys: StaffingPresetKey[] = [
      'casual_dining',
      'fine_dining',
      'bar_cafe',
      'qsr',
      'custom',
    ];
    expectedKeys.forEach((key) => {
      expect(STAFFING_PRESETS).toHaveProperty(key);
    });
  });

  it('casual_dining has 3 roles', () => {
    expect(STAFFING_PRESETS.casual_dining.roles.length).toBe(3);
  });

  it('fine_dining host has maxWorkers 2', () => {
    const hostRole = STAFFING_PRESETS.fine_dining.roles.find(
      (r: RoleRatio) => r.role === 'Host',
    );
    expect(hostRole).toBeDefined();
    expect(hostRole?.maxWorkers).toBe(2);
  });

  it('custom has empty roles', () => {
    expect(STAFFING_PRESETS.custom.roles.length).toBe(0);
  });
});

describe('forecastDemandFromPOSMultiRole', () => {
  it('returns empty array for empty rows', () => {
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole([], mix, 1);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty roles', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1000, covers: 20, notes: null },
    ];
    const mix: StaffingMix = { roles: [] };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result).toEqual([]);
  });

  it('produces rows × roles forecasts', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1000, covers: 20, notes: null },
      { date: '2026-01-02', revenue: 1200, covers: 24, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
        {
          role: 'Cook',
          ratioMode: 'revenue',
          coversPerWorker: 10,
          revenuePerWorkerHour: 100,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result.length).toBe(4);
  });

  it('covers-based required workers: 40 covers / 10 per worker = 4 required', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1000, covers: 40, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result[0].required).toBe(4);
  });

  it('enforces minWorkers floor', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 100, covers: 1, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 3,
          maxWorkers: null,
        },
      ],
    };
    // raw = ceil(1/10) = 1, but minWorkers=3 → required=3
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result[0].required).toBe(3);
  });

  it('enforces maxWorkers ceiling', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 5000, covers: 100, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: 2,
        },
      ],
    };
    // raw = ceil(100/10) = 10, but maxWorkers=2 → required=2
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result[0].required).toBe(2);
  });

  it('falls back to revenue when no covers data (covers mode)', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 800, covers: null, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 100,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    // covers is null → fall back to revenue: ceil(800 / (100 * 8)) = ceil(1) = 1
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result[0].required).toBe(1);
  });

  it('revenue mode: 2400 / (50*8) = 6 required', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 2400, covers: 80, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Cook',
          ratioMode: 'revenue',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    // ceil(2400 / (50 * 8)) = ceil(6) = 6
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result[0].required).toBe(6);
  });

  it('sorts rows by date ascending', () => {
    const unsortedRows: PosRow[] = [
      { date: '2026-01-03', revenue: 3000, covers: 60, notes: null },
      { date: '2026-01-01', revenue: 1000, covers: 20, notes: null },
      { date: '2026-01-02', revenue: 2000, covers: 40, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(unsortedRows, mix, 1);
    // 3 rows × 1 role = 3 entries; dates should be ascending
    expect(result[0].date).toBe('2026-01-01');
    expect(result[1].date).toBe('2026-01-02');
    expect(result[2].date).toBe('2026-01-03');
  });

  it('sets source to pos_forecast for all entries', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1000, covers: 20, notes: null },
      { date: '2026-01-02', revenue: 1200, covers: 24, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    result.forEach((entry) => expect(entry.source).toBe('pos_forecast'));
  });

  it('sets confidence to 0.80 for all entries', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1000, covers: 20, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    result.forEach((entry) => expect(entry.confidence).toBe(0.80));
  });

  it('produces correct role names in output', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1000, covers: 20, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Bartender',
          ratioMode: 'revenue',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result[0].role).toBe('Bartender');
  });

  it('multi-role: 1 date × 2 roles → 2 output entries with different role names', () => {
    const rows: PosRow[] = [
      { date: '2026-01-01', revenue: 1600, covers: 40, notes: null },
    ];
    const mix: StaffingMix = {
      roles: [
        {
          role: 'Server',
          ratioMode: 'covers',
          coversPerWorker: 10,
          revenuePerWorkerHour: 50,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
        {
          role: 'Cook',
          ratioMode: 'revenue',
          coversPerWorker: 10,
          revenuePerWorkerHour: 100,
          avgShiftHours: 8,
          minWorkers: 1,
          maxWorkers: null,
        },
      ],
    };
    const result = forecastDemandFromPOSMultiRole(rows, mix, 1);
    expect(result.length).toBe(2);
    const roleNames = result.map((entry) => entry.role);
    expect(roleNames).toContain('Server');
    expect(roleNames).toContain('Cook');
    expect(roleNames[0]).not.toBe(roleNames[1]);
  });
});