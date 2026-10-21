import { act } from 'react-test-renderer';

import { useWorkers } from '../useWorkers';
import { callsOf, deferred, flush, installFakeProxy, renderHook, type ProxyReply } from '../testUtils/fakeProxy';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const AV1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const dbWorker = (id: string, name: string) => ({ id, accountId: 'acc-1', name, role: 'Support', skills: ['Chat'] });
const dbAvailability = { id: AV1, accountId: 'acc-1', workerId: W1, dayOfWeek: 'Mon', fromTime: '09:00', toTime: '17:00' };

const baseLists = (): Record<string, ProxyReply> => ({
  listWorkers: { body: { workers: [dbWorker(W1, 'Alice'), dbWorker(W2, 'Bruno')], hasMore: false } },
  listWorkerAvailability: { body: { availabilities: [dbAvailability], hasMore: false } },
});

/** Answers lists from `lists`, echoes writes back as stored, and lets a test override any action. */
const proxy = (overrides: Record<string, ProxyReply | (() => ProxyReply | Promise<ProxyReply>)> = {}) =>
  installFakeProxy((body) => {
    const override = overrides[body.action];
    if (override) return typeof override === 'function' ? override() : override;
    const list = baseLists()[body.action];
    if (list) return list;
    if (body.action === 'upsertWorker') return { body: { success: true, worker: { accountId: 'acc-1', ...(body.worker as object) } } };
    if (body.action === 'upsertAvailability') return { body: { success: true, availability: { accountId: 'acc-1', ...(body.availability as object) } } };
    return { body: { success: true } };
  });

