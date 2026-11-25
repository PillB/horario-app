/**
 * Writes the server refused, judged from what it holds after one reload
 * (CHG-109, red-team round 2). The fake server keeps state, so the reload
 * shows exactly what was stored.
 *
 * - An edit refused with 409 returns the `updatedAt` of the version now
 *   stored, so the form can save again on purpose (before, every later save
 *   was refused with the old one).
 * - An edit whose stored row already holds the values (the user's own save
 *   went through and only its answer was lost) is reported as saved, not as
 *   "someone else changed it".
 * - The roster's "already stored" fallback only trusts a reload that
 *   succeeded, and only after a refusal that may have stored the batch.
 * - Each failure reloads the list once.
 */
import { act } from 'react-test-renderer';

import { judgeRefusedEdit, sameValues } from '../usePersistedList';
import { useRoster } from '../useRoster';
import { useShiftTemplates } from '../useShiftTemplates';
import { useWorkers } from '../useWorkers';
import { callsOf, installFakeProxy, renderHook, type ProxyBody, type ProxyReply } from '../testUtils/fakeProxy';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const READ_AT = '2026-11-20T10:00:00.000001+00:00';
const NEWER = '2026-11-21T08:00:00.123456+00:00';
const SAVED_AT = '2026-11-22T09:30:00.5+00:00';

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('sameValues and judgeRefusedEdit', () => {
  it('compare only the edited keys, a stored null equal to an absent value', () => {
    expect(sameValues({ id: 'a', name: 'Ana', birthDate: null as string | null }, { name: 'Ana', birthDate: undefined })).toBe(true);
    expect(sameValues({ id: 'a', skills: ['x'] }, { skills: ['x'] })).toBe(true);
    expect(sameValues({ id: 'a', skills: ['x'] }, { skills: ['y'] })).toBe(false);
    expect(sameValues({ id: 'a' } as { id: string; birthDate?: string | null }, { birthDate: null })).toBe(true);
  });

  it('say saved, conflict or failed from the reloaded row and the status', () => {
    const rows = [{ id: 'a', name: 'Ana', updatedAt: NEWER }];
    expect(judgeRefusedEdit(true, rows, 'a', { name: 'Ana' }, 502)).toEqual({ kind: 'saved' });
    expect(judgeRefusedEdit(true, rows, 'a', { name: 'Bea' }, 409)).toEqual({ kind: 'conflict', row: rows[0] });
    expect(judgeRefusedEdit(true, rows, 'a', { name: 'Bea' }, 403)).toEqual({ kind: 'failed' });
    // The reload failed: nothing is known, even if the old list looks right.
    expect(judgeRefusedEdit(false, rows, 'a', { name: 'Ana' }, 409)).toEqual({ kind: 'failed' });
    // Deleted meanwhile.
    expect(judgeRefusedEdit(true, [], 'a', { name: 'Ana' }, 404)).toEqual({ kind: 'failed' });
  });
});

// ─── Workers ─────────────────────────────────────────────────────────────────

type StoredW = { id: string; name: string; role: string; skills: string[]; updatedAt: string };

const workerServer = (initial: StoredW, onUpsert?: (body: ProxyBody, stored: StoredW) => ProxyReply | null) => {
  const state = { stored: initial };
  const fetchMock = installFakeProxy(async (body: ProxyBody): Promise<ProxyReply> => {
    if (body.action === 'listWorkers') return { body: { workers: [{ accountId: 'acc-1', ...state.stored }], hasMore: false } };
    if (body.action === 'listWorkerAvailability') return { body: { availabilities: [], hasMore: false } };
    if (body.action === 'upsertWorker') {
      const custom = onUpsert?.(body, state.stored);
      if (custom) return custom;
      if (body.ifUpdatedAt !== state.stored.updatedAt) {
        return { status: 409, body: { error: 'Someone else changed this worker. Reload and try again' } };
      }
      const w = body.worker as StoredW;
      state.stored = { id: w.id, name: w.name, role: w.role, skills: w.skills, updatedAt: SAVED_AT };
      return { body: { success: true, worker: { accountId: 'acc-1', ...state.stored } } };
    }
    return { body: { success: true } };
  });
  return { state, fetchMock };
};

