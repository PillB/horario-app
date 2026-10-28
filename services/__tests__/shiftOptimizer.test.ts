/**
 * ILP auto-assign (CHG-085): model building, real HiGHS solves (Node build of the same
 * WASM the browser worker loads), the greedy comparison and every fallback.
 */
import { assignShifts, type AssignmentInput } from '../shiftAssigner';
import { buildAssignmentModel, buildLp, scoreSchedule } from '../optimizer/assignmentModel';
import { createHighsSolver, type HighsModule } from '../optimizer/highsSolver';
import { greedyAssign, optimizeAssignments, type LpSolver } from '../optimizer/shiftOptimizer';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadHighs = require('highs') as () => Promise<HighsModule>;
const highs = createHighsSolver(loadHighs);

const MON = '2026-03-23';
const TZ = 'Europe/Madrid';

const template = (id: string, start: string, end: string, role = 'Cook', coverage = 1): ShiftTemplate => ({
  id,
  name: id,
  role,
  start,
  end,
  coverage,
});

const worker = (id: string, slots: { day: string; from: string; to: string }[], role = 'Cook'): Worker => ({
  id,
  displayId: id,
  name: id,
  role,
  skills: [],
  availability: slots,
});

const allWeek = (from = '00:00', to = '23:59') =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => ({ day, from, to }));

/**
 * First-fit trap: W1 can work either shift, W2 only the morning. Both start with 0 h,
 * so the greedy gives the morning to W1 (first in the list) and then nobody can take the
 * overlapping afternoon. The optimum is W2 → morning, W1 → afternoon.
 */
const trap: AssignmentInput = {
  date: MON,
  timeZone: TZ,
  templates: [template('morning', '09:00', '17:00'), template('late', '12:00', '20:00')],
  workers: [worker('w1', [{ day: 'Mon', from: '08:00', to: '21:00' }]), worker('w2', [{ day: 'Mon', from: '08:00', to: '17:00' }])],
  existingRoster: [],
};

describe('assignment model', () => {
  it('only creates candidates that pass role and availability, with coverage and clique rows', () => {
    const model = buildAssignmentModel({
      ...trap,
      workers: [...trap.workers, worker('s1', [{ day: 'Mon', from: '00:00', to: '23:59' }], 'Server')],
      templates: [...trap.templates, template('pair', '09:00', '13:00', 'Cook', 2)],
    });
    expect(model.candidates.map((c) => c.name).sort()).toEqual(['x0_0', 'x0_1', 'x0_2', 'x1_0', 'x1_2']);
    const lp = buildLp(model, { kind: 'coverage' });
    expect(lp).toContain('Maximize\n obj: x0_0 + x1_0 + x0_1 + x0_2 + x1_2');
    // morning has 2 candidates for 1 position; pair has 2 for 2, so no row is needed.
    expect(lp).toContain(' cov0: x0_0 + x1_0 <= 1');
    expect(lp).not.toContain('cov2:');
    // w1: morning, late and pair all overlap at 12:00.
    expect(lp).toMatch(/clq0_\d+: x0_0 \+ x0_2 \+ x0_1 <= 1|clq0_\d+: x0_2 \+ x0_0 \+ x0_1 <= 1/);
    expect(lp).toContain('Binary\n x0_0 x1_0 x0_1 x0_2 x1_2\nEnd');
  });

  it('adds rest gaps to the conflict cliques and hours rows only when they can bind', () => {
    const input: AssignmentInput = {
      date: MON,
      timeZone: TZ,
      templates: [template('early', '06:00', '10:00'), template('late', '18:00', '23:00')],
      workers: [worker('w1', allWeek())],
      existingRoster: [],
      constraints: { minRestHoursBetweenShifts: 12, maxDailyHours: 8 },
    };
    const lp = buildLp(buildAssignmentModel(input), { kind: 'coverage' });
    // 8 h gap < 12 h rest, so early and late conflict.
    expect(lp).toContain('clq0_0: x0_0 + x0_1 <= 1');
    // 4 h + 5 h > 8 h: the daily row is emitted with minute coefficients.
    expect(lp).toContain('day0_0: 240 x0_0 + 300 x0_1 <= 480');

    const relaxed = buildLp(buildAssignmentModel({ ...input, constraints: { minRestHoursBetweenShifts: 8, maxDailyHours: 10 } }), {
      kind: 'coverage',
    });
    expect(relaxed).not.toContain('clq');
    expect(relaxed).not.toContain('day0_0');
  });

  it('builds linear fairness rows around the group mean and the coverage floor', () => {
    const model = buildAssignmentModel({
      date: MON,
      timeZone: TZ,
      templates: [template('a', '09:00', '13:00')],
      workers: [worker('w1', allWeek()), worker('w2', allWeek())],
      existingRoster: [],
    });
    const lp = buildLp(model, { kind: 'fairness', minCoverage: 1 });
    expect(lp).toContain('Minimize\n obj: d0');
    // n = 2: 2·X1 − (X1 + X2) − 2·d ≤ 0  →  240 x0_0 − 240 x1_0 − 2 d0 ≤ 0
    expect(lp).toContain('fp0: 240 x0_0 - 240 x1_0 - 2 d0 <= 0');
    expect(lp).toContain('covmin: x0_0 + x1_0 >= 1');
    expect(lp).toContain('Bounds\n d0 >= 0');
  });
});

