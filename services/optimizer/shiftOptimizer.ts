/**
 * Auto-assign with an exact integer program, never worse than the greedy (CHG-085).
 *
 *   1. Run the greedy + 2-opt assigner (services/shiftAssigner.ts), date by date.
 *   2. Build the ILP (services/optimizer/assignmentModel.ts) and solve its three
 *      lexicographic stages (coverage, fairness, continuity) with the given LP solver,
 *      sharing one time budget. A stage that ends without a solution stops the chain;
 *      the earlier stages' solutions are kept.
 *   3. Re-check every solver assignment against the hard constraints (dropping any that
 *      fail, which only a numerical error could cause), fill any slot still open that a
 *      worker can legally take, and report each shortfall with the greedy's reason code.
 *   4. Score every candidate schedule (greedy and each stage) by coverage, then fairness
 *      spread, then continuity, and return the best one. Ties keep the solver's.
 *
 * Without a solver, or when it fails or finds nothing, the greedy result is returned
 * with the reason in `solver.fallbackReason`.
 *
 * Pure apart from calling `solver`; no React, no WASM import (the solver is injected).
 */
import {
  assignShifts,
  checkEligibility,
  describeReason,
  shortfallReason,
  type AssignedShift,
  type AssignmentResult,
  type CheckContext,
  type CoverageShortfall,
  type Entry,
} from '@/services/shiftAssigner';
import type { Shift } from '@/utils/schedulerMetrics';
import {
  buildAssignmentModel,
  buildLp,
  compareScores,
  decodeSolution,
  runDates,
  scoreSchedule,
  type AssignmentModel,
  type OptimizeInput,
  type ScheduleScore,
  type Stage,
} from './assignmentModel';

// ─── Types ────────────────────────────────────────────────────────────────────

/** What a solver returns: its status text and column values (null without a solution). */
export type LpSolution = { status: string; values: Record<string, number> | null };

/** Solves CPLEX LP text within a time limit. May throw (e.g. the WASM failed to load). */
export type LpSolver = (lp: string, options: { timeLimitSeconds: number }) => LpSolution | Promise<LpSolution>;

export type FallbackReason =
  /** No solver on this platform (native, or web without Worker). */
  | 'no_solver'
  /** The solver threw: WASM load failure, parse error, abort. */
  | 'solver_error'
  /** The first stage ended without any solution (e.g. time limit before an incumbent). */
  | 'no_solution'
  /** The solver's schedule scored below the greedy's. */
  | 'greedy_better'
  /** The worker did not answer within the client timeout. */
  | 'timeout'
  /** The Web Worker could not start or crashed. */
  | 'worker_error';

export type SolverReport = {
  engine: 'ilp' | 'greedy';
  fallbackReason?: FallbackReason;
  /** Error text when the solver or worker failed. */
  error?: string;
  /** HiGHS status of each stage that ran, in order. */
  stages: { kind: Stage['kind']; status: string; ms: number }[];
  /** True when every stage that ran proved optimality. */
  optimal: boolean;
  /** Wall time spent in the solver, in ms. */
  solveMs: number;
  /** Score of the returned schedule (absent when the greedy ran inline without a model). */
  score?: ScheduleScore;
  greedyScore?: ScheduleScore;
  variables: number;
  constraints: number;
  /**
   * Solver assignments the hard-constraint re-check dropped, summed over the stages.
   * Always 0 unless the model or the solver is wrong; the tests assert it.
   */
  dropped: number;
};

export type OptimizedAssignmentResult = AssignmentResult & { solver: SolverReport };

export type OptimizeOptions = {
  solver?: LpSolver | null;
  /** Total solver budget across the stages, in ms. Default 2000. */
  timeLimitMs?: number;
  now?: () => number;
};

export const DEFAULT_TIME_LIMIT_MS = 2000;

// ─── Greedy baseline ──────────────────────────────────────────────────────────

