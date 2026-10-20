import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { evaluateCompliance, useCompliance, type ComplianceInput, type ComplianceResult, type ComplianceShift } from '../useCompliance';
import type { BusinessLocation } from '@/utils/locationValidation';
import type { Worker } from '@/types/scheduler';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';

const location = (over: Partial<BusinessLocation>): BusinessLocation => ({
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
  ...over,
});

const MADRID = location({});
const OHIO = location({
  id: '00000000-0000-0000-0000-0000000000u1',
  name: 'Columbus',
  countryCode: 'US',
  regionCode: 'OH',
  jurisdictionCode: 'US',
  timeZone: 'America/New_York',
});

const ana: Worker = { id: 'w-ana', displayId: 'W-1', name: 'Ana', role: 'Clerk', skills: [], availability: [] };
const close: ShiftTemplate = { id: 't-close', name: 'Close', role: 'Clerk', start: '15:00', end: '23:00', coverage: 1 };
const open: ShiftTemplate = { id: 't-open', name: 'Open', role: 'Clerk', start: '07:00', end: '15:00', coverage: 1 };

const shift = (id: string, date: string, template: ShiftTemplate, loc = ''): ComplianceShift => ({
  id, date, workerId: ana.id, templateId: template.id, location: loc, status: 'Draft', template, worker: ana,
});

// Week shown: Sunday 2026-11-01 to Saturday 2026-11-07. A close on Monday and
// an open on Tuesday leave 8 h of rest.
const WEEK = '2026-11-01';
const clopening = [shift('s-mon', '2026-11-02', close), shift('s-tue', '2026-11-03', open)];

const run = (over: Partial<ComplianceInput>) =>
  evaluateCompliance({ shifts: clopening, locations: [MADRID], locationsLoaded: true, weekStart: WEEK, ...over });

describe('evaluateCompliance', () => {
  it('flags 8 h between shifts as a rest violation in Spain, with its citation and markers', () => {
    const result = run({});
    expect(result.status).toBe('ready');
    const rest = result.byVerdict.violation.filter((f) => f.rule === 'rest.betweenShifts');
    expect(rest).toHaveLength(1);
    expect(rest[0].shiftIds).toEqual(['s-mon', 's-tue']);
    expect(rest[0].cite?.source).toMatch(/Estatuto de los Trabajadores/);
    expect(rest[0].workerName).toBe('Ana');
    expect(rest[0].locationName).toBe('Madrid Centro');
    expect(result.markers).toEqual({ 's-mon': 'violation', 's-tue': 'violation' });
  });

  it('does not flag the same shifts as a rest violation under US federal rules', () => {
    const result = run({ locations: [OHIO] });
    expect(result.status).toBe('ready');
    expect(result.findings.filter((f) => f.rule.startsWith('rest.'))).toEqual([]);
    expect(result.byVerdict.violation).toEqual([]);
    expect(result.markers).toEqual({});
  });

  it('uses the location the roster entry names when the account has several', () => {
    const named = [shift('s-mon', '2026-11-02', close, OHIO.id), shift('s-tue', '2026-11-03', open, 'columbus')];
    const result = run({ shifts: named, locations: [MADRID, OHIO] });
    expect(result.byVerdict.violation).toEqual([]);
    expect(result.unlinkedShiftIds).toEqual([]);
  });

  it('does not guess a location for unlinked shifts when there are several', () => {
    const result = run({ locations: [MADRID, OHIO] });
    expect(result.status).toBe('ready');
    expect(result.findings).toEqual([]);
    expect(result.unlinkedShiftIds.sort()).toEqual(['s-mon', 's-tue']);
  });

  it('asks for a location when the account has none, and waits while they load', () => {
    expect(run({ locations: [] }).status).toBe('no-location');
    expect(run({ locations: [], locationsLoaded: false }).status).toBe('loading');
  });

  it('keeps rest into the first visible day but drops findings only about other weeks', () => {
    // Saturday 31 Oct close → Sunday 1 Nov open: the second shift is visible.
    const intoWeek = run({ shifts: [shift('s-sat', '2026-10-31', close), shift('s-sun', '2026-11-01', open)] });
    expect(intoWeek.byVerdict.violation.map((f) => f.rule)).toContain('rest.betweenShifts');
    expect(intoWeek.markers).toEqual({ 's-sun': 'violation' });

    // Both shifts in the previous week: nothing to show for this week.
    const before = run({ shifts: [shift('s-thu', '2026-10-29', close), shift('s-fri', '2026-10-30', open)] });
    expect(before.findings).toEqual([]);
  });

  it('measures shifts in the location zone (elapsed time across a DST change)', () => {
    // 21:00–06:00 on the night Madrid falls back (25 Oct 2026) is 10 h of work, over Spain's 9 h.
    const night: ShiftTemplate = { id: 't-night', name: 'Night', role: 'Clerk', start: '21:00', end: '06:00', coverage: 1 };
    const result = run({ weekStart: '2026-10-18', shifts: [shift('s-night', '2026-10-24', night)] });
    const daily = result.byVerdict.violation.find((f) => f.rule === 'daily.ordinaryMax');
    expect(daily?.shiftIds).toEqual(['s-night']);
    expect(daily?.hours).toBeCloseTo(1, 5);
  });
});

describe('useCompliance', () => {
  const renderHook = async (input: ComplianceInput) => {
    const seen: ComplianceResult[] = [];
    const Probe = (props: ComplianceInput) => {
      const result = useCompliance(props);
      useEffect(() => {
        seen.push(result);
      }, [result]);
      return null;
    };
    let root: renderer.ReactTestRenderer;
    await act(async () => {
      root = renderer.create(<Probe {...input} />);
    });
    return {
      seen,
      update: async (next: ComplianceInput) => {
        await act(async () => {
          root.update(<Probe {...next} />);
        });
      },
    };
  };

  it('memoizes on its inputs and re-evaluates when the location changes', async () => {
    const shifts = clopening;
    const madrid = [MADRID];
    const hook = await renderHook({ shifts, locations: madrid, locationsLoaded: true, weekStart: WEEK });
    expect(hook.seen).toHaveLength(1);
    expect(hook.seen[0].byVerdict.violation.some((f) => f.rule === 'rest.betweenShifts')).toBe(true);

    await hook.update({ shifts, locations: madrid, locationsLoaded: true, weekStart: WEEK });
    expect(hook.seen).toHaveLength(1);

    await hook.update({ shifts, locations: [OHIO], locationsLoaded: true, weekStart: WEEK });
    expect(hook.seen).toHaveLength(2);
    expect(hook.seen[1].byVerdict.violation).toEqual([]);
  });
});
