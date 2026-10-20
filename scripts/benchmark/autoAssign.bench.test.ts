/**
 * Auto-assign benchmark (CHG-085): greedy + 2-opt vs the HiGHS ILP, one week of shifts
 * for 10, 50 and 150 workers. Not part of `npm test` (ignored in the Jest config).
 *
 *   npm run bench:assign          (BENCH_DEBUG=1 also prints each day's solver stages)
 *
 * Runs in Node with the same HiGHS WebAssembly the browser worker loads (Node is
 * usually somewhat faster than a browser worker; treat browser times as unmeasured).
 * Modes:
 *   greedy      assignShifts day by day, each day seeing the earlier ones
 *   ilp/day     optimizeAssignments day by day (what the app does: one date per run)
 *   ilp/week    one model for all 7 days
 */
import { assignShifts, type AssignmentInput, type LaborConstraints } from '@/services/shiftAssigner';
import { buildAssignmentModel, scoreSchedule, type OptimizeInput } from '@/services/optimizer/assignmentModel';
import { createHighsSolver, type HighsModule } from '@/services/optimizer/highsSolver';
import { optimizeAssignments } from '@/services/optimizer/shiftOptimizer';
import type { Shift, ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const solver = createHighsSolver(require('highs') as () => Promise<HighsModule>);

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const ROLES = ['Cook', 'Server', 'Cashier'];
// Spanish limits as the scheduler would merge them: 9 h a day, 40 h a week, 12 h rest.
const CONSTRAINTS: LaborConstraints = { maxDailyHours: 9, maxWeeklyHours: 40, minRestHoursBetweenShifts: 12 };
const WINDOWS = [
  { from: '06:00', to: '16:00' },
  { from: '10:00', to: '23:59' },
  { from: '00:00', to: '23:59' },
  { from: '14:00', to: '23:59' },
];

const makeCase = (workerCount: number, seed: number): OptimizeInput => {
  const rng = mulberry32(seed);
  const workers: Worker[] = Array.from({ length: workerCount }, (_, i) => {
    const days = DAYS.filter(() => rng() < 0.75);
    const window = WINDOWS[Math.floor(rng() * WINDOWS.length)];
    const nights = rng() < 0.2;
    const availability = days.flatMap((day) => [
      { day, ...window },
      ...(nights ? [{ day, from: '22:00', to: '23:59' }, { day: DAYS[(DAYS.indexOf(day) + 1) % 7], from: '00:00', to: '07:00' }] : []),
    ]);
    return { id: `w${i}`, displayId: `W-${i}`, name: `w${i}`, role: ROLES[i % ROLES.length], skills: [], availability };
  });
  // Demand: about 85 % of what 5 shifts a week per worker could cover, per role.
  const perRole = Math.max(1, Math.round((workerCount / ROLES.length) * 5 * 0.85 / 7));
  const templates: ShiftTemplate[] = ROLES.flatMap((role, r) => {
    const split = [0.4, 0.35, 0.25].map((share) => Math.max(1, Math.round(perRole * share)));
    return [
      { id: `${role}-am`, name: `${role} AM`, role, start: '07:00', end: '15:00', coverage: split[0] },
      { id: `${role}-mid`, name: `${role} mid`, role, start: '11:00', end: '19:00', coverage: split[1] },
      { id: `${role}-pm`, name: `${role} PM`, role, start: '15:00', end: '23:00', coverage: split[2] },
      ...(r === 0 ? [{ id: `${role}-night`, name: `${role} night`, role, start: '23:00', end: '07:00', coverage: 1 }] : []),
    ];
  });
  return { date: DATES[0], dates: DATES, templates, workers, existingRoster: [], constraints: CONSTRAINTS, timeZone: 'Europe/Madrid' };
};

const toShifts = (assignments: { date: string; templateId: string; workerId: string }[], tag: string): Shift[] =>
  assignments.map((a, i) => ({ id: `${tag}${i}`, ...a, location: '', status: 'Draft' }));

const greedyWeek = (input: OptimizeInput) => {
  let roster: Shift[] = [];
  const all: { date: string; templateId: string; workerId: string }[] = [];
  for (const date of DATES) {
    const day: AssignmentInput = { ...input, date, existingRoster: roster, templateCatalog: input.templates };
    const result = assignShifts(day);
    all.push(...result.assignments);
    roster = roster.concat(toShifts(result.assignments, date));
  }
  return all;
};

const ilpByDay = async (input: OptimizeInput, timeLimitMs: number) => {
  let roster: Shift[] = [];
  const all: { date: string; templateId: string; workerId: string }[] = [];
  const statuses = new Set<string>();
  let worst = 0;
  for (const date of DATES) {
    const t0 = performance.now();
    const result = await optimizeAssignments(
      { ...input, dates: undefined, date, existingRoster: roster, templateCatalog: input.templates },
      { solver, timeLimitMs },
    );
    worst = Math.max(worst, performance.now() - t0);
    if (process.env.BENCH_DEBUG) console.log(date, input.workers.length, JSON.stringify(result.solver.stages), result.solver.variables, result.solver.solveMs);
    statuses.add(result.solver.engine === 'ilp' ? (result.solver.optimal ? 'optimal' : 'feasible') : `greedy:${result.solver.fallbackReason}`);
    all.push(...result.assignments);
    roster = roster.concat(toShifts(result.assignments, date));
  }
  return { all, statuses: [...statuses].join('/'), worst };
};

const SIZES = [10, 50, 150];
const SEEDS = [1, 2];

test('benchmark', async () => {
  await solver('Maximize\n obj: x\nSubject To\n c: x <= 1\nBinary\n x\nEnd', { timeLimitSeconds: 1 }); // warm up the WASM
  const rows: string[] = [];
  for (const n of SIZES) {
    for (const seed of SEEDS) {
      const input = makeCase(n, seed * 1000 + n);
      const model = buildAssignmentModel(input);
      const positions = model.slots.reduce((sum, s) => sum + s.required, 0);

      let t0 = performance.now();
      const greedy = greedyWeek(input);
      const greedyMs = performance.now() - t0;
      const g = scoreSchedule(model, greedy);

      t0 = performance.now();
      const byDay = await ilpByDay(input, 2000);
      const dayMs = performance.now() - t0;
      const d = scoreSchedule(model, byDay.all);

      t0 = performance.now();
      const week = await optimizeAssignments(input, { solver, timeLimitMs: 10_000 });
      const weekMs = performance.now() - t0;
      const w = scoreSchedule(model, week.assignments);
      const weekStatus = week.solver.engine === 'ilp' ? (week.solver.optimal ? 'optimal' : 'feasible') : `greedy:${week.solver.fallbackReason}`;

      const h = (m: number) => (m / 60).toFixed(1);
      rows.push(
        [
          `${n} workers seed ${seed}`.padEnd(20),
          `${positions} pos`.padEnd(8),
          `greedy ${g.filled} filled, spread ${h(g.spreadMinutes)} h, ${greedyMs.toFixed(0)} ms`.padEnd(44),
          `ilp/day ${d.filled}, ${h(d.spreadMinutes)} h, ${dayMs.toFixed(0)} ms (max day ${byDay.worst.toFixed(0)} ms, ${byDay.statuses})`.padEnd(70),
          `ilp/week ${w.filled}, ${h(w.spreadMinutes)} h, ${weekMs.toFixed(0)} ms (${weekStatus}, ${week.solver.variables} vars, ${week.solver.constraints} rows)`,
        ].join(' | '),
      );
    }
  }
  console.log(['Auto-assign benchmark (Node, HiGHS WASM single-threaded)', ...rows].join('\n'));
}, 600_000);
