import { act } from 'react-test-renderer';

import { useRoster } from '../useRoster';
import { callsOf, deferred, flush, installFakeProxy, renderHook, type ProxyReply } from '../testUtils/fakeProxy';

const W1 = '11111111-1111-4111-8111-111111111111';
const T1 = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444444';
const S2 = '55555555-5555-4555-8555-555555555555';

const dbShift = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  accountId: 'acc-1',
  date: '2026-11-02',
  workerId: W1,
  templateId: T1,
  location: 'HQ',
  status: 'Draft',
  notified: false,
  ...overrides,
});

const proxy = (overrides: Record<string, ProxyReply | (() => ProxyReply | Promise<ProxyReply>)> = {}) =>
  installFakeProxy((body) => {
    const override = overrides[body.action];
    if (override) return typeof override === 'function' ? override() : override;
    switch (body.action) {
      case 'listRoster':
        return { body: { shifts: [dbShift(S1), dbShift(S2, { status: 'Published', notified: true, date: '2026-11-03' })], hasMore: false } };
      case 'upsertRosterShift':
        return { body: { success: true, shift: { accountId: 'acc-1', ...(body.shift as object) } } };
      case 'updateShiftStatus':
        return { body: { success: true, shift: dbShift(body.id as string, { status: body.status, notified: false }) } };
      case 'markShiftNotified':
        return { body: { success: true, shift: dbShift(body.id as string, { status: 'Published', notified: true }) } };
      default:
        return { body: { success: true } };
    }
  });

type Hook = ReturnType<typeof useRoster>;
const useRosterProps = ({ accountId, filters }: { accountId: string; filters?: { fromDate?: string; toDate?: string } }): Hook =>
  useRoster(accountId, filters);

