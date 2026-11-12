import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useLocations } from '../useLocations';

const lima = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Lima',
  countryCode: 'PE',
  regionCode: null,
  cityCode: null,
  jurisdictionCode: 'PE',
  timeZone: 'America/Lima',
  industry: 'food_service',
  employerHeadcount: null,
  locationsCount: null,
  detectedHint: null,
  overrides: [],
  confirmedBy: 'user_a',
  confirmedAt: '2026-10-20T00:00:00Z',
};

type Reply = { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

const mockProxy = (handler: (body: Record<string, unknown>) => Reply) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const reply = await handler(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });

const renderHook = async (accountId = 'acc') => {
  let state: ReturnType<typeof useLocations> | null = null;
  let root: renderer.ReactTestRenderer;
  const Probe = ({ id }: { id: string }) => {
    const hook = useLocations(id);
    useEffect(() => {
      state = hook;
    }, [hook]);
    return null;
  };
  await act(async () => {
    root = renderer.create(<Probe id={accountId} />);
  });
  return {
    get: () => state!,
    rerender: async (id: string) => {
      await act(async () => {
        root.update(<Probe id={id} />);
      });
    },
  };
};

describe('useLocations', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    warn.mockRestore();
  });

  it('lists locations on mount', async () => {
    const fetchSpy = mockProxy(() => ({ body: { locations: [lima] } }));
    const hook = await renderHook();
    expect(hook.get()).toMatchObject({ loading: false, loaded: true, error: null, locations: [lima] });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ action: 'listLocations' });
  });

  it('reports a failed load without marking it loaded', async () => {
    mockProxy(() => ({ status: 503, body: { error: 'Authentication is not configured' } }));
    const hook = await renderHook();
    expect(hook.get()).toMatchObject({ loaded: false, error: 'Authentication is not configured', locations: [] });
  });

  it('saves, updates in place and deletes', async () => {
    mockProxy((body) => {
      if (body.action === 'listLocations') return { body: { locations: [] } };
      if (body.action === 'upsertLocation') return { body: { success: true, location: { ...lima, ...(body.location as object) } } };
      return { body: { success: true } };
    });
    const hook = await renderHook();
    await act(async () => {
      await hook.get().save({ id: lima.id, name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service' });
    });
    expect(hook.get().locations).toHaveLength(1);
    await act(async () => {
      await hook.get().save({ id: lima.id, name: 'Lima Norte', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'retail' });
    });
    expect(hook.get().locations.map((l) => l.name)).toEqual(['Lima Norte']);
    await act(async () => {
      await hook.get().remove(lima.id);
    });
    expect(hook.get().locations).toEqual([]);
  });

  it('keeps the list when a delete is refused', async () => {
    mockProxy((body) =>
      body.action === 'listLocations' ? { body: { locations: [lima] } } : { status: 403, body: { error: 'Only an admin of this business can do this' } },
    );
    const hook = await renderHook();
    let result: Awaited<ReturnType<ReturnType<typeof useLocations>['remove']>> | null = null;
    await act(async () => {
      result = await hook.get().remove(lima.id);
    });
    expect(result).toEqual({ ok: false, error: 'Only an admin of this business can do this' });
    expect(hook.get().locations).toEqual([lima]);
  });

  it('ignores a stale list response after the tenant changes', async () => {
    let releaseFirst: (v: { body: unknown }) => void = () => {};
    let calls = 0;
    mockProxy(() => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { releaseFirst = resolve; });
      return { body: { locations: [] } };
    });
    const hook = await renderHook('tenant-a');
    await hook.rerender('tenant-b');
    expect(hook.get()).toMatchObject({ loaded: true, locations: [] });
    await act(async () => {
      releaseFirst({ body: { locations: [lima] } });
    });
    expect(hook.get().locations).toEqual([]);
  });

  describe('saves that cross or are retried (CHG-100)', () => {
    const input = { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service' };
    const bodies = (spy: jest.SpyInstance, action: string) =>
      spy.mock.calls.map((c) => JSON.parse(String(c[1]?.body)) as Record<string, unknown>).filter((b) => b.action === action);

    it('keeps the id of a new location until a save succeeds, so a retry is the same location', async () => {
      let attempt = 0;
      const spy = mockProxy((body) => {
        if (body.action === 'listLocations') return { body: { locations: [] } };
        attempt += 1;
        return attempt === 1
          ? { status: 500, body: { error: 'Request failed' } }
          : { body: { success: true, location: { ...lima, ...(body.location as object) } } };
      });
      const hook = await renderHook();
      await act(async () => {
        await hook.get().save(input);
      });
      await act(async () => {
        await hook.get().save(input);
      });
      const ids = bodies(spy, 'upsertLocation').map((b) => (b.location as { id: string }).id);
      expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(ids[1]).toBe(ids[0]);
      // The next new location is a different one.
      await act(async () => {
        await hook.get().save(input);
      });
      expect((bodies(spy, 'upsertLocation')[2]?.location as { id: string }).id).not.toBe(ids[0]);
    });

    it('sends the version it read with an edit and reloads when someone else changed it', async () => {
      const stored = { ...lima, updatedAt: '2026-11-11T10:00:00.123456+00:00' };
      const spy = mockProxy((body) =>
        body.action === 'listLocations'
          ? { body: { locations: [stored] } }
          : { status: 409, body: { error: 'Someone else changed this while you were editing' } },
      );
      const hook = await renderHook();
      let result: { ok: boolean } | undefined;
      await act(async () => {
        result = await hook.get().save({ ...input, id: lima.id, name: 'Lima Norte' });
      });
      expect(result?.ok).toBe(false);
      expect(bodies(spy, 'upsertLocation')[0]?.ifUpdatedAt).toBe('2026-11-11T10:00:00.123456+00:00');
      expect(bodies(spy, 'listLocations')).toHaveLength(2);
      expect(hook.get().locations.map((l) => l.name)).toEqual(['Lima']);
    });
  });
});
