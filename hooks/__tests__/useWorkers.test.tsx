import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useWorkers } from '../useWorkers';

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

const dbWorker = {
  id: 'w-1',
  accountId: 'acc-1',
  name: 'Alice',
  role: 'Support',
  skills: ['Chat'],
};

const dbAvailability = {
  id: 'av-1',
  accountId: 'acc-1',
  workerId: 'w-1',
  dayOfWeek: 'Mon',
  fromTime: '09:00',
  toTime: '17:00',
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe('useWorkers', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('loads workers with their availability on mount', async () => {
    mockFetch({
      listWorkers: { workers: [dbWorker] },
      listWorkerAvailability: { availabilities: [dbAvailability] },
    });

    let hookState: ReturnType<typeof useWorkers> | null = null;

    const TestComponent = () => {
      const hook = useWorkers('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.loading).toBe(false);
    expect(hookState!.workers).toHaveLength(1);
    expect(hookState!.workers[0]).toMatchObject({
      id: 'w-1',
      name: 'Alice',
      role: 'Support',
      skills: ['Chat'],
    });
    expect(hookState!.workers[0].availability).toEqual([
      { day: 'Mon', from: '09:00', to: '17:00' },
    ]);
  });

  it('returns empty workers and no error on fetch failure', async () => {
    mockFetchReject('Network error');

    let hookState: ReturnType<typeof useWorkers> | null = null;

    const TestComponent = () => {
      const hook = useWorkers('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.workers).toEqual([]);
    expect(hookState!.loading).toBe(false);
  });

  it('addAvailability persists and updates local worker state', async () => {
    const newAv = { ...dbAvailability, id: 'av-new', dayOfWeek: 'Tue', fromTime: '10:00', toTime: '18:00' };
    mockFetch({
      listWorkers: { workers: [dbWorker] },
      listWorkerAvailability: { availabilities: [] },
      upsertAvailability: { success: true, availability: newAv },
    });

    let hookState: ReturnType<typeof useWorkers> | null = null;

    const TestComponent = () => {
      const hook = useWorkers('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });
    expect(hookState!.workers[0].availability).toEqual([]);

    await act(async () => {
      await hookState!.addAvailability('w-1', 'Tue', '10:00', '18:00');
    });

    expect(hookState!.workers[0].availability).toEqual([
      { day: 'Tue', from: '10:00', to: '18:00' },
    ]);
  });

  it('addAvailability returns failure result when proxy rejects', async () => {
    mockFetch({
      listWorkers: { workers: [dbWorker] },
      listWorkerAvailability: { availabilities: [] },
      upsertAvailability: { success: false, error: 'Overlap detected' },
    });

    // Override: upsertAvailability returns non-ok
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockImplementation((_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string) as { action: string };
        if (body.action === 'upsertAvailability') {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: jest.fn().mockResolvedValue({ error: 'Overlap detected' }),
          });
        }
        const map: Record<string, unknown> = {
          listWorkers: { workers: [dbWorker] },
          listWorkerAvailability: { availabilities: [] },
        };
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue(map[body.action] ?? {}),
        });
      });

    let hookState: ReturnType<typeof useWorkers> | null = null;

    const TestComponent = () => {
      const hook = useWorkers('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    let result: Awaited<ReturnType<typeof hookState.addAvailability>> | null = null;
    await act(async () => {
      result = await hookState!.addAvailability('w-1', 'Tue', '10:00', '18:00');
    });

    expect(result!.success).toBe(false);
    expect(hookState!.workers[0].availability).toEqual([]);
  });
});