describe('useWorkers', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('loads workers with their availability (slot ids kept) and display ids', async () => {
    proxy();
    const hook = await renderHook(useWorkers, 'acc-1');
    expect(hook.result.loading).toBe(false);
    expect(hook.result.loaded).toBe(true);
    expect(hook.result.error).toBeNull();
    expect(hook.result.workers.map((w) => [w.displayId, w.name])).toEqual([['W-1', 'Alice'], ['W-2', 'Bruno']]);
    expect(hook.result.workers[0].availability).toEqual([{ id: AV1, day: 'Mon', from: '09:00', to: '17:00' }]);
  });

  it('reads every page of a list', async () => {
    const fetchMock = installFakeProxy((body) => {
      if (body.action === 'listWorkers') {
        return body.page === 0
          ? { body: { workers: [dbWorker(W1, 'Alice')], hasMore: true } }
          : { body: { workers: [dbWorker(W2, 'Bruno')], hasMore: false } };
      }
      return { body: { availabilities: [], hasMore: false } };
    });
    const hook = await renderHook(useWorkers, 'acc-1');
    expect(hook.result.workers.map((w) => w.name)).toEqual(['Alice', 'Bruno']);
    expect(callsOf(fetchMock, 'listWorkers').map((b) => b.page)).toEqual([0, 1]);
    expect(hook.result.truncated).toBe(false);
  });

  it('reports a failed load instead of showing an empty team', async () => {
    proxy({ listWorkers: { status: 500, body: { error: 'Database request failed' } } });
    const hook = await renderHook(useWorkers, 'acc-1');
    expect(hook.result.loaded).toBe(false);
    expect(hook.result.loading).toBe(false);
    expect(hook.result.error).toBe('Database request failed');
    expect(hook.result.workers).toEqual([]);
  });

  it('shows a new worker at once and keeps the stored row', async () => {
    const save = deferred<ProxyReply>();
    const fetchMock = proxy({ upsertWorker: () => save.promise });
    const hook = await renderHook(useWorkers, 'acc-1');

    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.addWorker('Carla', 'Support', ['Phone'], { nightWorker: true });
    });
    await flush();
    expect(hook.result.workers.map((w) => w.name)).toEqual(['Alice', 'Bruno', 'Carla']);

    const sent = callsOf(fetchMock, 'upsertWorker')[0].worker as Record<string, unknown>;
    expect(sent).toMatchObject({ name: 'Carla', role: 'Support', skills: ['Phone'], nightWorker: true });
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent).not.toHaveProperty('accountId');

    await act(async () => {
      save.resolve({ body: { success: true, worker: { ...sent, name: 'Carla', accountId: 'acc-1', nightWorker: true } } });
      await pending;
    });
    expect(hook.result.workers[2]).toMatchObject({ id: sent.id, name: 'Carla', nightWorker: true, displayId: 'W-3' });
  });

  it('rolls a new worker back and returns the server error when the save is refused', async () => {
    proxy({ upsertWorker: { status: 409, body: { error: 'Conflicting record' } } });
    const hook = await renderHook(useWorkers, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.addWorker>>;
    await act(async () => {
      result = await hook.result.addWorker('Carla', 'Support', []);
    });
    expect(result).toEqual({ success: false, error: 'Conflicting record' });
    expect(hook.result.workers.map((w) => w.name)).toEqual(['Alice', 'Bruno']);
  });

  it('refuses an invalid worker before sending anything', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useWorkers, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.addWorker>>;
    await act(async () => {
      result = await hook.result.addWorker('   ', 'Support', []);
    });
    expect(result.success).toBe(false);
    expect(callsOf(fetchMock, 'upsertWorker')).toHaveLength(0);
    expect(hook.result.workers).toHaveLength(2);
  });

  it('restores the previous values when an update is refused', async () => {
    proxy({ upsertWorker: { status: 500, body: { error: 'Database request failed' } } });
    const hook = await renderHook(useWorkers, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.updateWorker>>;
    await act(async () => {
      result = await hook.result.updateWorker(W1, { name: 'Alicia', role: 'Lead', skills: [] });
    });
    expect(result).toEqual({ success: false, error: 'Database request failed' });
    expect(hook.result.workers[0]).toMatchObject({ id: W1, name: 'Alice', role: 'Support', skills: ['Chat'] });
  });

  it('saves an update and keeps the worker availability', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useWorkers, 'acc-1');
    await act(async () => {
      await hook.result.updateWorker(W1, { name: 'Alicia', role: 'Support', skills: ['Chat'] });
    });
    expect(callsOf(fetchMock, 'upsertWorker')[0].worker).toMatchObject({ id: W1, name: 'Alicia' });
    expect(hook.result.workers[0]).toMatchObject({ name: 'Alicia', availability: [{ id: AV1 }] });
  });

  it('puts a deleted worker back in place when the delete is refused (still rostered)', async () => {
    proxy({ deleteWorker: { status: 409, body: { error: 'Record is still referenced' } } });
    const hook = await renderHook(useWorkers, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.removeWorker>>;
    await act(async () => {
      result = await hook.result.removeWorker(W1);
    });
    expect(result).toEqual({ success: false, error: 'Record is still referenced' });
    expect(hook.result.workers.map((w) => w.id)).toEqual([W1, W2]);
  });

  it('deletes a worker through the proxy', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useWorkers, 'acc-1');
    await act(async () => {
      await hook.result.removeWorker(W2);
    });
    expect(callsOf(fetchMock, 'deleteWorker')).toEqual([{ action: 'deleteWorker', id: W2 }]);
    expect(hook.result.workers.map((w) => w.id)).toEqual([W1]);
  });

  it('rolls back an availability slot the server refuses, and removes one it accepts', async () => {
    const hook = await (async () => {
      proxy({ upsertAvailability: { status: 404, body: { error: 'Not found' } } });
      return renderHook(useWorkers, 'acc-1');
    })();
    let added!: Awaited<ReturnType<typeof hook.result.addAvailability>>;
    await act(async () => {
      added = await hook.result.addAvailability(W2, 'Tue', '22:00', '06:00');
    });
    expect(added).toEqual({ success: false, error: 'Not found' });
    expect(hook.result.workers[1].availability).toEqual([]);

    const fetchMock = proxy();
    await act(async () => {
      await hook.result.removeAvailability(W1, AV1);
    });
    expect(callsOf(fetchMock, 'deleteAvailability')).toEqual([{ action: 'deleteAvailability', id: AV1 }]);
    expect(hook.result.workers[0].availability).toEqual([]);
  });

  it('puts an availability slot back when its delete fails', async () => {
    proxy({ deleteAvailability: { status: 500, body: { error: 'Database request failed' } } });
    const hook = await renderHook(useWorkers, 'acc-1');
    await act(async () => {
      await hook.result.removeAvailability(W1, AV1);
    });
    expect(hook.result.workers[0].availability).toEqual([{ id: AV1, day: 'Mon', from: '09:00', to: '17:00' }]);
  });

  it('ignores a load that finishes after a newer one (request-id guard)', async () => {
    const first = deferred<ProxyReply>();
    let calls = 0;
    proxy({
      listWorkers: () => {
        calls += 1;
        return calls === 1 ? first.promise : { body: { workers: [dbWorker(W2, 'Newest')], hasMore: false } };
      },
    });
    const hook = await renderHook(useWorkers, 'acc-1');
    await act(async () => {
      await hook.result.refresh();
    });
    expect(hook.result.workers.map((w) => w.name)).toEqual(['Newest']);
    await act(async () => {
      first.resolve({ body: { workers: [dbWorker(W1, 'Stale')], hasMore: false } });
    });
    await flush();
    expect(hook.result.workers.map((w) => w.name)).toEqual(['Newest']);
  });

  it('clears the list when the tenant changes', async () => {
    const tenantB = deferred<ProxyReply>();
    let calls = 0;
    proxy({
      listWorkers: () => {
        calls += 1;
        return calls === 1 ? baseLists().listWorkers : tenantB.promise;
      },
    });
    const hook = await renderHook(useWorkers, 'acc-1');
    expect(hook.result.workers).toHaveLength(2);
    await hook.rerender('org-2');
    expect(hook.result.workers).toEqual([]);
    expect(hook.result.loaded).toBe(false);
    await act(async () => {
      tenantB.resolve({ body: { workers: [], hasMore: false } });
    });
    await flush();
    expect(hook.result.loaded).toBe(true);
  });
});
