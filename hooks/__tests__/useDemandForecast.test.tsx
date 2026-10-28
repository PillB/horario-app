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

    const loadPromise = new Promise<demandForecast.OverrideTargetsResult>((resolve) => {
      resolveTargets = (targets: demandForecast.DemandForecast[]) => resolve({ ok: true, targets, truncated: false });
    });
    const statusPromise = new Promise<demandForecast.ForecastDataStatus>((resolve) => {
      resolveStatus = resolve;
    });

    const loadSpy = jest.spyOn(demandForecast, 'fetchOverrideTargets').mockReturnValue(loadPromise);
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
    const loadSpy = jest.spyOn(demandForecast, 'fetchOverrideTargets').mockResolvedValue({ ok: true, targets: [], truncated: false });
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
      .spyOn(demandForecast, 'fetchOverrideTargets')
      .mockImplementationOnce(() => firstTargets.promise.then((targets) => ({ ok: true as const, targets, truncated: false })))
      .mockImplementation(() =>
        Promise.resolve({ ok: true as const, targets: [{ date: '2024-01-02', role: 'barista', required: 4, source: 'override' as const }], truncated: false })
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

  it('exposes the chosen models, keeps overrides over model forecasts and passes options through', async () => {
    const override = { date: '2026-10-21', role: 'barista', required: 7, source: 'override' as const };
    const loadSpy = jest.spyOn(demandForecast, 'fetchOverrideTargets').mockResolvedValue({ ok: true, targets: [override], truncated: false });
    const statusSpy = jest.spyOn(demandForecast, 'getForecastDataStatus').mockResolvedValue({
      hasHistorical: true,
      hasExternalSignals: false,
      hasExistingTargets: true,
      apiAvailable: false,
    });
    const models = [
      {
        role: 'barista',
        model: 'holtWinters' as const,
        mase: 0.71,
        scores: [],
        historyDays: 400,
        backtestOrigins: 10,
        intervalSource: 'backtest' as const,
        params: {},
      },
    ];
    const forecastSpy = jest.spyOn(demandForecast, 'generateDemandForecast').mockResolvedValue({
      forecasts: [
        { date: '2026-10-21', role: 'barista', required: 3, expected: 2.4, source: 'model', model: 'holtWinters' },
        { date: '2026-10-22', role: 'barista', required: 4, expected: 3.1, source: 'model', model: 'holtWinters', mase: 0.71 },
      ],
      metadata: {
        hasHistorical: true,
        hasExternalSignals: false,
        hasExistingTargets: false,
        apiAvailable: false,
        usedApi: false,
        usedFallback: false,
        apiCallFailed: false,
        method: 'statistical',
        models,
      },
    });

    let hookState: ReturnType<typeof useDemandForecast> | null = null;
    const options = { timeZone: 'America/Lima', serviceLevel: 0.9 };
    const TestComponent = () => {
      const hook = useDemandForecast(undefined, options);
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });
    expect(hookState?.forecastModels).toEqual([]);

    await act(async () => {
      await hookState?.triggerForecast({ role: 'barista' });
    });

    expect(forecastSpy).toHaveBeenCalledWith({ role: 'barista' }, options);
    expect(hookState?.forecastModels).toEqual(models);
    expect(hookState?.error).toBeNull();
    expect(hookState?.demandTargets).toEqual([
      override,
      expect.objectContaining({ date: '2026-10-22', required: 4, mase: 0.71 }),
    ]);

    loadSpy.mockRestore();
    statusSpy.mockRestore();
    forecastSpy.mockRestore();
  });
});

describe('useDemandForecast stored overrides (CHG-088)', () => {
  const status = { hasHistorical: false, hasExternalSignals: false, hasExistingTargets: true, apiAvailable: false };
  const override = { date: '2026-11-02', role: 'Support', required: 5, notes: 'Launch', source: 'override' as const };
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  const render = async () => {
    const state: { current: ReturnType<typeof useDemandForecast> | null } = { current: null };
    const Probe = () => {
      state.current = useDemandForecast();
      return null;
    };
    await act(async () => {
      renderer.create(<Probe />);
    });
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    return state;
  };

  const fakeProxy = (handlers: Record<string, { status?: number; body: unknown }>) => {
    const fetchMock = jest.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { action: string };
      const reply = handlers[body.action] ?? { body: { success: true } };
      const code = reply.status ?? 200;
      return { ok: code < 400, status: code, json: async () => reply.body };
    });
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    return fetchMock;
  };

  const sentBody = (fetchMock: jest.Mock, action: string) =>
    fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string)).find((b) => b.action === action);

  it('reads every page of stored overrides', async () => {
    const fetchMock = jest.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { action: string; page?: number };
      if (body.action === 'status') return { ok: true, status: 200, json: async () => status };
      const page = body.page === 0
        ? { targets: [override], hasMore: true }
        : { targets: [{ ...override, date: '2026-11-03' }], hasMore: false };
      return { ok: true, status: 200, json: async () => page };
    });
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    const state = await render();
    expect(state.current?.targetsLoaded).toBe(true);
    expect(state.current?.demandTargets.map((t) => t.date)).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('reports a failed load instead of showing no overrides', async () => {
    fakeProxy({ status: { body: status }, loadTargets: { status: 500, body: { error: 'Database request failed' } } });
    const state = await render();
    expect(state.current?.targetsLoaded).toBe(false);
    expect(state.current?.error).toBe('Unable to load demand targets');
  });

  it('removes an override, and puts it back with an error when the delete is refused', async () => {
    const fetchMock = fakeProxy({
      status: { body: status },
      loadTargets: { body: { targets: [override], hasMore: false } },
      deleteDemandTarget: { status: 403, body: { error: 'Only an admin of this business can do this' } },
    });
    const state = await render();
    let result!: Awaited<ReturnType<ReturnType<typeof useDemandForecast>['removeOverride']>>;
    await act(async () => {
      result = await state.current!.removeOverride({ date: override.date, role: override.role });
    });
    expect(result).toEqual({ success: false, error: 'Only an admin of this business can do this' });
    expect(state.current?.demandTargets).toEqual([override]);
    expect(state.current?.error).toBe('Only an admin of this business can do this');
    expect(sentBody(fetchMock, 'deleteDemandTarget')).toEqual({ action: 'deleteDemandTarget', target: { date: override.date, role: override.role } });

    fakeProxy({ status: { body: status }, deleteDemandTarget: { body: { success: true } } });
    await act(async () => {
      result = await state.current!.removeOverride({ date: override.date, role: override.role });
    });
    expect(result.success).toBe(true);
    expect(state.current?.demandTargets).toEqual([]);
  });

  it('sends only the stored fields of an override', async () => {
    const fetchMock = fakeProxy({ status: { body: status }, loadTargets: { body: { targets: [], hasMore: false } } });
    const state = await render();
    await act(async () => {
      await state.current!.overrideTarget({ ...override, expected: 4.2, model: 'holtWinters', mase: 0.7 });
    });
    expect(sentBody(fetchMock, 'upsertTargets').targets).toEqual([{ date: override.date, role: override.role, required: 5, notes: 'Launch' }]);
  });
});
