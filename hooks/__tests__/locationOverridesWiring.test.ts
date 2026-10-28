/**
 * CHG-089: a location's stored overrides reach the compliance view and the
 * auto-assign constraints.
 */
import { evaluateCompliance, type ComplianceShift } from '../useCompliance';
import type { Worker } from '@/types/scheduler';
import { autoAssignSettings } from '@/utils/autoAssignSettings';
import type { BusinessLocation } from '@/utils/locationValidation';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';

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
const STRICT_REST = { ...MADRID, overrides: [{ rule: 'rest.minHours', value: 13 }] };

const ana: Worker = { id: 'w-ana', displayId: 'W-1', name: 'Ana', role: 'Clerk', skills: [], availability: [] };
const late: ShiftTemplate = { id: 't-late', name: 'Late', role: 'Clerk', start: '14:00', end: '21:30', coverage: 1 };
const open: ShiftTemplate = { id: 't-open', name: 'Open', role: 'Clerk', start: '10:00', end: '14:00', coverage: 1 };
const shift = (id: string, date: string, template: ShiftTemplate): ComplianceShift => ({
  id, date, workerId: ana.id, templateId: template.id, location: '', status: 'Draft', template, worker: ana,
});
// 12.5 h of rest between Monday's late shift and Tuesday's open.
const shifts = [shift('mon', '2026-11-02', late), shift('tue', '2026-11-03', open)];

describe('location overrides wiring', () => {
  it('the compliance view applies a stricter rest override', () => {
    const base = evaluateCompliance({ shifts, locations: [MADRID], locationsLoaded: true, weekStart: '2026-11-01' });
    expect(base.findings.filter((f) => f.rule === 'rest.betweenShifts')).toEqual([]);
    const strict = evaluateCompliance({ shifts, locations: [STRICT_REST], locationsLoaded: true, weekStart: '2026-11-01' });
    const rest = strict.findings.filter((f) => f.rule === 'rest.betweenShifts');
    expect(rest).toHaveLength(1);
    expect(rest[0].verdict).toBe('violation');
    expect(strict.markers.tue).toBe('violation');
  });

  it('ignores malformed stored overrides', () => {
    const odd = { ...MADRID, overrides: [{ rule: 'rest.minHours' }, { anything: true }] };
    const r = evaluateCompliance({ shifts, locations: [odd], locationsLoaded: true, weekStart: '2026-11-01' });
    expect(r.findings.filter((f) => f.rule === 'rest.betweenShifts')).toEqual([]);
  });

  it('auto-assign uses the override in its merged constraints', () => {
    expect(autoAssignSettings('2026-11-03', MADRID).constraints?.minRestHoursBetweenShifts).toBe(12);
    expect(autoAssignSettings('2026-11-03', STRICT_REST).constraints?.minRestHoursBetweenShifts).toBe(13);
    const daily = { ...MADRID, overrides: [{ rule: 'daily.maxHours', value: 7 }] };
    expect(autoAssignSettings('2026-11-03', daily, { maxDailyHours: 8 }).constraints?.maxDailyHours).toBe(7);
  });
});
