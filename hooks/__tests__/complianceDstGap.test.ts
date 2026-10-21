/**
 * CHG-089: a shift entirely inside a spring-forward gap. Both ends used to
 * resolve to the same instant, so the labor engine saw a zero-length shift and
 * reported `input.invalid`. It now moves to after the gap with its wall-clock
 * length, the rule the auto-assigner uses (CHG-087 `zonedSpan`).
 */
import { evaluateCompliance, type ComplianceShift } from '../useCompliance';
import { evaluateShifts } from '@/services/labor/engine';
import { timelineFor, zonedSpan, type AssignmentInput } from '@/services/shiftAssigner';
import type { Worker } from '@/types/scheduler';
import type { BusinessLocation } from '@/utils/locationValidation';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import { parseHHMM, zonedShiftSpan } from '@/utils/zonedTime';

const location = (over: Partial<BusinessLocation>): BusinessLocation => ({
  id: '00000000-0000-0000-0000-0000000000e1',
  name: 'Store',
  countryCode: 'US',
  regionCode: null,
  cityCode: null,
  jurisdictionCode: 'US',
  timeZone: 'America/New_York',
  industry: 'retail',
  employerHeadcount: null,
  locationsCount: null,
  detectedHint: null,
  overrides: [],
  confirmedBy: 'user_a',
  confirmedAt: '2026-10-20T00:00:00Z',
  ...over,
});

const ana: Worker = { id: 'w-ana', displayId: 'W-1', name: 'Ana', role: 'Clerk', skills: [], availability: [] };
const template = (start: string, end: string): ShiftTemplate => ({ id: `t-${start}-${end}`, name: 'T', role: 'Clerk', start, end, coverage: 1 });
const shift = (id: string, date: string, t: ShiftTemplate): ComplianceShift => ({
  id, date, workerId: ana.id, templateId: t.id, location: '', status: 'Draft', template: t, worker: ana,
});

/** The assigner's span (minutes on its timeline) as epoch ms. */
const assignerSpan = (date: string, start: string, end: string, timeZone: string) => {
  const at = timelineFor({ timeZone } as AssignmentInput);
  const s = parseHHMM(start);
  let e = parseHHMM(end);
  if (e <= s) e += 1440;
  const iv = zonedSpan(date, s, e, at);
  return { start: iv.start * 60_000, end: iv.end * 60_000 };
};

const CASES: [string, string, string, string][] = [
  ['America/New_York', '2026-03-08', '02:00', '03:00'],
  ['America/New_York', '2026-03-08', '02:30', '03:00'],
  ['America/New_York', '2026-03-08', '02:00', '02:59'],
  ['America/New_York', '2026-03-08', '01:00', '04:00'],
  ['America/New_York', '2026-03-08', '02:30', '04:00'],
  ['Europe/Madrid', '2026-03-29', '02:00', '03:00'],
  ['Australia/Sydney', '2026-10-04', '02:00', '03:00'],
  ['America/New_York', '2026-11-01', '22:00', '06:00'],
];

describe('DST gap: labor spans match the auto-assigner', () => {
  it.each(CASES)('%s %s %s–%s', (tz, date, start, end) => {
    const labor = zonedShiftSpan(date, start, end, tz);
    expect(labor).toEqual(assignerSpan(date, start, end, tz));
    expect(labor.end).toBeGreaterThan(labor.start);
  });

  it('02:00–03:00 New York on spring-forward day is 03:00–04:00 EDT', () => {
    const span = zonedShiftSpan('2026-03-08', '02:00', '03:00', 'America/New_York');
    expect(new Date(span.start).toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(new Date(span.end).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('the engine checks a gap shift instead of reporting input.invalid', () => {
    const span = zonedShiftSpan('2026-03-08', '02:00', '03:00', 'America/New_York');
    const r = evaluateShifts({ jurisdiction: 'US', timeZone: 'America/New_York' }, { id: 'w' }, [{ id: 'g', ...span }]);
    expect(r.findings.filter((f) => f.rule === 'input.invalid')).toEqual([]);
    expect(r.pay.regularHours).toBe(1);
  });

  it('the compliance view does not flag a gap shift as invalid', () => {
    const result = evaluateCompliance({
      shifts: [shift('g', '2026-03-08', template('02:00', '03:00'))],
      locations: [location({})],
      locationsLoaded: true,
      weekStart: '2026-03-08',
    });
    expect(result.status).toBe('ready');
    expect(result.findings.filter((f) => f.rule === 'input.invalid')).toEqual([]);
    expect(result.markers.g).toBeUndefined();
  });

  it('rest after a gap shift is measured from its moved end (Madrid, 12 h)', () => {
    // 02:00–03:00 on 2026-03-29 becomes 03:00–04:00 CEST; a 15:00 start leaves 11 h.
    const result = evaluateCompliance({
      shifts: [shift('g', '2026-03-29', template('02:00', '03:00')), shift('n', '2026-03-29', template('15:00', '20:00'))],
      locations: [location({ countryCode: 'ES', jurisdictionCode: 'ES', timeZone: 'Europe/Madrid' })],
      locationsLoaded: true,
      weekStart: '2026-03-29',
    });
    expect(result.findings.filter((f) => f.rule === 'input.invalid')).toEqual([]);
    const rest = result.findings.filter((f) => f.rule === 'rest.betweenShifts');
    expect(rest).toHaveLength(1);
    expect(rest[0].hours).toBe(11);
  });
});