describe('optimizeAssignments with HiGHS', () => {
  it('beats first-fit on the trap', async () => {
    const greedy = assignShifts(trap);
    expect(greedy.assignments).toHaveLength(1);
    expect(greedy.unassigned[0]).toMatchObject({ templateId: 'late', reasonCode: 'overlap' });

    const result = await optimizeAssignments(trap, { solver: highs });
    expect(result.solver.engine).toBe('ilp');
    expect(result.solver.optimal).toBe(true);
    expect(result.assignments).toEqual([
      { date: MON, templateId: 'morning', workerId: 'w2' },
      { date: MON, templateId: 'late', workerId: 'w1' },
    ]);
    expect(result.unassigned).toEqual([]);
    expect(result.solver.score?.filled).toBe(2);
    expect(result.solver.greedyScore?.filled).toBe(1);
  });

  it('balances hours inside a role (fairness stage)', async () => {
    // Three 4 h shifts that do not overlap, three workers available all day. Coverage
    // alone allows one worker to take everything; fairness spreads them out.
    const input: AssignmentInput = {
      date: MON,
      timeZone: TZ,
      templates: [template('a', '06:00', '10:00'), template('b', '11:00', '15:00'), template('c', '16:00', '20:00')],
      workers: [worker('w1', allWeek()), worker('w2', allWeek()), worker('w3', allWeek())],
      existingRoster: [
        // w1 already worked 8 h this week.
        { id: 'e1', date: '2026-03-24', workerId: 'w1', templateId: 'long', location: '', status: 'Draft' },
      ],
      templateCatalog: [template('long', '08:00', '16:00')],
    };
    const result = await optimizeAssignments(input, { solver: highs });
    expect(result.solver.engine).toBe('ilp');
    const byWorker = (id: string) => result.assignments.filter((a) => a.workerId === id).length;
    expect(result.assignments).toHaveLength(3);
    // w1 has 8 h already, so the 12 new hours go to w2 and w3: 8/8/4 h is the smallest spread.
    expect(byWorker('w1')).toBe(0);
    expect(result.solver.score?.spreadMinutes).toBeLessThanOrEqual(result.solver.greedyScore?.spreadMinutes ?? Infinity);
  });

  it('prefers a worker who has worked the same template on the same weekday (continuity)', async () => {
    const input: AssignmentInput = {
      date: MON,
      timeZone: TZ,
      templates: [template('open', '06:00', '14:00')],
      workers: [worker('w1', allWeek()), worker('w2', allWeek())],
      // w2 opened last Monday; last week's hours do not count toward this week's fairness.
      existingRoster: [{ id: 'e', date: '2026-03-16', workerId: 'w2', templateId: 'open', location: '', status: 'Published' }],
    };
    const result = await optimizeAssignments(input, { solver: highs });
    expect(result.assignments).toEqual([{ date: MON, templateId: 'open', workerId: 'w2' }]);
    expect(result.solver.stages.map((s) => s.kind)).toEqual(['coverage', 'fairness', 'continuity']);
  });

  it('assigns a whole week in one model under weekly and rest limits', async () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-03-${String(23 + i).padStart(2, '0')}`);
    const input = {
      date: dates[0],
      dates,
      timeZone: TZ,
      templates: [template('day', '08:00', '16:00'), template('night', '22:00', '06:00')],
      workers: [worker('w1', allWeek()), worker('w2', allWeek()), worker('w3', allWeek())],
      existingRoster: [],
      constraints: { maxWeeklyHours: 40, minRestHoursBetweenShifts: 12, maxDailyHours: 9 },
    };
    const result = await optimizeAssignments(input, { solver: highs });
    const greedy = greedyAssign(input);
    // 14 shifts of 8 h, 3 × 40 h = 15 shifts of capacity.
    expect(result.assignments.length).toBeGreaterThanOrEqual(greedy.assignments.length);
    expect(result.assignments).toHaveLength(14);
    expect(result.unassigned).toEqual([]);
  });

  it('reports every shortfall with the greedy reason codes', async () => {
    const result = await optimizeAssignments(
      {
        ...trap,
        templates: [...trap.templates, template('bar', '10:00', '14:00', 'Bartender'), template('night', '23:00', '03:00')],
      },
      { solver: highs },
    );
    expect(result.unassigned.map((u) => [u.templateId, u.reasonCode])).toEqual([
      ['bar', 'no_role_match'],
      ['night', 'no_availability'],
    ]);
    expect(result.unassigned[0]).toMatchObject({ required: 1, assigned: 0, missing: 1, date: MON });
  });
});

describe('fallbacks', () => {
  it('returns the greedy result without a solver', async () => {
    const result = await optimizeAssignments(trap, { solver: null });
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'no_solver' });
    expect(result.assignments).toEqual(assignShifts(trap).assignments);
  });

  it('returns the greedy result when the WASM fails to load', async () => {
    const broken = createHighsSolver(() => Promise.reject(new Error('wasm fetch failed')));
    const result = await optimizeAssignments(trap, { solver: broken });
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'solver_error', error: 'wasm fetch failed' });
    expect(result.assignments).toHaveLength(1);
  });

  it('returns the greedy result when the time limit ends with no incumbent', async () => {
    const timedOut: LpSolver = () => ({ status: 'Time limit reached', values: null });
    const result = await optimizeAssignments(trap, { solver: timedOut });
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'no_solution' });
  });

  it('keeps the greedy schedule when the solver returns a worse one', async () => {
    const empty: LpSolver = () => ({ status: 'Time limit reached', values: {} });
    // An empty incumbent is repaired by the fill pass, which can still fall into the trap.
    const result = await optimizeAssignments(trap, { solver: empty });
    expect(result.assignments.length).toBeGreaterThanOrEqual(assignShifts(trap).assignments.length);
    const model = buildAssignmentModel(trap);
    expect(scoreSchedule(model, result.assignments).filled).toBeGreaterThanOrEqual(1);

    const wrong: LpSolver = () => ({ status: 'Optimal', values: {} });
    const zeroOut = await optimizeAssignments(
      { ...trap, templates: [template('solo', '09:00', '12:00')] },
      { solver: wrong },
    );
    expect(zeroOut.assignments).toHaveLength(1);
  });

  it('drops solver assignments that break a hard constraint', async () => {
    // A solver that claims both overlapping shifts for w1: the repair keeps the first,
    // and the late shift is reported open (w2 cannot cover it).
    const liar: LpSolver = () => ({ status: 'Optimal', values: { x0_0: 1, x0_1: 1 } });
    const result = await optimizeAssignments(trap, { solver: liar });
    expect(result.assignments).toEqual([{ date: MON, templateId: 'morning', workerId: 'w1' }]);
    expect(result.unassigned.map((u) => [u.templateId, u.reasonCode])).toEqual([['late', 'overlap']]);
    expect(result.solver.dropped).toBeGreaterThan(0);
  });

  it('stops early when the budget is spent and keeps the stages it has', async () => {
    let clock = 0;
    const slow: LpSolver = async (lp, options) => {
      clock += 10_000; // every solve "takes" 10 s
      return highs(lp, options);
    };
    const result = await optimizeAssignments(trap, { solver: slow, timeLimitMs: 2000, now: () => clock });
    expect(result.solver.stages.map((s) => s.kind)).toEqual(['coverage']);
    expect(result.solver.engine).toBe('ilp');
    expect(result.assignments).toHaveLength(2);
  });
});
