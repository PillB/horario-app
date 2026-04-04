import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@/services/demandForecast', () => ({
  loadDemandTargets: jest.fn(),
}));

jest.mock('@/hooks/useRoster', () => ({
  useRoster: jest.fn(),
}));

jest.mock('@/hooks/useShiftTemplates', () => ({
  useShiftTemplates: jest.fn(),
}));

import { loadDemandTargets } from '@/services/demandForecast';
import { useRoster } from '@/hooks/useRoster';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';
import { useDemandAnalysis, UseDemandAnalysisReturn } from '../useDemandAnalysis';
import type { DemandForecast } from '@/services/demandForecast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RosterShift = {
  date: string;
  status: string;
  templateId: string;
};

type ShiftTemplate = {
  id: string;
  role: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockLoadDemandTargets = loadDemandTargets as jest.Mock;
const mockUseRoster = useRoster as jest.Mock;
const mockUseShiftTemplates = useShiftTemplates as jest.Mock;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function makeForecast(overrides: Partial<DemandForecast> & { date: string; role: string; required: number }): DemandForecast {
  return {
    source: 'model',
    ...overrides,
  } as DemandForecast;
}

function hookResult(result: UseDemandAnalysisReturn): UseDemandAnalysisReturn {
  return result;
}

// Renders the hook using a test component and returns a ref-like accessor
function renderHook(
  hookFn: () => UseDemandAnalysisReturn,
): { getResult: () => UseDemandAnalysisReturn } {
  let result!: UseDemandAnalysisReturn;

  function TestComponent(): null {
    result = hookFn();
    return null;
  }

  act(() => {
    renderer.create(React.createElement(TestComponent));
  });

  return {
    getResult: () => result,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const today = isoToday();
const currentWeekStart = addDays(today, -6);
const priorWeekStart = addDays(today, -13);

const defaultRoster = { roster: [], loading: false };
const defaultTemplates = { shiftTemplates: [] };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRoster.mockReturnValue(defaultRoster);
  mockUseShiftTemplates.mockReturnValue(defaultTemplates);
  mockLoadDemandTargets.mockResolvedValue([]);
});

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDemandAnalysis', () => {
  // 1. Initial state — loading=false, all arrays empty when no targets
  it('returns empty arrays and loading=false when no targets are returned', async () => {
    mockLoadDemandTargets.mockResolvedValue([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    expect(result.loading).toBe(false);
    expect(result.error).toBeNull();
    expect(result.demandVsPrior).toEqual([]);
    expect(result.forecastExplanation).toEqual([]);
    expect(result.forecastAccuracy).toEqual([]);
    expect(result.weeklyDemandSummary).toEqual([]);
    expect(result.confidenceIntervals).toEqual([]);
  });

  // 2. Loads current and prior week targets on mount (loadDemandTargets called twice)
  it('calls loadDemandTargets twice on mount — once for current week, once for prior week', async () => {
    mockLoadDemandTargets.mockResolvedValue([]);

    function TestComponent(): null {
      useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    expect(mockLoadDemandTargets).toHaveBeenCalledTimes(2);
  });

  // 3. demandVsPrior — changePct=100 when prior=0 and current>0
  it('demandVsPrior sets changePct=100 when prior=0 and current>0', async () => {
    const currentDate = today;
    const priorDate = addDays(currentDate, -7);

    const currentForecast = makeForecast({ date: currentDate, role: 'Nurse', required: 5 });

    mockLoadDemandTargets
      .mockResolvedValueOnce([currentForecast]) // current week
      .mockResolvedValueOnce([]);               // prior week (empty → prior=0)

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const entry = result.demandVsPrior.find(
      (d) => d.date === currentDate && d.role === 'Nurse',
    );
    expect(entry).toBeDefined();
    expect(entry?.prior).toBe(0);
    expect(entry?.current).toBe(5);
    expect(entry?.changePct).toBe(100);
  });

  // 4. demandVsPrior — changePct=0 when both prior=0 and current=0
  it('demandVsPrior sets changePct=0 when both prior=0 and current=0', async () => {
    const currentDate = today;
    const currentForecast = makeForecast({ date: currentDate, role: 'Doctor', required: 0 });

    mockLoadDemandTargets
      .mockResolvedValueOnce([currentForecast])
      .mockResolvedValueOnce([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const entry = result.demandVsPrior.find(
      (d) => d.date === currentDate && d.role === 'Doctor',
    );
    expect(entry).toBeDefined();
    expect(entry?.changePct).toBe(0);
  });

  // 5. demandVsPrior — correct percentage when prior!=0 (e.g. prior=10, current=12 → +20%)
  it('demandVsPrior computes correct changePct when prior=10 and current=12 → +20%', async () => {
    const currentDate = today;
    const priorDate = addDays(currentDate, -7);

    const currentForecast = makeForecast({ date: currentDate, role: 'Nurse', required: 12 });
    const priorForecast = makeForecast({ date: priorDate, role: 'Nurse', required: 10 });

    mockLoadDemandTargets
      .mockResolvedValueOnce([currentForecast])
      .mockResolvedValueOnce([priorForecast]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const entry = result.demandVsPrior.find(
      (d) => d.date === currentDate && d.role === 'Nurse',
    );
    expect(entry).toBeDefined();
    expect(entry?.prior).toBe(10);
    expect(entry?.current).toBe(12);
    expect(entry?.changePct).toBe(20);
  });

  // 6. weeklyDemandSummary — correct avgRequired and peakDay from multiple targets
  it('weeklyDemandSummary computes correct avgRequired and peakDay', async () => {
    const date1 = addDays(today, -2);
    const date2 = addDays(today, -1);

    const forecasts = [
      makeForecast({ date: date1, role: 'Paramedic', required: 4 }),
      makeForecast({ date: date2, role: 'Paramedic', required: 8 }),
    ];

    mockLoadDemandTargets
      .mockResolvedValueOnce(forecasts)
      .mockResolvedValueOnce([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const summary = result.weeklyDemandSummary.find((s) => s.role === 'Paramedic');
    expect(summary).toBeDefined();
    expect(summary?.avgRequired).toBe(6); // (4+8)/2 = 6
    expect(summary?.peakDay).toBe(date2);
    expect(summary?.peakRequired).toBe(8);
  });

  // 7. forecastExplanation — includes weekend premium factor for Saturday/Sunday dates
  it('forecastExplanation includes weekend premium factor for Saturday date', async () => {
    // Find the next Saturday
    const baseDate = new Date(`${today}T00:00:00Z`);
    let saturday = '';
    for (let i = 0; i <= 6; i++) {
      const candidate = new Date(baseDate);
      candidate.setUTCDate(baseDate.getUTCDate() - i);
      if (candidate.getUTCDay() === 6) {
        saturday = candidate.toISOString().slice(0, 10);
        break;
      }
    }
    if (!saturday) {
      // fallback: find a known Saturday in range
      let d = new Date(`${today}T00:00:00Z`);
      for (let i = 0; i < 14; i++) {
        if (d.getUTCDay() === 6) {
          saturday = d.toISOString().slice(0, 10);
          break;
        }
        d.setUTCDate(d.getUTCDate() - 1);
      }
    }

    if (!saturday) {
      // Force a known Saturday date in range
      saturday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 1) % 7));
    }

    const forecast = makeForecast({ date: saturday, role: 'Nurse', required: 5 });

    mockLoadDemandTargets
      .mockResolvedValueOnce([forecast])
      .mockResolvedValueOnce([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const explanation = result.forecastExplanation.find(
      (e) => e.date === saturday && e.role === 'Nurse',
    );
    expect(explanation).toBeDefined();
    const hasWeekendFactor = explanation?.factors.some((f) =>
      f.includes('Weekend premium'),
    );
    expect(hasWeekendFactor).toBe(true);
  });

  // 8. forecastExplanation — includes OLS trend factor when multiple targets exist for a role
  it('forecastExplanation includes OLS trend factor when multiple targets with clear trend exist', async () => {
    // Create targets with a strong upward trend so |trendPct| >= 1
    const dates = [
      addDays(today, -6),
      addDays(today, -5),
      addDays(today, -4),
      addDays(today, -3),
      addDays(today, -2),
      addDays(today, -1),
      today,
    ];

    const forecasts = dates.map((date, i) =>
      makeForecast({ date, role: 'Engineer', required: 10 + i * 5 }),
    );

    mockLoadDemandTargets
      .mockResolvedValueOnce(forecasts)
      .mockResolvedValueOnce([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const explanation = result.forecastExplanation.find(
      (e) => e.role === 'Engineer',
    );
    expect(explanation).toBeDefined();
    const hasTrendFactor = explanation?.factors.some((f) =>
      f.includes('OLS trend'),
    );
    expect(hasTrendFactor).toBe(true);
  });

  // 9. forecastExplanation — includes external signal factor when target has notes
  it('forecastExplanation includes external signal factor when target has notes', async () => {
    const forecast = makeForecast({
      date: today,
      role: 'Driver',
      required: 3,
      notes: 'Public holiday event',
    });

    mockLoadDemandTargets
      .mockResolvedValueOnce([forecast])
      .mockResolvedValueOnce([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const explanation = result.forecastExplanation.find(
      (e) => e.date === today && e.role === 'Driver',
    );
    expect(explanation).toBeDefined();
    const hasExternalFactor = explanation?.factors.some((f) =>
      f.includes('External signal: Public holiday event'),
    );
    expect(hasExternalFactor).toBe(true);
  });

  // 10. forecastAccuracy — computes errorPct against published roster shifts matching role+date
  it('forecastAccuracy computes errorPct against published roster shifts matching role+date', async () => {
    const pastDate = addDays(today, -1);
    const templateId = 'tpl-1';

    const forecast = makeForecast({ date: pastDate, role: 'Nurse', required: 4 });

    mockLoadDemandTargets
      .mockResolvedValueOnce([forecast])
      .mockResolvedValueOnce([]);

    const rosterShifts: RosterShift[] = [
      { date: pastDate, status: 'Published', templateId },
      { date: pastDate, status: 'Published', templateId },
      { date: pastDate, status: 'Draft', templateId }, // should be excluded
    ];

    const shiftTemplates: ShiftTemplate[] = [{ id: templateId, role: 'Nurse' }];

    mockUseRoster.mockReturnValue({ roster: rosterShifts, loading: false });
    mockUseShiftTemplates.mockReturnValue({ shiftTemplates });

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    const accuracy = result.forecastAccuracy.find(
      (a) => a.date === pastDate && a.role === 'Nurse',
    );
    expect(accuracy).toBeDefined();
    expect(accuracy?.predicted).toBe(4);
    expect(accuracy?.actual).toBe(2); // 2 Published shifts
    // |2 - 4| / 4 * 100 = 50
    expect(accuracy?.errorPct).toBe(50);
  });

  // 11. confidenceIntervals — only includes targets that have lowerBound + upperBound + confidence
  it('confidenceIntervals only includes targets with lowerBound, upperBound and confidence defined', async () => {
    const forecastWithCI = makeForecast({
      date: today,
      role: 'Technician',
      required: 6,
      lowerBound: 4,
      upperBound: 8,
      confidence: 0.9,
    });

    const forecastWithoutCI = makeForecast({
      date: addDays(today, -1),
      role: 'Technician',
      required: 5,
    });

    mockLoadDemandTargets
      .mockResolvedValueOnce([forecastWithCI, forecastWithoutCI])
      .mockResolvedValueOnce([]);

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    expect(result.confidenceIntervals).toHaveLength(1);
    expect(result.confidenceIntervals[0].date).toBe(today);
    expect(result.confidenceIntervals[0].lowerBound).toBe(4);
    expect(result.confidenceIntervals[0].upperBound).toBe(8);
    expect(result.confidenceIntervals[0].confidence).toBe(0.9);
  });

  // 12. loadDemandTargets throws → error state set, loading false
  it('sets error state and loading=false when loadDemandTargets throws', async () => {
    mockLoadDemandTargets.mockRejectedValue(new Error('Network failure'));

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    expect(result.loading).toBe(false);
    expect(result.error).toBe('Unable to load demand analysis data');
    expect(warnSpy).toHaveBeenCalledWith(
      '[useDemandAnalysis] Failed to load demand targets',
      expect.any(Error),
    );
  });

  // 13. Stale request ignored — second call supersedes first (requestId guard)
  it('ignores stale response when refresh is called before first response resolves', async () => {
    let resolveFirst!: (value: DemandForecast[]) => void;
    let resolveSecond!: (value: DemandForecast[]) => void;

    const firstPromise = new Promise<DemandForecast[]>((res) => {
      resolveFirst = res;
    });
    const secondPromise = new Promise<DemandForecast[]>((res) => {
      resolveSecond = res;
    });

    const staleData = makeForecast({ date: today, role: 'StaleRole', required: 99 });
    const freshData = makeForecast({ date: today, role: 'FreshRole', required: 1 });

    // First call pair (mount): slow
    // Second call pair (refresh): fast with fresh data
    let callCount = 0;
    mockLoadDemandTargets.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        // First load (mount) — stale
        return firstPromise;
      }
      // Second load (refresh) — fresh
      return secondPromise;
    });

    let result!: UseDemandAnalysisReturn;

    function TestComponent(): null {
      result = useDemandAnalysis();
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
    });

    // Trigger refresh before resolving first
    await act(async () => {
      void result.refresh();
    });

    // Resolve the fresh (second) request first
    await act(async () => {
      resolveSecond([freshData]);
    });

    // Now resolve the stale (first) request — should be ignored
    await act(async () => {
      resolveFirst([staleData]);
    });

    // Only fresh data should be present
    expect(result.demandVsPrior.some((d) => d.role === 'StaleRole')).toBe(false);
    expect(result.demandVsPrior.some((d) => d.role === 'FreshRole')).toBe(true);
  });
});