/** The greedy + 2-opt assigner run date by date, each date seeing the earlier ones. */
export function greedyAssign(input: OptimizeInput): AssignmentResult {
  const dates = runDates(input);
  if (dates.length === 1) return assignShifts({ ...input, date: dates[0] });
  const assignments: AssignedShift[] = [];
  const unassigned: CoverageShortfall[] = [];
  let roster: Shift[] = input.existingRoster;
  const catalog = [...(input.templateCatalog ?? []), ...input.templates];
  for (const date of dates) {
    const result = assignShifts({ ...input, date, existingRoster: roster, templateCatalog: catalog });
    assignments.push(...result.assignments);
    unassigned.push(...result.unassigned);
    roster = roster.concat(
      result.assignments.map((a, i) => ({
        id: `greedy-${date}-${i}`,
        date: a.date,
        workerId: a.workerId,
        templateId: a.templateId,
        location: '',
        status: 'Draft' as const,
      })),
    );
  }
  return { assignments, unassigned };
}

// ─── Repair and shortfalls ────────────────────────────────────────────────────

const toEntry = (model: AssignmentModel, a: AssignedShift): Entry | null => {
  const slot = model.slots.find((s) => s.date === a.date && s.template.id === a.templateId);
  return slot ? { workerId: a.workerId, templateId: a.templateId, date: a.date, start: slot.start, end: slot.end } : null;
};

/**
 * Keeps the assignments that pass every hard constraint (checked one by one against
 * the existing roster and the ones kept so far), then fills open slots with any worker
 * who can still legally take them (fewest hours first), and reports what stays open.
 */
export function finalizeSchedule(model: AssignmentModel, proposed: AssignedShift[]): AssignmentResult & { dropped: number } {
  const workerById = new Map(model.workers.map((w) => [w.id, w]));
  const kept: Entry[] = [];
  const counts = new Map<number, number>();
  const slotOf = (a: { date: string; templateId: string }): number =>
    model.slots.findIndex((s) => s.date === a.date && s.template.id === a.templateId);

  const tryAdd = (a: AssignedShift): boolean => {
    const si = slotOf(a);
    const worker = workerById.get(a.workerId);
    if (si < 0 || !worker) return false;
    const slot = model.slots[si];
    if ((counts.get(si) ?? 0) >= slot.required) return false;
    if (kept.some((e) => e.workerId === a.workerId && e.date === a.date && e.templateId === a.templateId)) return false;
    const ctx = model.contexts.get(slot.date) as CheckContext;
    if (checkEligibility(worker, slot.template, model.existing.concat(kept), ctx) !== null) return false;
    const entry = toEntry(model, a);
    if (!entry) return false;
    kept.push(entry);
    counts.set(si, (counts.get(si) ?? 0) + 1);
    return true;
  };

  let dropped = 0;
  for (const a of proposed) if (!tryAdd(a)) dropped++;

  // Fill pass: the solver may stop early (time limit); never leave a fillable slot open.
  const minutes = new Map<string, number>();
  model.workers.forEach((w, wi) => minutes.set(w.id, model.existingMinutes[wi]));
  for (const e of kept) minutes.set(e.workerId, (minutes.get(e.workerId) ?? 0) + e.end - e.start);
  model.slots.forEach((slot, si) => {
    const order = [...model.workers].sort((a, b) => (minutes.get(a.id) ?? 0) - (minutes.get(b.id) ?? 0));
    for (const worker of order) {
      if ((counts.get(si) ?? 0) >= slot.required) break;
      if (tryAdd({ date: slot.date, templateId: slot.template.id, workerId: worker.id })) {
        minutes.set(worker.id, (minutes.get(worker.id) ?? 0) + slot.minutes);
      }
    }
  });

  const roster = model.existing.concat(kept);
  const unassigned: CoverageShortfall[] = [];
  model.slots.forEach((slot, si) => {
    const count = counts.get(si) ?? 0;
    if (count >= slot.required) return;
    const ctx = model.contexts.get(slot.date) as CheckContext;
    const reasonCode = shortfallReason(slot.template, model.workers, roster, ctx);
    unassigned.push({
      templateId: slot.template.id,
      date: slot.date,
      required: slot.required,
      assigned: count,
      missing: slot.required - count,
      reasonCode,
      reason: describeReason(reasonCode, slot.template, slot.date),
    });
  });

  const assignments = kept
    .map((e) => ({ e, si: slotOf(e) }))
    .sort((a, b) => a.si - b.si)
    .map(({ e }) => ({ date: e.date, templateId: e.templateId, workerId: e.workerId }));
  return { assignments, unassigned, dropped };
}

