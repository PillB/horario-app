/**
 * Analytics insights (CHG-109): a failed load is an error, not an empty
 * account (D2), only the newest load ends the loading state (the old guard
 * compared a ref with itself), and the tenant is the signed-in one (D4).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useCapacityForecast } from '../useCapacityForecast';
import { deferred, installFakeProxy, renderHook, type ProxyReply } from '../testUtils/fakeProxy';

const empty = (action: string): ProxyReply => {
  if (action === 'listShiftTemplates') return { body: { templates: [], hasMore: false } };
  if (action === 'listWorkers') return { body: { workers: [], hasMore: false } };
  if (action === 'loadTargets') return { body: { targets: [], hasMore: false } };
  return { body: { shifts: [], hasMore: false } };
};

describe('useCapacityForecast', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('reports a failed list instead of showing no gaps and no risks', async () => {
    installFakeProxy((body) =>
      body.action === 'listWorkers' ? { status: 503, body: { error: 'The database is not reachable. Try again' } } : empty(body.action),
    );
    const hook = await renderHook(({ id }: { id: string }) => useCapacityForecast(id), { id: 'acc' });
    expect(hook.result.loading).toBe(false);
    expect(hook.result.error).toBe('The database is not reachable. Try again');
    expect(hook.result.gaps).toEqual([]);
  });

  it('stays loading while a newer load runs, when an older one finishes first', async () => {
    const slow = deferred<ProxyReply>();
    const gate = deferred<ProxyReply>();
    let tenant = 'acc-a';
    // acc-a's workers wait on `gate`, so acc-a finishes after acc-b's load started;
    // acc-b's workers wait on `slow`. The tenant is read when the request is sent.
    installFakeProxy((body) => {
      if (body.action !== 'listWorkers') return empty(body.action);
      return tenant === 'acc-a' ? gate.promise : slow.promise;
    });
    const hook = await renderHook(({ id }: { id: string }) => useCapacityForecast(id), { id: 'acc-a' });
    expect(hook.result.loading).toBe(true);
    tenant = 'acc-b';
    await hook.rerender({ id: 'acc-b' });
    await act(async () => {
      gate.resolve(empty('listWorkers'));
    });
    // Let acc-a's whole load finish (every list, every page).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // acc-a's answer is stale: acc-b is still loading.
    expect(hook.result.loading).toBe(true);
    await act(async () => {
      slow.resolve(empty('listWorkers'));
    });
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(hook.result.loading).toBe(false);
    expect(hook.result.error).toBeNull();
  });
});

// ─── useLeaderInsights and InsightsPanel, with their sources replaced ─────────

let mockAccountId = 'org_a';
jest.mock('@/contexts/IdentityContext', () => ({
  useIdentity: () => ({ accountId: mockAccountId, userId: 'u1', isLoaded: true }),
}));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn(async () => undefined) }));

describe('useLeaderInsights (D4)', () => {
  it('loads for the signed-in organization, and again after a switch', async () => {
    const capacity = jest.spyOn(jest.requireActual('../useCapacityForecast'), 'useCapacityForecast');
    const { useLeaderInsights } = jest.requireActual('../useLeaderInsights') as typeof import('../useLeaderInsights');
    installFakeProxy((body) => empty(body.action));
    mockAccountId = 'org_a';
    const hook = await renderHook(() => useLeaderInsights(), {});
    expect(capacity).toHaveBeenLastCalledWith('org_a');
    mockAccountId = 'org_b';
    await hook.rerender({});
    expect(capacity).toHaveBeenLastCalledWith('org_b');
    expect(hook.result.error).toBeNull();
    capacity.mockRestore();
  });
});

describe('InsightsPanel (D2)', () => {
  it('says the insights could not be loaded instead of "nothing needs attention"', async () => {
    jest.doMock('@/contexts/LocaleContext', () => ({
      useT: () => ({ t: (key: string, params?: Record<string, string>) => (params?.error ? `${key}:${params.error}` : key) }),
    }));
    jest.doMock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
    installFakeProxy((body) =>
      body.action === 'loadTargets' ? { status: 500, body: { error: 'Database request failed' } } : empty(body.action),
    );
    const { InsightsPanel } = jest.requireActual('@/components/analytics/InsightsPanel') as typeof import('@/components/analytics/InsightsPanel');
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<InsightsPanel accountId="org_a" />);
    });
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    const texts = tree.root
      .findAll((node) => typeof node.type === 'string' && typeof node.children?.[0] === 'string')
      .map((node) => node.children[0]);
    expect(texts.some((text) => String(text).startsWith('analytics.insights.loadError:'))).toBe(true);
    expect(texts).not.toContain('analytics.insights.actionsEmpty');
    act(() => tree.unmount());
  });
});
