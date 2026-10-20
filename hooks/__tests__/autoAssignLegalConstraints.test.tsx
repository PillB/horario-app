/**
 * Auto-assign merges the location's legal limits with the business's own
 * (stricter wins) and places shifts in the location's IANA zone.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useDemandAwareSchedule } from '../useDemandAwareSchedule';
import { useAutoAssign } from '../useAutoAssign';
import { legalConstraintsFor } from '@/services/labor/assignerConstraints';
import * as assigner from '@/services/shiftAssigner';
import { upsertRosterShift } from '@/services/rosterService';
import { autoAssignSettings, isoWeekStart } from '@/utils/autoAssignSettings';
import { getBusinessTimeZone, getDeviceTimeZone } from '@/utils/businessTimeZone';
import type { BusinessLocation } from '@/utils/locationValidation';
import type { Worker } from '@/types/scheduler';
import type { Shift, ShiftTemplate } from '@/utils/schedulerMetrics';

jest.mock('@/services/rosterService', () => ({ upsertRosterShift: jest.fn() }));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('@/services/logger', () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const MADRID: BusinessLocation = {
  id: '00000000-0000-0000-0000-0000000000e1',
  name: 'Madrid Centro',
  countryCode: 'ES',
  regionCode: null,
  cityCode: null,
  jurisdictionCode: 'ES',
  timeZone: 'Europe/Madrid',
  industry: 'retail',
  employerHeadcount: null,
  locationsCount: null,
  detectedHint: null,
  overrides: [],
  confirmedBy: 'user_a',
  confirmedAt: '2026-10-20T00:00:00Z',
};

const MON = '2026-11-02';
const TUE = '2026-11-03';

const close: ShiftTemplate = { id: 't-close', name: 'Close', role: 'Clerk', start: '15:00', end: '23:00', coverage: 1 };
const open: ShiftTemplate = { id: 't-open', name: 'Open', role: 'Clerk', start: '07:00', end: '15:00', coverage: 1 };
const ana: Worker = {
  id: 'w-ana',
  displayId: 'W-1',
  name: 'Ana',
  role: 'Clerk',
  skills: [],
  // Tuesday ends at 15:00, so only Tuesday's open fits her availability.
  availability: [
    { day: 'Mon', from: '00:00', to: '23:59' },
    { day: 'Tue', from: '05:00', to: '15:00' },
  ],
};
// Ana closed on Monday; Tuesday's open would leave her 8 h of rest.
const roster: Shift[] = [{ id: 'r1', date: MON, workerId: ana.id, templateId: close.id, location: MADRID.id, status: 'Draft' }];

describe('autoAssignSettings', () => {
  it('applies Spain’s legal limits when the business has none', () => {
    const { constraints, timeZone } = autoAssignSettings(TUE, MADRID);
    expect(constraints?.minRestHoursBetweenShifts).toBe(12);
    expect(constraints?.maxDailyHours).toBe(9);
    expect(timeZone).toBe('Europe/Madrid');
  });

  it('keeps the stricter of the business setting and the law, per field', () => {
    const legal = legalConstraintsFor('ES', isoWeekStart(TUE));
    const { constraints } = autoAssignSettings(TUE, MADRID, { minRestHoursBetweenShifts: 14, maxDailyHours: 12, maxWeeklyHours: 30 });
    expect(constraints).toEqual({
      minRestHoursBetweenShifts: 14, // business is stricter (longer rest)
      maxDailyHours: 9, // law is stricter
      maxWeeklyHours: Math.min(30, legal.maxWeeklyHours ?? Infinity),
    });
  });

  it('uses only the business settings and the device zone without a location', () => {
    const business = { maxDailyHours: 10 };
    expect(autoAssignSettings(TUE, null, business)).toEqual({ constraints: business, timeZone: getDeviceTimeZone() });
    expect(autoAssignSettings(TUE, undefined).constraints).toBeUndefined();
  });

  it('reads the legal limits for the Monday of the assign date’s week', () => {
    expect(isoWeekStart('2026-11-08')).toBe(MON); // Sunday
    expect(isoWeekStart(MON)).toBe(MON);
    expect(isoWeekStart(TUE)).toBe(MON);
  });
});

describe('getBusinessTimeZone', () => {
  it('prefers a valid location zone and falls back to the device zone', () => {
    expect(getBusinessTimeZone(MADRID)).toBe('Europe/Madrid');
    expect(getBusinessTimeZone({ timeZone: 'Pacific/Nowhere' })).toBe(getDeviceTimeZone());
    expect(getBusinessTimeZone(null)).toBe(getDeviceTimeZone());
    expect(getBusinessTimeZone()).toBe(getDeviceTimeZone());
  });
});

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

describe('useDemandAwareSchedule auto-assign', () => {
  it('without a location assigns the short-rest open; with a Spanish location it does not', async () => {
    const hook = renderHook(() => useDemandAwareSchedule([]));

    // Both templates are passed so Monday's close in the roster can be resolved.
    const unlocated = await hook.current.demandAwareAutoAssign(TUE, [open, close], [ana], roster, []);
    expect(unlocated.assignmentResult.assignments.map((a) => a.templateId)).toContain(open.id);

    const located = await hook.current.demandAwareAutoAssign(TUE, [open, close], [ana], roster, [], undefined, MADRID);
    expect(located.assignmentResult.assignments.map((a) => a.templateId)).not.toContain(open.id);
    expect(located.assignmentResult.unassigned.find((u) => u.templateId === open.id)?.reasonCode).toBe('min_rest');
  });
});

describe('useAutoAssign', () => {
  beforeEach(() => {
    (upsertRosterShift as jest.Mock).mockImplementation(async (shift) => ({ success: true, shift }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes the merged constraints and the location zone to the assigner, and saves the location id', async () => {
    const spy = jest.spyOn(assigner, 'assignShifts');
    const hook = renderHook(() => useAutoAssign('acc-1'));

    let result: Awaited<ReturnType<typeof hook.current.autoAssign>> | undefined;
    await act(async () => {
      result = await hook.current.autoAssign(MON, [close], [ana], [], { maxDailyHours: 12, minRestHoursBetweenShifts: 8 }, undefined, MADRID);
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeZone: 'Europe/Madrid',
        constraints: expect.objectContaining({ maxDailyHours: 9, minRestHoursBetweenShifts: 12 }),
      }),
    );
    expect(result?.persisted).toHaveLength(1);
    expect(upsertRosterShift).toHaveBeenCalledWith(expect.objectContaining({ location: MADRID.id }));
  });

  it('refuses the short-rest open under Spanish rules', async () => {
    const hook = renderHook(() => useAutoAssign('acc-1'));
    let result: Awaited<ReturnType<typeof hook.current.autoAssign>> | undefined;
    await act(async () => {
      result = await hook.current.autoAssign(TUE, [open, close], [ana], roster, undefined, undefined, MADRID);
    });
    expect(result?.persisted.map((s) => s.templateId)).not.toContain(open.id);
    expect(result?.coverageGaps.find((g) => g.templateId === open.id)?.reasonCode).toBe('min_rest');
  });
});
