/**
 * Optimistic writes that finish out of order or across a tenant switch
 * (CHG-091, QA step 3c G2 / G3), and the roster's `notified` rule on the
 * client (G4). The fake server below keeps state, so a reload shows what the
 * server holds.
 */
import { act } from 'react-test-renderer';

import { useRoster } from '../useRoster';
import { useWorkers } from '../useWorkers';
import { callsOf, deferred, flush, installFakeProxy, renderHook, type Deferred, type ProxyBody, type ProxyReply } from '../testUtils/fakeProxy';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444444';
const SB = '66666666-6666-4666-8666-666666666666';

type Row = { id: string; date: string; workerId: string; templateId: string; location: string; status: 'Draft' | 'Published'; notified: boolean };

const row = (id: string, changes: Partial<Row> = {}): Row => ({
  id, date: '2026-11-02', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: false, ...changes,
});

type Hook = ReturnType<typeof useRoster>;
const useRosterProps = ({ accountId }: { accountId: string }): Hook => useRoster(accountId);

describe('optimistic writes that finish out of order (G2)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  /** Server with one shift; each upsert waits on the next deferred in `replies`. */
  const server = () => {
    const stored = new Map<string, Row>([[S1, row(S1)]]);
    const replies: Deferred<'ok' | 'fail'>[] = [];
    const fetchMock = installFakeProxy(async (body: ProxyBody) => {
      if (body.action === 'listRoster') return { body: { shifts: [...stored.values()].map((r) => ({ accountId: 'acc-1', ...r })), hasMore: false } };
      if (body.action === 'upsertRosterShift') {
        const reply = deferred<'ok' | 'fail'>();
        replies.push(reply);
        const outcome = await reply.promise;
        if (outcome === 'fail') return { status: 409, body: { error: 'Conflicting record' } };
        const shift = body.shift as Row;
        stored.set(shift.id, { ...shift });
        return { body: { success: true, shift: { accountId: 'acc-1', ...shift } } };
      }
      return { body: { success: true } };
    });
    return { stored, replies, fetchMock };
  };

  it('keeps edit 2 when edit 1 fails after edit 2 succeeded, and reloads', async () => {
    const { replies, fetchMock } = server();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let edit1!: Promise<unknown>;
    let edit2!: Promise<unknown>;
    act(() => {
      edit1 = hook.result.updateShift(S1, { location: 'Bar' });
    });
    await flush();
    expect(hook.result.roster[0].location).toBe('Bar');
    act(() => {
      edit2 = hook.result.updateShift(S1, { location: 'Patio' });
    });
    await flush();
    expect(replies).toHaveLength(2);

    await act(async () => {
      replies[1].resolve('ok');
      await edit2;
    });
    expect(hook.result.roster[0].location).toBe('Patio');

    await act(async () => {
      replies[0].resolve('fail');
      await edit1;
    });
    await flush();
    // Before CHG-091 the rollback restored the snapshot taken before edit 1 (HQ).
    expect(hook.result.roster[0].location).toBe('Patio');
    // The server holds edit 2; the list was reloaded to make sure.
    expect(callsOf(fetchMock, 'listRoster')).toHaveLength(2);
  });

  it('shows what the server holds when edit 1 succeeds after edit 2', async () => {
    const { replies, stored } = server();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let edit1!: Promise<unknown>;
    let edit2!: Promise<unknown>;
    act(() => {
      edit1 = hook.result.updateShift(S1, { location: 'Bar' });
    });
    await flush();
    act(() => {
      edit2 = hook.result.updateShift(S1, { location: 'Patio' });
    });
    await flush();
    await act(async () => {
      replies[1].resolve('ok');
      await edit2;
    });
    await act(async () => {
      replies[0].resolve('ok');
      await edit1;
    });
    await flush();
    // The server saved edit 1 last; the screen agrees with it, not with the order the edits were made in.
    expect(stored.get(S1)?.location).toBe('Bar');
    expect(hook.result.roster[0].location).toBe('Bar');
  });

  it('still rolls back a single failed edit', async () => {
    const { replies } = server();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let edit!: Promise<unknown>;
    act(() => {
      edit = hook.result.updateShift(S1, { location: 'Bar' });
    });
    await flush();
    await act(async () => {
      replies[0].resolve('fail');
      await edit;
    });
    expect(hook.result.roster[0].location).toBe('HQ');
  });
});

