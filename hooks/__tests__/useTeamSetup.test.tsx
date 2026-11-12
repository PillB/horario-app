/**
 * Team import (CHG-100): one request for the whole file, nothing saved when a
 * row is bad, and the same text imported again carries the same ids.
 */
import { act } from 'react-test-renderer';

import { useTeamSetup } from '../useTeamSetup';
import { callsOf, installFakeProxy, renderHook, type ProxyBody } from '../testUtils/fakeProxy';

type Hook = ReturnType<typeof useTeamSetup>;
const useProps = ({ accountId }: { accountId: string }): Hook => useTeamSetup(accountId);
const CSV = 'name,role,skills\nAna,Cook,grill|prep\nBea,Server,';

describe('useTeamSetup.bulkImportWorkers', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  const server = (reply: (body: ProxyBody) => { status?: number; body: unknown }) =>
    installFakeProxy(async (body: ProxyBody) => {
      if (body.action === 'importWorkers') return reply(body);
      if (body.action === 'listWorkers') return { body: { workers: [], hasMore: false } };
      if (body.action === 'listWorkerAvailability') return { body: { availabilities: [], hasMore: false } };
      return { body: { success: true } };
    });

  it('sends the whole file as one request', async () => {
    const fetchMock = server((body) => ({ body: { success: true, added: (body.workers as unknown[]).length, workers: [] } }));
    const hook = await renderHook(useProps, { accountId: 'acc-1' });
    let result: Awaited<ReturnType<Hook['bulkImportWorkers']>> | undefined;
    await act(async () => {
      result = await hook.result.bulkImportWorkers(CSV);
    });
    expect(result).toEqual({ imported: 2, errors: [] });
    const calls = callsOf(fetchMock, 'importWorkers');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workers).toEqual([
      { id: expect.any(String), name: 'Ana', role: 'Cook', skills: ['grill', 'prep'] },
      { id: expect.any(String), name: 'Bea', role: 'Server', skills: [] },
    ]);
    expect(callsOf(fetchMock, 'upsertWorker')).toHaveLength(0);
  });

  it('saves nothing when a row is bad', async () => {
    const fetchMock = server(() => ({ body: { success: true, added: 0, workers: [] } }));
    const hook = await renderHook(useProps, { accountId: 'acc-1' });
    let result: Awaited<ReturnType<Hook['bulkImportWorkers']>> | undefined;
    await act(async () => {
      result = await hook.result.bulkImportWorkers('Ana,Cook\n,Cook\nBea,');
    });
    expect(result?.imported).toBe(0);
    expect(result?.errors).toHaveLength(2);
    expect(callsOf(fetchMock, 'importWorkers')).toHaveLength(0);
  });

  it('uses the same ids when the same text is imported again after a failure', async () => {
    let attempt = 0;
    const fetchMock = server(() => {
      attempt += 1;
      return attempt === 1 ? { status: 500, body: { error: 'Request failed' } } : { body: { success: true, added: 2, workers: [] } };
    });
    const hook = await renderHook(useProps, { accountId: 'acc-1' });
    let first: Awaited<ReturnType<Hook['bulkImportWorkers']>> | undefined;
    await act(async () => {
      first = await hook.result.bulkImportWorkers(CSV);
    });
    expect(first).toEqual({ imported: 0, errors: ['Request failed'] });
    await act(async () => {
      await hook.result.bulkImportWorkers(CSV);
    });
    const [a, b] = callsOf(fetchMock, 'importWorkers').map((c) => (c.workers as { id: string }[]).map((w) => w.id));
    expect(b).toEqual(a);
  });
});