describe('useRoster', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('loads the stored roster with status and notified', async () => {
    proxy();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    expect(hook.result.loaded).toBe(true);
    expect(hook.result.roster).toEqual([
      { id: S1, date: '2026-11-02', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: false },
      { id: S2, date: '2026-11-03', workerId: W1, templateId: T1, location: 'HQ', status: 'Published', notified: true },
    ]);
  });

  it('sends date filters, and does not reload for an equal filters object', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1', filters: { fromDate: '2026-11-01', toDate: '2026-11-07' } });
    expect(callsOf(fetchMock, 'listRoster')).toEqual([{ action: 'listRoster', fromDate: '2026-11-01', toDate: '2026-11-07', page: 0 }]);
    await hook.rerender({ accountId: 'acc-1', filters: { fromDate: '2026-11-01', toDate: '2026-11-07' } });
    expect(callsOf(fetchMock, 'listRoster')).toHaveLength(1);
  });

  it('reports a failed load', async () => {
    proxy({ listRoster: { status: 503, body: { error: 'Database is not configured' } } });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    expect(hook.result.error).toBe('Database is not configured');
    expect(hook.result.loaded).toBe(false);
  });

  it('adds a shift and rolls it back when the server refuses it', async () => {
    proxy({ upsertRosterShift: { status: 409, body: { error: 'Conflicting record' } } });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<Hook['addShift']>>;
    await act(async () => {
      result = await hook.result.addShift({ date: '2026-11-02', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: false });
    });
    expect(result).toEqual({ success: false, error: 'Conflicting record' });
    expect(hook.result.roster.map((s) => s.id)).toEqual([S1, S2]);
  });

  it('keeps an added shift the server stores', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    await act(async () => {
      await hook.result.addShift({ date: '2026-11-09', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: false });
    });
    const sent = callsOf(fetchMock, 'upsertRosterShift')[0].shift as Record<string, unknown>;
    expect(sent).toMatchObject({ date: '2026-11-09', status: 'Draft', notified: false });
    expect(hook.result.roster.map((s) => s.id)).toEqual([S1, S2, sent.id]);
  });

  it('refuses a notified draft before sending it', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<Hook['addShift']>>;
    await act(async () => {
      result = await hook.result.addShift({ date: '2026-11-09', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: true });
    });
    expect(result.success).toBe(false);
    expect(callsOf(fetchMock, 'upsertRosterShift')).toHaveLength(0);
  });

  it('publishes optimistically (clearing notified) and keeps the stored shift', async () => {
    const save = deferred<ProxyReply>();
    proxy({ updateShiftStatus: () => save.promise });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.setShiftStatus(S2, 'Draft');
    });
    await flush();
    expect(hook.result.roster[1]).toMatchObject({ status: 'Draft', notified: false });
    await act(async () => {
      save.resolve({ body: { success: true, shift: dbShift(S2, { status: 'Draft', notified: false, date: '2026-11-03' }) } });
      await pending;
    });
    expect(hook.result.roster[1]).toMatchObject({ id: S2, status: 'Draft', notified: false });
  });

  it('restores status and notified when a status change is refused', async () => {
    proxy({ updateShiftStatus: { status: 404, body: { error: 'Not found' } } });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<Hook['setShiftStatus']>>;
    await act(async () => {
      result = await hook.result.setShiftStatus(S2, 'Draft');
    });
    expect(result).toEqual({ success: false, error: 'Not found' });
    expect(hook.result.roster[1]).toMatchObject({ status: 'Published', notified: true });
  });

  it('rolls back notified when the server refuses to notify a draft', async () => {
    proxy({ markShiftNotified: { status: 409, body: { error: 'Publish the shift before notifying' } } });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<Hook['notifyShift']>>;
    await act(async () => {
      result = await hook.result.notifyShift(S1);
    });
    expect(result).toEqual({ success: false, error: 'Publish the shift before notifying' });
    expect(hook.result.roster[0].notified).toBe(false);
  });

  it('marks a published shift notified', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    await act(async () => {
      await hook.result.setShiftStatus(S1, 'Published');
      await hook.result.notifyShift(S1);
    });
    expect(callsOf(fetchMock, 'markShiftNotified')).toEqual([{ action: 'markShiftNotified', id: S1 }]);
    expect(hook.result.roster[0]).toMatchObject({ status: 'Published', notified: true });
  });

  it('updates a shift and restores it when the update fails', async () => {
    proxy({ upsertRosterShift: { status: 400, body: { error: 'date must be a real YYYY-MM-DD date' } } });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    await act(async () => {
      await hook.result.updateShift(S1, { location: 'Bar' });
    });
    expect(hook.result.roster[0].location).toBe('HQ');
  });

  it('puts a deleted shift back when the delete fails, and drops it when it succeeds', async () => {
    proxy({ deleteRosterShift: { status: 500, body: { error: 'Database request failed' } } });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    await act(async () => {
      await hook.result.removeShift(S1);
    });
    expect(hook.result.roster.map((s) => s.id)).toEqual([S1, S2]);

    proxy();
    await act(async () => {
      await hook.result.removeShift(S1);
    });
    expect(hook.result.roster.map((s) => s.id)).toEqual([S2]);
  });

  it('reloads after a write that raced a load, so the stored row is not lost', async () => {
    const slowList = deferred<ProxyReply>();
    let listCalls = 0;
    const fetchMock = proxy({
      listRoster: () => {
        listCalls += 1;
        if (listCalls === 2) return slowList.promise;
        return { body: { shifts: [dbShift(S1)], hasMore: false } };
      },
    });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    act(() => {
      void hook.result.refresh();
    });
    await act(async () => {
      await hook.result.addShift({ date: '2026-11-09', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: false });
    });
    expect(callsOf(fetchMock, 'listRoster')).toHaveLength(3);
    await act(async () => {
      slowList.resolve({ body: { shifts: [dbShift(S1)], hasMore: false } });
    });
    await flush();
    // The third (latest) load won; the slow second one was ignored.
    expect(hook.result.roster.map((s) => s.id)).toEqual([S1]);
  });
});