// ─── Main export ──────────────────────────────────────────────────────────────

const PROVEN = 'Optimal';

export async function optimizeAssignments(
  input: OptimizeInput,
  options: OptimizeOptions = {},
): Promise<OptimizedAssignmentResult> {
  const now = options.now ?? (() => Date.now());
  const budget = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const greedy = greedyAssign(input);
  const model = buildAssignmentModel(input);
  const greedyScore = scoreSchedule(model, greedy.assignments);
  const report: SolverReport = {
    engine: 'greedy',
    stages: [],
    optimal: false,
    solveMs: 0,
    score: greedyScore,
    greedyScore,
    variables: model.candidates.length,
    constraints: model.rows.length,
    dropped: 0,
  };
  const greedyResult = (reason: FallbackReason, error?: string): OptimizedAssignmentResult => ({
    ...greedy,
    solver: { ...report, fallbackReason: reason, ...(error ? { error } : {}) },
  });

  if (!options.solver) return greedyResult('no_solver');
  if (model.candidates.length === 0) {
    // Nothing to decide: the greedy's (empty) schedule is optimal.
    return { ...greedy, solver: { ...report, engine: 'ilp', optimal: true } };
  }

  const solver = options.solver;
  const started = now();
  const proposals: AssignedShift[][] = [];
  let lastError: string | undefined;
  let optimal = true;

  const runStage = async (stage: Stage, share: number): Promise<Record<string, number> | null> => {
    const remaining = budget - (now() - started);
    if (remaining < 25) return null;
    const limit = Math.max(25, remaining * share);
    const t0 = now();
    try {
      const solution = await solver(buildLp(model, stage), { timeLimitSeconds: limit / 1000 });
      report.stages.push({ kind: stage.kind, status: solution.status, ms: now() - t0 });
      if (!solution.values) {
        optimal = false;
        return null;
      }
      if (solution.status !== PROVEN) optimal = false;
      return solution.values;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      report.stages.push({ kind: stage.kind, status: 'error', ms: now() - t0 });
      optimal = false;
      return null;
    }
  };

  const coverage = await runStage({ kind: 'coverage' }, model.groups.length > 0 ? 0.5 : 1);
  if (coverage) {
    const first = decodeSolution(model, coverage);
    proposals.push(first);
    const minCoverage = first.length;
    const hasContinuity = model.candidates.some((c) => c.continuity > 0);
    let previous = first;
    if (model.groups.length > 0) {
      const fair = await runStage({ kind: 'fairness', minCoverage }, hasContinuity ? 0.7 : 1);
      if (fair) {
        previous = decodeSolution(model, fair);
        proposals.push(previous);
      }
    }
    if (hasContinuity) {
      const maxSpread = model.groups.length > 0 ? scoreSchedule(model, previous).spreadMinutes + 1 : 0;
      const cont = await runStage({ kind: 'continuity', minCoverage, maxSpread }, 1);
      if (cont) proposals.push(decodeSolution(model, cont));
    }
  }
  report.solveMs = now() - started;
  report.optimal = optimal && report.stages.length > 0;

  if (proposals.length === 0) {
    return lastError ? greedyResult('solver_error', lastError) : greedyResult('no_solution');
  }

  let best: AssignmentResult | null = null;
  let bestScore: ScheduleScore | null = null;
  for (const proposal of proposals) {
    const { dropped, ...result } = finalizeSchedule(model, proposal);
    report.dropped += dropped;
    const score = scoreSchedule(model, result.assignments);
    if (!bestScore || compareScores(score, bestScore) <= 0) {
      best = result;
      bestScore = score;
    }
  }
  if (!best || !bestScore || compareScores(bestScore, greedyScore) > 0) return greedyResult('greedy_better');
  return { ...best, solver: { ...report, engine: 'ilp', score: bestScore } };
}
