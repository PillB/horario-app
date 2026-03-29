import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useRoster } from '../useRoster';

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockFetch = (responseMap: Record<string, unknown>) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { action: string };
      const data = responseMap[body.action];
      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue(data ?? {}),
      });
    });
};

const mockFetchReject = (message: string) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockRejectedValue(new Error(message));
};

const dbShift = {
  id: 'shift-1',
  accountId: 'acc-1',
  date: '2026-04-01',
  workerId: 'w-1',
  templateId: 'tmpl-1',
  location: 'HQ',
  status: 'Draft',
  notified: false,
};

const schedulerShift = {
  id: 'shift-1',
  date: '2026-04-01',
  workerId: 'w-1',
  templateId: 'tmpl-1',
  location: 'HQ',
  status: 'Draft',
  notified: false,
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe('useRoster', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('loads roster shifts on mount', async () => {
    mockFetch({ listRoster: { shifts: [dbShift] } });

    let hookState: ReturnType<typeof useRoster> | null = null;

    const TestComponent = () => {
      const hook = useRoster('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.loading).toBe(false);
    expect(hookState!.roster).toHaveLength(1);
    expect(hookState!.roster[0]).toEqual(schedulerShift);
  });

  it('returns empty roster on network failure', async () => {
    mockFetchReject('Network error');

    let hookState: ReturnType<typeof useRoster> | null = null;

    const TestComponent = () => {
      const hook = useRoster('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.roster).toEqual([]);
    expect(hookState!.loading).toBe(false);
  });

  it('addShift persists and appends to local roster', async () => {
    mockFetch({
      listRoster: { shifts: [] },
      upsertRosterShift: { success: true, shift: dbShift },
    });

    let hookState: ReturnType<typeof useRoster> | null = null;

    const TestComponent = () => {
      const hook = useRoster('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });
    expect(hookState!.roster).toEqual([]);

    await act(async () => {
      await hookState!.addShift({
        date: '2026-04-01',
        workerId: 'w-1',
        templateId: 'tmpl-1',
        location: 'HQ',
        status: 'Draft',
        notified: false,
      });
    });

    expect(hookState!.roster).toHaveLength(1);
    // ID is locally generated (optimistic update), not the mock DB response ID
    expect(hookState!.roster[0].id).toBeTruthy();
  });

  it('setShiftStatus updates status and resets notified locally', async () => {
    mockFetch({
      listRoster: { shifts: [{ ...dbShift, notified: true }] },
      updateShiftStatus: { success: true },
    });

    let hookState: ReturnType<typeof useRoster> | null = null;

    const TestComponent = () => {
      const hook = useRoster('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });
    expect(hookState!.roster[0].status).toBe('Draft');

    await act(async () => {
      await hookState!.setShiftStatus('shift-1', 'Published');
    });

    expect(hookState!.roster[0].status).toBe('Published');
    expect(hookState!.roster[0].notified).toBe(false);
  });

  it('notifyShift sets notified to true locally', async () => {
    mockFetch({
      listRoster: { shifts: [{ ...dbShift, status: 'Published' }] },
      markShiftNotified: { success: true },
    });

    let hookState: ReturnType<typeof useRoster> | null = null;

    const TestComponent = () => {
      const hook = useRoster('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });
    expect(hookState!.roster[0].notified).toBe(false);

    await act(async () => { await hookState!.notifyShift('shift-1'); });

    expect(hookState!.roster[0].notified).toBe(true);
  });

  it('removeShift removes the shift from local roster', async () => {
    mockFetch({
      listRoster: { shifts: [dbShift] },
      deleteRosterShift: { success: true },
    });

    let hookState: ReturnType<typeof useRoster> | null = null;

    const TestComponent = () => {
      const hook = useRoster('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });
    expect(hookState!.roster).toHaveLength(1);

    await act(async () => { await hookState!.removeShift('shift-1'); });

    expect(hookState!.roster).toHaveLength(0);
  });

  it('sends date filters to listRoster when provided', async () => {
    mockFetch({ listRoster: { shifts: [] } });

    const TestComponent = () => {
      useRoster('acc-1', { fromDate: '2026-04-01', toDate: '2026-04-07' });
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          action: 'listRoster',
          accountId: 'acc-1',
          fromDate: '2026-04-01',
          toDate: '2026-04-07',
        }),
      })
    );
  });
});
