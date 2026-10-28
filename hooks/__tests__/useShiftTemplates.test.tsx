import { act } from 'react-test-renderer';

import { useShiftTemplates } from '../useShiftTemplates';
import { callsOf, flush, installFakeProxy, renderHook, type ProxyReply } from '../testUtils/fakeProxy';

const T1 = '33333333-3333-4333-8333-333333333333';
const dbTemplate = { id: T1, accountId: 'acc-1', name: 'Morning', role: 'Support', startTime: '09:00', endTime: '17:00', coverage: 2 };

const proxy = (overrides: Record<string, ProxyReply> = {}) =>
  installFakeProxy((body) => {
    if (overrides[body.action]) return overrides[body.action];
    if (body.action === 'listShiftTemplates') return { body: { templates: [dbTemplate], hasMore: false } };
    if (body.action === 'upsertShiftTemplate') return { body: { success: true, template: { accountId: 'acc-1', ...(body.template as object) } } };
    return { body: { success: true } };
  });

describe('useShiftTemplates', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('loads templates and maps startTime/endTime → start/end', async () => {
    proxy();
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    expect(hook.result.loaded).toBe(true);
    expect(hook.result.shiftTemplates).toEqual([{ id: T1, name: 'Morning', role: 'Support', start: '09:00', end: '17:00', coverage: 2 }]);
  });

  it('reports a proxy error instead of an empty list', async () => {
    proxy({ listShiftTemplates: { status: 500, body: { error: 'Database request failed' } } });
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    expect(hook.result.error).toBe('Database request failed');
    expect(hook.result.loaded).toBe(false);
    expect(hook.result.loading).toBe(false);
  });

  it('reports a network failure', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockRejectedValue(new Error('Network down'));
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    expect(hook.result.error).toBe('Network down');
  });

  it('adds an overnight template and keeps the stored row', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.addShiftTemplate>>;
    await act(async () => {
      result = await hook.result.addShiftTemplate('Night', 'Support', '22:00', '06:00', 1);
    });
    expect(result.success).toBe(true);
    const sent = callsOf(fetchMock, 'upsertShiftTemplate')[0].template as Record<string, unknown>;
    expect(sent).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Night', role: 'Support', startTime: '22:00', endTime: '06:00', coverage: 1 });
    expect(hook.result.shiftTemplates.map((t) => t.name)).toEqual(['Morning', 'Night']);
  });

  it('rolls back a template the server refuses', async () => {
    proxy({ upsertShiftTemplate: { status: 409, body: { error: 'Conflicting record' } } });
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.addShiftTemplate>>;
    await act(async () => {
      result = await hook.result.addShiftTemplate('Night', 'Support', '22:00', '06:00', 1);
    });
    expect(result).toEqual({ success: false, error: 'Conflicting record' });
    expect(hook.result.shiftTemplates.map((t) => t.name)).toEqual(['Morning']);
  });

  it('refuses a zero-length template before sending it', async () => {
    const fetchMock = proxy();
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.addShiftTemplate>>;
    await act(async () => {
      result = await hook.result.addShiftTemplate('Zero', 'Support', '08:00', '08:00', 1);
    });
    expect(result).toEqual({ success: false, error: 'startTime and endTime must differ' });
    expect(callsOf(fetchMock, 'upsertShiftTemplate')).toHaveLength(0);
  });

  it('restores a template whose update is refused', async () => {
    proxy({ upsertShiftTemplate: { status: 500, body: { error: 'Database request failed' } } });
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    await act(async () => {
      await hook.result.updateShiftTemplate(T1, { name: 'Early', role: 'Support', startTime: '06:00', endTime: '14:00', coverage: 3 });
    });
    expect(hook.result.shiftTemplates[0]).toMatchObject({ name: 'Morning', start: '09:00', coverage: 2 });
  });

  it('puts a template back when the delete is refused because shifts use it', async () => {
    proxy({ deleteShiftTemplate: { status: 409, body: { error: 'Record is still referenced' } } });
    const hook = await renderHook(useShiftTemplates, 'acc-1');
    let result!: Awaited<ReturnType<typeof hook.result.removeShiftTemplate>>;
    await act(async () => {
      result = await hook.result.removeShiftTemplate(T1);
    });
    await flush();
    expect(result).toEqual({ success: false, error: 'Record is still referenced' });
    expect(hook.result.shiftTemplates.map((t) => t.id)).toEqual([T1]);
  });
});
