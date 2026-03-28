// @ts-nocheck
/* eslint-disable import/first */

// Mock all four service dependencies so the hook never makes real HTTP calls.
jest.mock('@/services/rosterService', () => ({
  listRoster: jest.fn(),
  listWorkers: jest.fn(),
  listShiftTemplates: jest.fn(),
}));
jest.mock('@/services/demandForecast', () => ({
  loadDemandTargets: jest.fn(),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useAnalytics, shiftHours, stdDev } from '../useAnalytics';
import { listRoster, listWorkers, listShiftTemplates } from '@/services/rosterService';
import { loadDemandTargets } from '@/services/demandForecast';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockWorkers = [
  { id: 'w1', accountId: 'acc', name: 'Alice', role: 'Barista', skills: [] },
  { id: 'w2', accountId: 'acc', name: 'Bob', role: 'Barista', skills: [] },
];

const mockTemplates = [
  { id: 't1', accountId: 'acc', name: 'Morning', role: 'Barista', startTime: '07:00', endTime: '15:00', coverage: 1 },
  { id: 't2', accountId: 'acc', name: 'Evening', role: 'Barista', startTime: '15:00', endTime: '23:00', coverage: 2 },
];

const mockShifts = [
  { id: 's1', accountId: 'acc', date: '2026-04-01', workerId: 'w1', templateId: 't1', location: '', status: 'Published', notified: false },
  { id: 's2', accountId: 'acc', date: '2026-04-02', workerId: 'w1', templateId: 't1', location: '', status: 'Published', notified: false },
  { id: 's3', accountId: 'acc', date: '2026-04-03', workerId: 'w2', templateId: 't2', location: '', status: 'Published', notified: false },
  { id: 's4', accountId: 'acc', date: '2026-04-04', workerId: 'w2', templateId: 't1', location: '', status: 'Draft', notified: false },
];

const mockTargets = [
  { date: '2026-04-01', role: 'Barista', required: 2, source: 'override' },
  { date: '2026-04-02', role: 'Barista', required: 1, source: 'override' },
];

// ─── Helper: render the hook and capture returned state ───────────────────────

function renderHook(accountId = 'acc') {
  let result: ReturnType<typeof useAnalytics> | null = null;

  function HookConsumer() {
    result = useAnalytics(accountId);
    return null;
  }

  let tree: renderer.ReactTestRenderer | null = null;
  act(() => {
    tree = renderer.create(<HookConsumer />);
  });

  return {
    getResult: () => result!,
    unmount: () => act(() => { tree!.unmount(); }),
  };
}

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe('shiftHours', () => {
  it('computes hours from startTime/endTime', () => {
    expect(shiftHours({ startTime: '07:00', endTime: '15:00' } as any)).toBe(8);
    expect(shiftHours({ startTime: '09:00', endTime: '09:30' } as any)).toBeCloseTo(0.5);
  });

  it('returns 0 for overnight / equal times (guard)', () => {
    expect(shiftHours({ startTime: '22:00', endTime: '06:00' } as any)).toBe(0);
    expect(shiftHours({ startTime: '09:00', endTime: '09:00' } as any)).toBe(0);
  });
});

describe('stdDev', () => {
  it('returns 0 for empty array', () => {
    expect(stdDev([])).toBe(0);
  });

  it('returns 0 for single-element array', () => {
    expect(stdDev([5])).toBe(0);
  });

  it('returns 0 for perfectly equal values', () => {
    expect(stdDev([4, 4, 4])).toBe(0);
  });

  it('computes population std dev correctly', () => {
    // mean = 2, deviations = 1,0,1 → variance = 2/3 → std ≈ 0.816
    expect(stdDev([1, 2, 3])).toBeCloseTo(0.816, 2);
  });
});

// ─── Hook integration tests ───────────────────────────────────────────────────

describe('useAnalytics', () => {
  beforeEach(() => {
    (listRoster as jest.Mock).mockResolvedValue(mockShifts);
    (listWorkers as jest.Mock).mockResolvedValue(mockWorkers);
    (listShiftTemplates as jest.Mock).mockResolvedValue(mockTemplates);
    (loadDemandTargets as jest.Mock).mockResolvedValue(mockTargets);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts in loading state', () => {
    (listRoster as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const { getResult, unmount } = renderHook();
    expect(getResult().loading).toBe(true);
    unmount();
  });

  it('resolves worker hours for published shifts only', async () => {
    const { getResult, unmount } = renderHook();
    // Alice: 2 × Morning (8h each) = 16h
    // Bob: 1 × Evening (8h) = 8h (Draft shift excluded)
    await act(async () => { await Promise.resolve(); });

    const { workerHours } = getResult();
    const alice = workerHours.find((e) => e.workerName === 'Alice');
    const bob = workerHours.find((e) => e.workerName === 'Bob');

    expect(alice?.hours).toBe(16);
    expect(alice?.shiftsCount).toBe(2);
    expect(bob?.hours).toBe(8);
    expect(bob?.shiftsCount).toBe(1);
    unmount();
  });

  it('sorts workerHours descending', async () => {
    const { getResult, unmount } = renderHook();
    await act(async () => { await Promise.resolve(); });

    const hours = getResult().workerHours.map((e) => e.hours);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));
    unmount();
  });

  it('counts draft and published shifts correctly', async () => {
    const { getResult, unmount } = renderHook();
    await act(async () => { await Promise.resolve(); });

    expect(getResult().publishedShifts).toBe(3);
    expect(getResult().draftShifts).toBe(1);
    unmount();
  });

  it('computes coverageRate as a percentage (0–100)', async () => {
    // totalRequired = 3 (2 + 1)
    // Published coverage: s1→t1(coverage=1) + s2→t1(1) + s3→t2(2) = 4
    // rate = min(100, 4/3 * 100) = 100 (capped)
    const { getResult, unmount } = renderHook();
    await act(async () => { await Promise.resolve(); });

    expect(getResult().coverageRate).toBe(100);
    unmount();
  });

  it('returns error string on fetch failure, sets loading=false', async () => {
    (listRoster as jest.Mock).mockRejectedValue(new Error('network fail'));
    const { getResult, unmount } = renderHook();
    await act(async () => { await Promise.resolve(); });

    expect(getResult().error).toBe('network fail');
    expect(getResult().loading).toBe(false);
    unmount();
  });

  it('returns zero metrics when all data is empty', async () => {
    (listRoster as jest.Mock).mockResolvedValue([]);
    (listWorkers as jest.Mock).mockResolvedValue([]);
    (listShiftTemplates as jest.Mock).mockResolvedValue([]);
    (loadDemandTargets as jest.Mock).mockResolvedValue([]);

    const { getResult, unmount } = renderHook();
    await act(async () => { await Promise.resolve(); });

    expect(getResult().coverageRate).toBe(0);
    expect(getResult().draftShifts).toBe(0);
    expect(getResult().publishedShifts).toBe(0);
    expect(getResult().workerHours).toHaveLength(0);
    expect(getResult().fairnessScore).toBe(0);
    expect(getResult().uncoveredRevenue).toBe(0);
    unmount();
  });
});
