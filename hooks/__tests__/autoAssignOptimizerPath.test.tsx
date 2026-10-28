/**
 * useAutoAssign and useDemandAwareSchedule go through the optimizer client (CHG-085):
 * the schedule they persist or return is the client's, not a direct greedy call.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useAutoAssign } from '../useAutoAssign';
import { useDemandAwareSchedule } from '../useDemandAwareSchedule';
import { runAutoAssign } from '@/services/optimizer/autoAssignClient';
import * as assigner from '@/services/shiftAssigner';
import { upsertRosterShift } from '@/services/rosterService';
import type { OptimizedAssignmentResult } from '@/services/optimizer/shiftOptimizer';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';

jest.mock('@/services/optimizer/autoAssignClient', () => ({ runAutoAssign: jest.fn() }));
jest.mock('@/services/rosterService', () => ({ upsertRosterShift: jest.fn() }));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('@/services/logger', () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const MON = '2026-03-23';
const morning: ShiftTemplate = { id: 'morning', name: 'Morning', role: 'Cook', start: '09:00', end: '17:00', coverage: 1 };
const late: ShiftTemplate = { id: 'late', name: 'Late', role: 'Cook', start: '12:00', end: '20:00', coverage: 1 };
const staff = (id: string): Worker => ({ id, displayId: id, name: id, role: 'Cook', skills: [], availability: [] });

const ilpResult: OptimizedAssignmentResult = {
  assignments: [
    { date: MON, templateId: 'morning', workerId: 'w2' },
    { date: MON, templateId: 'late', workerId: 'w1' },
  ],
  unassigned: [],
  solver: { engine: 'ilp', stages: [], optimal: true, solveMs: 5, variables: 3, constraints: 2, dropped: 0 },
};

const renderHook = <T,>(useHook: () => T): { current: T } => {
  const ref = { current: null as unknown as T };
  const Probe = (): null => {
    ref.current = useHook();
    return null;
  };
  act(() => {
    renderer.create(React.createElement(Probe));
  });
  return ref;
};

beforeEach(() => {
  (runAutoAssign as jest.Mock).mockResolvedValue(ilpResult);
  (upsertRosterShift as jest.Mock).mockImplementation(async (shift) => ({ success: true, shift }));
});
afterEach(() => jest.restoreAllMocks());

it('useAutoAssign persists the optimizer client result', async () => {
  const greedy = jest.spyOn(assigner, 'assignShifts');
  const hook = renderHook(() => useAutoAssign('acc-1'));
  let result: Awaited<ReturnType<typeof hook.current.autoAssign>> | undefined;
  await act(async () => {
    result = await hook.current.autoAssign(MON, [morning, late], [staff('w1'), staff('w2')], [], { maxDailyHours: 10 });
  });
  expect(runAutoAssign).toHaveBeenCalledWith(
    expect.objectContaining({ date: MON, templates: [morning, late], constraints: { maxDailyHours: 10 } }),
  );
  expect(greedy).not.toHaveBeenCalled();
  expect(result?.persisted.map((s) => `${s.templateId}:${s.workerId}`)).toEqual(
    expect.arrayContaining(['morning:w2', 'late:w1']),
  );
  expect(result?.coverageGaps).toEqual([]);
});

it('useAutoAssign surfaces a client failure as an error', async () => {
  (runAutoAssign as jest.Mock).mockRejectedValue(new RangeError('Invalid time zone'));
  const hook = renderHook(() => useAutoAssign('acc-1'));
  await act(async () => {
    await hook.current.autoAssign(MON, [morning], [staff('w1')], []);
  });
  expect(hook.current.error).toBe('Invalid time zone');
});

it('useDemandAwareSchedule returns the optimizer client result', async () => {
  const hook = renderHook(() => useDemandAwareSchedule([]));
  const out = await hook.current.demandAwareAutoAssign(MON, [morning, late], [staff('w1'), staff('w2')], [], []);
  expect(out.assignmentResult.assignments).toEqual(ilpResult.assignments);
  expect(out.staffingMatrix.find((row) => row.role === 'Cook')?.assigned).toBe(2);
});