describe('useWorkers.updateWorker refused', () => {
  it('a 409 gives the stored version, and a save with it replaces that version', async () => {
    const { state, fetchMock } = workerServer({ id: W1, name: 'Ana', role: 'Cook', skills: [], updatedAt: READ_AT });
    const hook = await renderHook(({ accountId }: { accountId: string }) => useWorkers(accountId), { accountId: 'acc-1' });
    // Saved elsewhere after the form read the row.
    state.stored = { ...state.stored, name: 'Ana María', updatedAt: NEWER };
    const listsBefore = callsOf(fetchMock, 'listWorkers').length;
    let first!: Awaited<ReturnType<ReturnType<typeof useWorkers>['updateWorker']>>;
    await act(async () => {
      first = await hook.result.updateWorker(W1, { name: 'Ana P.', role: 'Cook', skills: [] }, READ_AT);
    });
    expect(first).toEqual({ success: false, error: 'Someone else changed this worker. Reload and try again', conflictUpdatedAt: NEWER });
    // One reload, not two (the write's own reload is off for an edit).
    expect(callsOf(fetchMock, 'listWorkers').length - listsBefore).toBe(1);
    expect(hook.result.workers[0].name).toBe('Ana María');

    let second!: typeof first;
    await act(async () => {
      second = await hook.result.updateWorker(W1, { name: 'Ana P.', role: 'Cook', skills: [] }, first.success ? undefined : first.conflictUpdatedAt);
    });
    expect(second).toEqual({ success: true });
    expect(state.stored.name).toBe('Ana P.');
    expect(hook.result.workers[0].name).toBe('Ana P.');
  });

  it('a lost answer of the own save is reported as saved, not as a change by someone else', async () => {
    const { state } = workerServer(
      { id: W1, name: 'Ana', role: 'Cook', skills: [], updatedAt: READ_AT },
      (body, stored) => {
        // Stored, then the gateway drops the answer.
        const w = body.worker as StoredW;
        state.stored = { ...stored, name: w.name, role: w.role, skills: w.skills, updatedAt: SAVED_AT };
        return { status: 502, body: { error: 'Bad gateway' } };
      },
    );
    const hook = await renderHook(({ accountId }: { accountId: string }) => useWorkers(accountId), { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<ReturnType<typeof useWorkers>['updateWorker']>>;
    await act(async () => {
      result = await hook.result.updateWorker(W1, { name: 'Ana P.', role: 'Cook', skills: ['grill'] }, READ_AT);
    });
    expect(result).toEqual({ success: true, alreadySaved: true });
    expect(hook.result.workers[0]).toMatchObject({ name: 'Ana P.', skills: ['grill'], updatedAt: SAVED_AT });
  });

  it('a retry refused with 409 because the first try was stored is reported as saved', async () => {
    // The first try stored the values (its answer was lost); the retry still
    // sends the old updatedAt and is refused.
    workerServer({ id: W1, name: 'Ana P.', role: 'Cook', skills: [], updatedAt: NEWER });
    const hook = await renderHook(({ accountId }: { accountId: string }) => useWorkers(accountId), { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<ReturnType<typeof useWorkers>['updateWorker']>>;
    await act(async () => {
      result = await hook.result.updateWorker(W1, { name: 'Ana P.', role: 'Cook', skills: [] }, READ_AT);
    });
    expect(result).toEqual({ success: true, alreadySaved: true });
  });

  it('a refusal while offline stays a failure (the reload failed too)', async () => {
    installFakeProxy(async (body: ProxyBody): Promise<ProxyReply> => {
      if (body.action === 'listWorkers') return { body: { workers: [{ accountId: 'acc-1', id: W1, name: 'Ana', role: 'Cook', skills: [], updatedAt: READ_AT }], hasMore: false } };
      if (body.action === 'listWorkerAvailability') return { body: { availabilities: [], hasMore: false } };
      throw new Error('Network request failed');
    });
    const hook = await renderHook(({ accountId }: { accountId: string }) => useWorkers(accountId), { accountId: 'acc-1' });
    installFakeProxy(async () => {
      throw new Error('Network request failed');
    });
    let result!: Awaited<ReturnType<ReturnType<typeof useWorkers>['updateWorker']>>;
    await act(async () => {
      result = await hook.result.updateWorker(W1, { name: 'Ana', role: 'Cook', skills: [] }, READ_AT);
    });
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.conflictUpdatedAt).toBeUndefined();
  });
});

// ─── Templates ───────────────────────────────────────────────────────────────

type StoredT = { id: string; name: string; role: string; startTime: string; endTime: string; coverage: number; updatedAt: string };

describe('useShiftTemplates.updateShiftTemplate refused', () => {
  const changes = { name: 'Morning', role: 'Cook', startTime: '07:00', endTime: '15:00', coverage: 2 };

  const templateServer = (initial: StoredT, lose = false) => {
    const state = { stored: initial };
    const fetchMock = installFakeProxy(async (body: ProxyBody): Promise<ProxyReply> => {
      if (body.action === 'listShiftTemplates') return { body: { templates: [{ accountId: 'acc-1', ...state.stored }], hasMore: false } };
      if (body.action === 'upsertShiftTemplate') {
        if (body.ifUpdatedAt !== state.stored.updatedAt) return { status: 409, body: { error: 'Someone else changed this template' } };
        state.stored = { ...(body.template as StoredT), updatedAt: SAVED_AT };
        if (lose) return { status: 504, body: { error: 'Gateway timeout' } };
        return { body: { success: true, template: { accountId: 'acc-1', ...state.stored } } };
      }
      return { body: { success: true } };
    });
    return { state, fetchMock };
  };

  it('a 409 gives the stored version, and a save with it goes through', async () => {
    const { state, fetchMock } = templateServer({ id: T1, ...changes, endTime: '14:00', updatedAt: READ_AT });
    const hook = await renderHook(({ accountId }: { accountId: string }) => useShiftTemplates(accountId), { accountId: 'acc-1' });
    state.stored = { ...state.stored, endTime: '16:00', updatedAt: NEWER };
    const listsBefore = callsOf(fetchMock, 'listShiftTemplates').length;
    let first!: Awaited<ReturnType<ReturnType<typeof useShiftTemplates>['updateShiftTemplate']>>;
    await act(async () => {
      first = await hook.result.updateShiftTemplate(T1, changes, READ_AT);
    });
    expect(first).toEqual({ success: false, error: 'Someone else changed this template', conflictUpdatedAt: NEWER });
    expect(callsOf(fetchMock, 'listShiftTemplates').length - listsBefore).toBe(1);
    let second!: typeof first;
    await act(async () => {
      second = await hook.result.updateShiftTemplate(T1, changes, NEWER);
    });
    expect(second).toEqual({ success: true });
    expect(state.stored.endTime).toBe('15:00');
  });

  it('a lost answer of the own save is reported as saved', async () => {
    templateServer({ id: T1, ...changes, endTime: '14:00', updatedAt: READ_AT }, true);
    const hook = await renderHook(({ accountId }: { accountId: string }) => useShiftTemplates(accountId), { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<ReturnType<typeof useShiftTemplates>['updateShiftTemplate']>>;
    await act(async () => {
      result = await hook.result.updateShiftTemplate(T1, changes, READ_AT);
    });
    expect(result).toEqual({ success: true, alreadySaved: true });
    expect(hook.result.shiftTemplates[0]).toMatchObject({ end: '15:00', updatedAt: SAVED_AT });
  });
});

// ─── Roster batch ────────────────────────────────────────────────────────────

describe('useRoster.addShifts "already stored" fallback', () => {
  const batch = [
    { date: '2026-12-01', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft' as const, notified: false },
    { date: '2026-12-02', workerId: W2, templateId: T1, location: 'HQ', status: 'Draft' as const, notified: false },
  ];
  const stored = batch.map((s, i) => ({ accountId: 'acc-1', id: `5555555${i}-5555-4555-8555-555555555555`, ...s }));
  const useRosterProps = ({ accountId }: { accountId: string }) => useRoster(accountId);

  it('fails offline: the reload failed too, so the optimistic rows prove nothing', async () => {
    let online = true;
    installFakeProxy(async (body: ProxyBody): Promise<ProxyReply> => {
      if (!online) throw new Error('Network request failed');
      if (body.action === 'listRoster') return { body: { shifts: [], hasMore: false } };
      return { body: { success: true } };
    });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    online = false;
    let result!: Awaited<ReturnType<ReturnType<typeof useRoster>['addShifts']>>;
    await act(async () => {
      result = await hook.result.addShifts(batch, { countAutoAssign: true });
    });
    expect(result.success).toBe(false);
    expect(hook.result.roster).toEqual([]);
  });

  it('fails on a refusal that saved nothing (400), even when the slots are on the roster', async () => {
    installFakeProxy(async (body: ProxyBody): Promise<ProxyReply> => {
      if (body.action === 'listRoster') return { body: { shifts: stored, hasMore: false } };
      if (body.action === 'addRosterShifts') return { status: 400, body: { error: 'A shift date is not valid' } };
      return { body: { success: true } };
    });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let result!: Awaited<ReturnType<ReturnType<typeof useRoster>['addShifts']>>;
    await act(async () => {
      result = await hook.result.addShifts(batch, { countAutoAssign: true });
    });
    expect(result).toEqual({ success: false, error: 'A shift date is not valid' });
  });

  it('reloads once after a failure and trusts that reload for a 409', async () => {
    let calls = 0;
    const fetchMock = installFakeProxy(async (body: ProxyBody): Promise<ProxyReply> => {
      if (body.action === 'listRoster') return { body: { shifts: calls > 0 ? stored : [], hasMore: false } };
      if (body.action === 'addRosterShifts') {
        calls += 1;
        return { status: 409, body: { error: 'One of these shifts is already on the roster' } };
      }
      return { body: { success: true } };
    });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    const before = callsOf(fetchMock, 'listRoster').length;
    let result!: Awaited<ReturnType<ReturnType<typeof useRoster>['addShifts']>>;
    await act(async () => {
      result = await hook.result.addShifts(batch, { countAutoAssign: true });
    });
    expect(result).toEqual({ success: true, alreadyStored: true });
    expect(callsOf(fetchMock, 'listRoster').length - before).toBe(1);
  });
});