describe('a write in flight while the tenant changes (G3)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("never adds tenant A's saved shift to tenant B's list", async () => {
    const save = deferred<ProxyReply>();
    let tenant = 'acc-a';
    installFakeProxy((body) => {
      if (body.action === 'listRoster') {
        return { body: { shifts: tenant === 'acc-a' ? [] : [{ accountId: 'org-b', ...row(SB) }], hasMore: false } };
      }
      if (body.action === 'upsertRosterShift') return save.promise;
      return { body: { success: true } };
    });
    const hook = await renderHook(useRosterProps, { accountId: 'acc-a' });
    let pending!: Promise<{ success: boolean }>;
    act(() => {
      pending = hook.result.addShift({ date: '2026-11-09', workerId: W1, templateId: T1, location: 'HQ', status: 'Draft', notified: false });
    });
    await flush();
    expect(hook.result.roster).toHaveLength(1);

    tenant = 'org-b';
    await hook.rerender({ accountId: 'org-b' });
    expect(hook.result.roster.map((s) => s.id)).toEqual([SB]);

    await act(async () => {
      save.resolve({ body: { success: true, shift: { accountId: 'acc-a', ...row('77777777-7777-4777-8777-777777777777', { date: '2026-11-09' }) } } });
      await pending;
    });
    await flush();
    expect(hook.result.roster.map((s) => s.id)).toEqual([SB]);
  });

  it("does not roll back into tenant B's list after A's write fails", async () => {
    const save = deferred<ProxyReply>();
    let tenant = 'acc-a';
    const fetchMock = installFakeProxy((body) => {
      if (body.action === 'listWorkers') {
        return { body: { workers: tenant === 'acc-a' ? [{ id: W1, accountId: 'acc-a', name: 'Ana', role: 'Cook', skills: [] }] : [], hasMore: false } };
      }
      if (body.action === 'listWorkerAvailability') return { body: { availabilities: [], hasMore: false } };
      if (body.action === 'deleteWorker') return save.promise;
      return { body: { success: true } };
    });
    const hook = await renderHook(useWorkers, 'acc-a');
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.removeWorker(W1);
    });
    await flush();
    expect(hook.result.workers).toEqual([]);
    tenant = 'org-b';
    await hook.rerender('org-b');
    await act(async () => {
      save.resolve({ status: 500, body: { error: 'Database request failed' } });
      await pending;
    });
    await flush();
    // Before CHG-091 the rollback put A's worker into B's (empty) list.
    expect(hook.result.workers).toEqual([]);
    expect(callsOf(fetchMock, 'listWorkers')).toHaveLength(2);
  });
});

describe('useRoster.updateShift and notified (G4)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  const setup = () => {
    const fetchMock = installFakeProxy((body) => {
      if (body.action === 'listRoster') return { body: { shifts: [{ accountId: 'acc-1', ...row(S1, { status: 'Published', notified: true }) }], hasMore: false } };
      if (body.action === 'upsertRosterShift') {
        // Never answers, so the test sees the optimistic row and the payload sent.
        return new Promise<ProxyReply>(() => {});
      }
      return { body: { success: true } };
    });
    return fetchMock;
  };

  it.each([
    ['worker', { workerId: W2 }],
    ['date', { date: '2026-11-03' }],
    ['template', { templateId: '88888888-8888-4888-8888-888888888888' }],
  ])('clears notified when the %s changes', async (_label, changes) => {
    const fetchMock = setup();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    act(() => {
      void hook.result.updateShift(S1, changes);
    });
    await flush();
    expect(hook.result.roster[0].notified).toBe(false);
    expect((callsOf(fetchMock, 'upsertRosterShift')[0].shift as Row).notified).toBe(false);
  });

  it('keeps notified for a change of location only, and ignores a notified sent by the caller', async () => {
    const fetchMock = setup();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    act(() => {
      void hook.result.updateShift(S1, { location: 'Bar' });
    });
    await flush();
    expect(hook.result.roster[0]).toMatchObject({ location: 'Bar', notified: true });

    act(() => {
      void hook.result.updateShift(S1, { workerId: W2, notified: true });
    });
    await flush();
    expect(hook.result.roster[0]).toMatchObject({ workerId: W2, notified: false });
    expect((callsOf(fetchMock, 'upsertRosterShift')[1].shift as Row).notified).toBe(false);
  });

  it('accepts moving a notified shift back to draft (the change clears notified)', async () => {
    const fetchMock = setup();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    let result: { success: boolean } | undefined;
    act(() => {
      void hook.result.updateShift(S1, { status: 'Draft' }).then((r) => {
        result = r;
      });
    });
    await flush();
    expect(result).toBeUndefined(); // sent, not refused by validation
    expect(callsOf(fetchMock, 'upsertRosterShift')).toHaveLength(1);
    expect(hook.result.roster[0]).toMatchObject({ status: 'Draft', notified: false });
  });

  it('saves a new shift as not notified, whatever the caller sends', async () => {
    const fetchMock = setup();
    const hook = await renderHook(useRosterProps, { accountId: 'acc-1' });
    act(() => {
      void hook.result.addShift({ date: '2026-11-09', workerId: W1, templateId: T1, location: 'HQ', status: 'Published', notified: true });
    });
    await flush();
    expect((callsOf(fetchMock, 'upsertRosterShift')[0].shift as Row).notified).toBe(false);
    expect(hook.result.roster[1].notified).toBe(false);
  });
});

describe("a member's refused write (G1)", () => {
  const MEMBER_ERROR = 'Only an admin of this business can change the schedule. Ask an admin to make this change';
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("rolls back and returns the server's 403 message for the banner", async () => {
    installFakeProxy((body) => {
      if (body.action === 'listRoster') return { body: { shifts: [{ accountId: 'org-1', ...row(S1) }], hasMore: false } };
      return { status: 403, body: { error: MEMBER_ERROR } };
    });
    const hook = await renderHook(useRosterProps, { accountId: 'org-1' });
    let result!: { success: boolean; error?: string };
    await act(async () => {
      result = await hook.result.setShiftStatus(S1, 'Published');
    });
    expect(result).toEqual({ success: false, error: MEMBER_ERROR });
    expect(hook.result.roster[0].status).toBe('Draft');
  });
});
