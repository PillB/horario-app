import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useDemandForecast } from '../useDemandForecast';
import * as demandForecast from '@/services/demandForecast';
import { getSupabaseClient } from '@/services/supabaseClient';

jest.mock('@/services/supabaseClient', () => ({
  getSupabaseClient: jest.fn(),
}));

describe('useDemandForecast failure handling', () => {
  const mockGetClient = getSupabaseClient as jest.Mock;
  const target = { date: '2024-01-01', role: 'barista', required: 3 };
  let warnSpy: jest.SpyInstance;
  const defaultMetadata = {
    hasHistorical: false,
    hasExternalSignals: false,
    hasExistingTargets: false,
    apiAvailable: true,
    usedApi: false,
    usedFallback: false,
    apiCallFailed: false,
  };

  jest.setTimeout(10000);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClient.mockReturnValue(null);
    (global as any).fetch = jest.fn().mockImplementation((_, options) => {
      const body = JSON.parse((options as RequestInit)?.body?.toString() ?? '{}');
      if (body.action === 'status') {
        return Promise.resolve({ ok: true, json: async () => ({ ...defaultMetadata }) });
      }
      if (body.action === 'loadTargets') {
        return Promise.resolve({ ok: true, json: async () => ({ targets: [] }) });
      }
      if (body.action === 'forecast') {
        return Promise.resolve({ ok: true, json: async () => ({ forecasts: [], metadata: defaultMetadata }) });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, targets: body.targets ?? [] }),
      });
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not mark existing targets when override persistence fails', async () => {
    let hookState: ReturnType<typeof useDemandForecast> | null = null;

    const TestComponent = () => {
      const hook = useDemandForecast();
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'Unable to save override' }),
      });
      await hookState?.overrideTarget(target);
    });

    expect(hookState?.dataStatus.hasExistingTargets).toBe(false);
    expect(hookState?.demandTargets).toEqual([]);
    expect(hookState?.error).toBe('Unable to save override');
  });

  it('does not mark existing targets when seeding baseline targets fails', async () => {
    let hookState: ReturnType<typeof useDemandForecast> | null = null;

    const TestComponent = () => {
      const hook = useDemandForecast();
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'Unable to save override' }),
      });
      await hookState?.seedBaselineTargets([target]);
    });

    expect(hookState?.dataStatus.hasExistingTargets).toBe(false);
    expect(hookState?.demandTargets).toEqual([]);
    expect(hookState?.error).toBe('Unable to save override');
  });

  it('does not update state if hydration resolves after unmount', async () => {
    let resolveTargets!: (value: demandForecast.DemandForecast[]) => void;
    let resolveStatus!: (value: demandForecast.ForecastDataStatus) => void;

    const loadPromise = new Promise<demandForecast.DemandForecast[]>((resolve) => {
      resolveTargets = resolve;
    });
    const statusPromise = new Promise<demandForecast.ForecastDataStatus>((resolve) => {
      resolveStatus = resolve;
    });

    const loadSpy = jest.spyOn(demandForecast, 'loadDemandTargets').mockReturnValue(loadPromise);
    const statusSpy = jest.spyOn(demandForecast, 'getForecastDataStatus').mockReturnValue(statusPromise);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const TestComponent = () => {
      useDemandForecast();
      return null;
    };

    let testRenderer: renderer.ReactTestRenderer;
    await act(async () => {
      testRenderer = renderer.create(<TestComponent />);
    });

    act(() => {
      testRenderer.unmount();
    });

    await act(async () => {
      resolveTargets([]);
      resolveStatus({
        hasHistorical: false,
        hasExternalSignals: false,
        hasExistingTargets: false,
        apiAvailable: false,
      });
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Can't perform a React state update on an unmounted component.")
    );

    loadSpy.mockRestore();
    statusSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('surfaces fallback details when forecasts rely on local averages', async () => {
    const loadSpy = jest.spyOn(demandForecast, 'loadDemandTargets').mockResolvedValue([]);
    const statusSpy = jest.spyOn(demandForecast, 'getForecastDataStatus').mockResolvedValue({
      hasHistorical: false,
      hasExternalSignals: false,
      hasExistingTargets: false,
      apiAvailable: false,
    });

    const fallbackMessage = 'Forecast API returned no data; using local averages.';

    const forecastSpy = jest.spyOn(demandForecast, 'generateDemandForecast').mockResolvedValue({
      forecasts: [{ date: '2024-01-01', role: 'barista', required: 3, source: 'model' as const }],
      metadata: {
        hasHistorical: false,
        hasExternalSignals: false,
        hasExistingTargets: false,
        apiAvailable: false,
        usedApi: false,
        usedFallback: true,
        apiCallFailed: false,
        fallbackReason: fallbackMessage,
      },
    });

    let hookState: ReturnType<typeof useDemandForecast> | null = null;

    const TestComponent = () => {
      const hook = useDemandForecast();
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
      await hookState?.triggerForecast();
    });

    expect(hookState?.error).toBe(fallbackMessage);
    expect(hookState?.lastGenerationMetadata?.usedFallback).toBe(true);

    loadSpy.mockRestore();
    statusSpy.mockRestore();
    forecastSpy.mockRestore();
  });

  it('ignores stale hydration responses after filters change', async () => {
    type Deferred<T> = {
      promise: Promise<T>;
      resolve: (value: T) => void;
    };

    const createDeferred = <T,>(): Deferred<T> => {
      let resolver!: (value: T) => void;
      const promise = new Promise<T>((resolve) => {
        resolver = resolve;
      });
      return { promise, resolve: resolver };
    };

    const firstTargets = createDeferred<demandForecast.DemandForecast[]>();
    const firstStatus = createDeferred<demandForecast.ForecastDataStatus>();

    const loadSpy = jest
      .spyOn(demandForecast, 'loadDemandTargets')
      .mockImplementationOnce(() => firstTargets.promise)
      .mockImplementation(() =>
        Promise.resolve([{ date: '2024-01-02', role: 'barista', required: 4, source: 'override' }])
      );

    const statusSpy = jest
      .spyOn(demandForecast, 'getForecastDataStatus')
      .mockImplementationOnce(() => firstStatus.promise)
      .mockImplementation(() =>
        Promise.resolve({
          hasHistorical: true,
          hasExternalSignals: false,
          hasExistingTargets: true,
          apiAvailable: true,
        })
      );

    let hookState: ReturnType<typeof useDemandForecast> | null = null;

    const TestComponent = () => {
      const hook = useDemandForecast();
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await hookState?.refresh();
    });

    await act(async () => {
      firstTargets.resolve([{ date: '2024-01-01', role: 'barista', required: 3, source: 'override' }]);
      firstStatus.resolve({
        hasHistorical: false,
        hasExternalSignals: false,
        hasExistingTargets: false,
        apiAvailable: false,
      });
      await Promise.resolve();
    });

    expect(hookState?.demandTargets).toEqual([
      { date: '2024-01-02', role: 'barista', required: 4, source: 'override' },
    ]);
    expect(hookState?.dataStatus).toEqual({
      hasHistorical: true,
      hasExternalSignals: false,
      hasExistingTargets: true,
      apiAvailable: true,
    });
    expect(hookState?.loading).toBe(false);

    loadSpy.mockRestore();
    statusSpy.mockRestore();
  });
});
