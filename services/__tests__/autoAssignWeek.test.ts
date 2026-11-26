/**
 * One auto-assign run fills a week (CHG-108): days off are a hard rule of both engines,
 * per date, and a run over Monday to Sunday keeps each worker out only on their own day off.
 */
import { assignShifts, buildCheckContext, checkEligibility, timelineFor, type AssignmentInput } from '../shiftAssigner';
import { createHighsSolver, type HighsModule } from '../optimizer/highsSolver';
import { optimizeAssignments } from '../optimizer/shiftOptimizer';
import { isoWeekDates } from '@/utils/dateKeys';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadHighs = require('highs') as () => Promise<HighsModule>;
const highs = createHighsSolver(loadHighs);

const TZ = 'Europe/Madrid';
const WEDNESDAY = '2026-12-09';
const WEEK = isoWeekDates(WEDNESDAY); // 2026-12-07 … 2026-12-13

const morning: ShiftTemplate = { id: 'morning', name: 'Morning', role: 'Cook', start: '09:00', end: '17:00', coverage: 2 };
const worker = (id: string): Worker => ({
  id,
  displayId: id,
  name: id,
  role: 'Cook',
  skills: [],
  availability: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => ({ day, from: '00:00', to: '23:59' })),
});

const weekInput: AssignmentInput & { dates: string[] } = {
  date: WEEK[0],
  dates: WEEK,
  timeZone: TZ,
  templates: [morning],
  workers: [worker('ana'), worker('luis')],
  existingRoster: [],
  daysOff: [{ workerId: 'luis', date: WEDNESDAY }],
};

const byDate = (assignments: { date: string; workerId: string }[]) => {
  const map = new Map<string, string[]>();
  for (const a of assignments) map.set(a.date, [...(map.get(a.date) ?? []), a.workerId].sort());
  return Object.fromEntries([...map.entries()].sort());
};

describe('a day off in checkEligibility', () => {
  const at = timelineFor(weekInput);

  it('refuses the worker on their day off with no_availability', () => {
    const ctx = buildCheckContext(WEDNESDAY, undefined, at, weekInput.daysOff);
    expect(checkEligibility(worker('luis'), morning, [], ctx)).toBe('no_availability');
    expect(checkEligibility(worker('ana'), morning, [], ctx)).toBeNull();
  });

  it('does not refuse them on another date', () => {
    const ctx = buildCheckContext('2026-12-10', undefined, at, weekInput.daysOff);
    expect(checkEligibility(worker('luis'), morning, [], ctx)).toBeNull();
  });
});

describe('greedy: one day', () => {
  it('leaves the worker who is off out and reports the open position', () => {
    const result = assignShifts({ ...weekInput, date: WEDNESDAY });
    expect(result.assignments.map((a) => a.workerId)).toEqual(['ana']);
    expect(result.unassigned).toMatchObject([{ date: WEDNESDAY, templateId: 'morning', missing: 1 }]);
  });

  it('regression: without days off both are assigned (the rule is what keeps Luis out)', () => {
    const result = assignShifts({ ...weekInput, date: WEDNESDAY, daysOff: undefined });
    expect(result.assignments.map((a) => a.workerId).sort()).toEqual(['ana', 'luis']);
  });
});

describe.each([
  ['greedy', null],
  ['ILP', highs],
] as const)('%s: the whole week', (_name, solver) => {
  it('fills Monday to Sunday, with Luis out only on his day off', async () => {
    const result = await optimizeAssignments(weekInput, { solver });
    const expected = Object.fromEntries(WEEK.map((d) => [d, d === WEDNESDAY ? ['ana'] : ['ana', 'luis']]));
    expect(byDate(result.assignments)).toEqual(expected);
    expect(result.unassigned).toMatchObject([{ date: WEDNESDAY, missing: 1 }]);
  });
});
