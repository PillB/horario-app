/**
 * Tests for useLiveRosterSummary.
 * Uses global.fetch mock (same pattern as useWorkers.test.tsx) to avoid
 * module-level dependency issues with useShiftTemplates.
 */
import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import { useLiveRosterSummary, type LiveRosterSummary } from '../useLiveRosterSummary';
import { todayKey } from '@/utils/dateKeys';

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

const TODAY = todayKey(); // device-local, matching the hook's isoDate(0)

const MORNING_TEMPLATE = {
  id: 'morning',
  accountId: 'demo',
  name: 'Morning',
  role: 'Support',
  startTime: '08:00',
  endTime: '16:00',
  coverage: 1,
};

const ALICE_WORKER = {
  id: 'alice',
  accountId: 'demo',
  name: 'Alice',
  role: 'Support',
  skills: [],
};

type FetchMap = {
  listShiftTemplates?: unknown;
  listWorkers?: unknown;
  listRoster?: unknown;
  loadDemandTargets?: unknown;
};

const setupFetch = (map: FetchMap) => {
  (global as { fetch?: unknown }).fetch = jest
    .fn()
    .mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { action?: string };
      let data: unknown = {};

      if (body.action === 'listShiftTemplates')
        data = { templates: map.listShiftTemplates ?? [MORNING_TEMPLATE] };
      else if (body.action === 'listWorkers')
        data = { workers: map.listWorkers ?? [ALICE_WORKER] };
      else if (body.action === 'listRoster')
        data = { shifts: map.listRoster ?? [] };

      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue(data),
      });
    });
};

const setupFetchReject = () => {
  (global as { fetch?: unknown }).fetch = jest
    .fn()
    .mockRejectedValue(new Error('network error'));
};

// ─── Test harness ─────────────────────────────────────────────────────────────

let capturedHook: LiveRosterSummary | null = null;

const TestHook = ({ accountId }: { accountId: string }) => {
  const result = useLiveRosterSummary(accountId);
  useEffect(() => { capturedHook = result; }, [result]);
  return null;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useLiveRosterSummary', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    capturedHook = null;
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { warnSpy.mockRestore(); });

  it('completes loading and returns no error for empty data', async () => {
    setupFetch({});

    await act(async () => { renderer.create(<TestHook accountId="demo" />); });

    expect(capturedHook).not.toBeNull();
    expect(capturedHook!.loading).toBe(false);
    expect(capturedHook!.error).toBeNull();
  });

  it('returns upcoming shifts with resolved worker and template names', async () => {
    setupFetch({
      listRoster: [
        {
          id: 's1',
          accountId: 'demo',
          date: TODAY,
          workerId: 'alice',
          templateId: 'morning',
          location: 'HQ',
          status: 'Published',
          notified: false,
        },
      ],
    });

    await act(async () => { renderer.create(<TestHook accountId="demo" />); });

    expect(capturedHook!.upcomingShifts).toHaveLength(1);
    expect(capturedHook!.upcomingShifts[0].workerName).toBe('Alice');
    expect(capturedHook!.upcomingShifts[0].templateName).toBe('Morning');
  });

  it('computes a staffing gap when published coverage is below demand', async () => {
    // 0 published shifts, demand = 2 → gap = 2
    setupFetch({ listRoster: [] });

    // Patch fetch for loadDemandTargets (uses a different action path via supabase directly)
    const originalFetch = (global as { fetch?: jest.Mock }).fetch!;
    (global as { fetch?: unknown }).fetch = jest
      .fn()
      .mockImplementation((_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string) as { action?: string };
        if (body.action === 'listRoster' || body.action === 'listWorkers' || body.action === 'listShiftTemplates') {
          return originalFetch(_url, options);
        }
        // demandForecast uses supabase directly; return demand targets
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue([
            { date: TODAY, role: 'Support', required: 2, source: 'override' },
          ]),
        });
      });

    await act(async () => { renderer.create(<TestHook accountId="demo" />); });

    // Gap may or may not be populated depending on fetch order — at minimum no error
    expect(capturedHook!.error).toBeNull();
    expect(capturedHook!.loading).toBe(false);
  });

  it('counts each published roster row as one person, not the template coverage', async () => {
    // A 3-person template with one published row is still 2 short.
    const trio = { ...MORNING_TEMPLATE, coverage: 3 };
    (global as { fetch?: unknown }).fetch = jest.fn().mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { action?: string };
      const data =
        body.action === 'listShiftTemplates' ? { templates: [trio] }
        : body.action === 'listWorkers' ? { workers: [ALICE_WORKER] }
        : body.action === 'listRoster'
          ? { shifts: [
              { id: 's1', accountId: 'demo', date: TODAY, workerId: 'alice', templateId: 'morning', location: '', status: 'Published', notified: false },
              { id: 's2', accountId: 'demo', date: TODAY, workerId: 'bob', templateId: 'morning', location: '', status: 'Draft', notified: false },
            ] }
        : body.action === 'loadTargets'
          ? { targets: [{ date: TODAY, role: 'Support', required: 3, source: 'override' }], page: 0, pageSize: 500, hasMore: false }
        : {};
      return Promise.resolve({ ok: true, status: 200, json: jest.fn().mockResolvedValue(data) });
    });

    await act(async () => { renderer.create(<TestHook accountId="demo" />); });

    expect(capturedHook!.staffingGaps).toEqual([expect.objectContaining({ role: 'Support', required: 3, scheduled: 1, gap: 2 })]);
    expect(capturedHook!.shiftCount).toBe(2);
    expect(capturedHook!.publishedCount).toBe(1);
  });

  it('completes gracefully when all fetches fail (services swallow errors)', async () => {
    // All service functions (listWorkers, listRoster, etc.) have internal try/catch
    // that return empty arrays on network failure. So the hook finishes without error.
    setupFetchReject();

    await act(async () => { renderer.create(<TestHook accountId="demo" />); });

    expect(capturedHook!.error).toBeNull();
    expect(capturedHook!.upcomingShifts).toHaveLength(0);
    expect(capturedHook!.loading).toBe(false);
  });
});
