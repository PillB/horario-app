/**
 * CHG-087 / QA F1: a template that lies inside the spring-forward gap.
 *
 * 02:00–03:00 America/New_York on 2026-03-08 never happens on the wall clock. Before
 * CHG-087 both ends resolved to 07:00Z, the slot was zero-length, zero-length never
 * "overlapped", and one worker filled all three positions. Now the span moves to after
 * the gap with its wall-clock length (03:00–04:00 EDT, as `zonedToUtc` reads a gap time
 * with the pre-gap offset), and a worker never takes two positions of one slot.
 */
import {
  assignShifts,
  buildCheckContext,
  checkEligibility,
  intervalsOverlap,
  shiftInterval,
  timelineFor,
  type AssignmentInput,
  type Entry,
} from '../shiftAssigner';
import { buildAssignmentModel } from '../optimizer/assignmentModel';
import { createHighsSolver, type HighsModule } from '../optimizer/highsSolver';
import { optimizeAssignments } from '../optimizer/shiftOptimizer';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const highs = createHighsSolver(require('highs') as () => Promise<HighsModule>);

const TZ = 'America/New_York';
const DAY = '2026-03-08'; // spring forward: 02:00 EST → 03:00 EDT
const H = 60;
const utcMinutes = (iso: string): number => Date.parse(iso) / 60_000;

const worker = (id: string): Worker => ({
  id,
  displayId: id,
  name: id,
  role: 'Cook',
  skills: [],
  availability: [{ day: 'Sun', from: '00:00', to: '23:59' }],
});
const template = (start: string, end: string, coverage = 1, id = 'gap'): ShiftTemplate => ({
  id,
  name: id,
  role: 'Cook',
  start,
  end,
  coverage,
});

const qaInput = (): AssignmentInput => ({
  date: DAY,
  timeZone: TZ,
  templates: [template('02:00', '03:00', 3)],
  workers: [worker('solo')],
  existingRoster: [],
  constraints: {},
});

describe('spans inside the DST gap', () => {
  const at = timelineFor(qaInput());

  it('moves 02:00–03:00 to 03:00–04:00 EDT (60 min), not a zero-length span', () => {
    const iv = shiftInterval(template('02:00', '03:00'), DAY, at);
    expect(iv.start).toBe(utcMinutes('2026-03-08T07:00:00Z'));
    expect(iv.end - iv.start).toBe(H);
  });

  it('moves 02:30–03:00 to 03:30–04:00 EDT instead of a negative span', () => {
    const iv = shiftInterval(template('02:30', '03:00'), DAY, at);
    expect(iv.start).toBe(utcMinutes('2026-03-08T07:30:00Z'));
    expect(iv.end - iv.start).toBe(30);
  });

  it('leaves spans that end after the gap as elapsed time (01:00–04:00 is 2h)', () => {
    const iv = shiftInterval(template('01:00', '04:00'), DAY, at);
    expect(iv.end - iv.start).toBe(2 * H);
  });
});

describe('one worker never fills two positions of a slot', () => {
  it('greedy: one worker takes one of three positions; two are reported short', () => {
    const result = assignShifts(qaInput());
    expect(result.assignments).toEqual([{ date: DAY, templateId: 'gap', workerId: 'solo' }]);
    expect(result.unassigned).toEqual([
      expect.objectContaining({ templateId: 'gap', required: 3, assigned: 1, missing: 2, reasonCode: 'overlap' }),
    ]);
  });

  it('ILP: the same, from the solver (no greedy_better fallback)', async () => {
    const model = buildAssignmentModel(qaInput());
    expect(model.slots[0].minutes).toBe(H);
    expect(model.candidates).toHaveLength(1); // one variable per (worker, slot)
    const result = await optimizeAssignments(qaInput(), { solver: highs });
    expect(result.assignments).toHaveLength(1);
    expect(result.unassigned[0]).toMatchObject({ missing: 2, reasonCode: 'overlap' });
    expect(result.solver.engine).toBe('ilp');
    expect(result.solver.dropped).toBe(0);
  });

  it('checkEligibility: a worker already on (date, template) is ineligible even when that entry is zero-length', () => {
    const ctx = buildCheckContext(DAY, undefined, timelineFor(qaInput()));
    const t = template('09:00', '17:00', 2, 'day');
    // A zero-length entry for the same slot at an instant outside the 09:00–17:00 window.
    const held: Entry = { workerId: 'solo', templateId: 'day', date: DAY, start: 0, end: 0 };
    expect(checkEligibility(worker('solo'), t, [held], ctx)).toBe('overlap');
    expect(checkEligibility(worker('other'), t, [held], ctx)).toBeNull();
  });

  it('checkEligibility: a zero-length entry inside the slot blocks it', () => {
    const at = timelineFor(qaInput());
    const ctx = buildCheckContext(DAY, undefined, at);
    const t = template('09:00', '17:00', 1, 'day');
    const iv = shiftInterval(t, DAY, at);
    const point: Entry = { workerId: 'solo', templateId: 'other', date: DAY, start: iv.start + H, end: iv.start + H };
    expect(checkEligibility(worker('solo'), t, [point], ctx)).toBe('overlap');
  });

  it('intervalsOverlap treats a zero-length interval as its instant', () => {
    expect(intervalsOverlap({ start: 5, end: 5 }, { start: 5, end: 5 })).toBe(true);
    expect(intervalsOverlap({ start: 5, end: 5 }, { start: 0, end: 10 })).toBe(true);
    expect(intervalsOverlap({ start: 10, end: 10 }, { start: 0, end: 10 })).toBe(false); // half-open
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 9, end: 20 })).toBe(true);
  });
});
