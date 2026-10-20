/**
 * Integer-programming model of the shift-assignment problem (CHG-085).
 *
 * Pure module: builds the model and its CPLEX LP text, scores schedules. Solving
 * happens elsewhere (services/optimizer/shiftOptimizer.ts with HiGHS).
 *
 * Sets
 *   W  workers, S  slots (one per run date × template, needing `coverage` workers)
 *   P  candidate pairs (w, s) that pass every single-shift hard constraint against the
 *      existing roster: role, availability, overlap, rest, and daily / weekly hours
 *      (`checkEligibility` from the greedy, so both engines share one definition).
 *
 * Variables
 *   x[w,s] ∈ {0,1} for (w,s) ∈ P: worker w takes one position of slot s.
 *   d[g] ≥ 0 per role group g (stage 2 and 3 only): the group's largest deviation from
 *          its mean hours, in minutes.
 *
 * Hard constraints (the same as the greedy's)
 *   cov[s]:  Σ_w x[w,s] ≤ required(s)
 *   clq:     for each worker, every maximal clique of mutually conflicting slots, where
 *            two slots conflict when they overlap or the gap between them is under the
 *            minimum rest: Σ x ≤ 1. Conflicts form an interval graph on the intervals
 *            [start, end + minRest), so the maximal cliques are the sets of slots whose
 *            extended interval contains some slot's start.
 *   day:     Σ_{s on day} minutes(s) · x[w,s] ≤ 60 · maxDailyHours − existing minutes
 *   wk:      Σ_{s in ISO week} minutes(s) · x[w,s] ≤ 60 · maxWeeklyHours − existing minutes
 *   (rows that can never bind are left out)
 *
 * Objective: lexicographic, solved as three stages (see shiftOptimizer):
 *   1. coverage    maximize Σ x
 *   2. fairness    minimize Σ_g d[g] subject to Σ x ≥ stage-1 coverage, where for each
 *                  role group g (workers of one role with at least one candidate) and
 *                  each member w: |H[w] − mean_g(H)| ≤ d[g], H[w] being the worker's
 *                  minutes in the run's ISO weeks (existing roster + new shifts).
 *                  The mean is linear in x, so both sides stay linear:
 *                  n·H[w] − Σ_v H[v] ≤ n·d[g] and Σ_v H[v] − n·H[w] ≤ n·d[g].
 *   3. continuity  maximize Σ c[w,s]·x[w,s] subject to stages 1 and 2, where c is 2 when
 *                  the existing roster has w on the same template on the same weekday,
 *                  1 when on the same template another day, else 0. Skipped when every
 *                  c is 0. Workers carry no preference data yet, so this is the only
 *                  soft preference.
 */
import {
  buildCatalog,
  buildCheckContext,
  checkEligibility,
  getWeekBounds,
  requiredSlots,
  resolveRoster,
  shiftInterval,
  timelineFor,
  type AssignedShift,
  type AssignmentInput,
  type CheckContext,
  type Entry,
  type Timeline,
} from '@/services/shiftAssigner';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';
import { weekdayOfKey } from '@/utils/dateKeys';

// ─── Types ────────────────────────────────────────────────────────────────────

/** An assignment input that may span several dates (default: `[date]`). */
export type OptimizeInput = AssignmentInput & {
  /** Dates to assign together (each gets every template). Defaults to `[date]`. */
  dates?: string[];
};

export type Slot = {
  date: string;
  template: ShiftTemplate;
  required: number;
  start: number;
  end: number;
  minutes: number;
};

export type Candidate = {
  name: string;
  worker: number;
  slot: number;
  continuity: number;
};

export type Term = [coefficient: number, variable: string];

export type Row = {
  name: string;
  terms: Term[];
  sense: '<=' | '>=';
  rhs: number;
};

export type RoleGroup = { role: string; name: string; members: number[] };

export type AssignmentModel = {
  input: OptimizeInput;
  dates: string[];
  workers: Worker[];
  slots: Slot[];
  candidates: Candidate[];
  /** Hard-constraint rows (coverage, cliques, daily and weekly hours). */
  rows: Row[];
  groups: RoleGroup[];
  /** Minutes each worker already has in the run's ISO weeks. */
  existingMinutes: number[];
  existing: Entry[];
  contexts: Map<string, CheckContext>;
  at: Timeline;
};

export type Stage =
  | { kind: 'coverage' }
  | { kind: 'fairness'; minCoverage: number }
  | { kind: 'continuity'; minCoverage: number; maxSpread: number };

/** Lexicographic schedule quality: more coverage, then a smaller spread, then more continuity. */
export type ScheduleScore = {
  /** Positions filled. */
  filled: number;
  /** Σ over role groups of the largest |hours − group mean|, in minutes. */
  spreadMinutes: number;
  continuity: number;
};

// ─── Model building ───────────────────────────────────────────────────────────

const slotKey = (date: string, templateId: string): string => `${date}|${templateId}`;

/** Run dates: `dates` when given (deduplicated, sorted), else `[date]`. */
export const runDates = (input: OptimizeInput): string[] =>
  input.dates && input.dates.length > 0 ? [...new Set(input.dates)].sort() : [input.date];

export function buildAssignmentModel(input: OptimizeInput): AssignmentModel {
  const at = timelineFor(input);
  const dates = runDates(input);
  const catalog = buildCatalog(input);
  const existing = resolveRoster(input.existingRoster, catalog, at);
  const constraints = input.constraints;
  const contexts = new Map(dates.map((d) => [d, buildCheckContext(d, constraints, at)]));

  const templates: ShiftTemplate[] = [];
  const seen = new Set<string>();
  for (const t of input.templates) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    templates.push(t);
  }

  const slots: Slot[] = [];
  for (const date of dates) {
    for (const template of templates) {
      const { start, end } = shiftInterval(template, date, at);
      slots.push({ date, template, required: requiredSlots(template), start, end, minutes: end - start });
    }
  }

  const workers = input.workers;
  const weekStarts = new Set(dates.map((d) => getWeekBounds(d).weekStart));
  const inRunWeeks = (date: string): boolean => weekStarts.has(getWeekBounds(date).weekStart);
  const workerIndex = new Map(workers.map((w, i) => [w.id, i]));
  const existingMinutes = workers.map(() => 0);
  const history = new Map<string, number>(); // worker|template|weekday → 2, worker|template → 1
  for (const e of existing) {
    const wi = workerIndex.get(e.workerId);
    if (wi === undefined) continue;
    if (inRunWeeks(e.date)) existingMinutes[wi] += e.end - e.start;
    history.set(`${e.workerId}|${e.templateId}|${weekdayOfKey(e.date)}`, 2);
    if (!history.has(`${e.workerId}|${e.templateId}`)) history.set(`${e.workerId}|${e.templateId}`, 1);
  }

  const candidates: Candidate[] = [];
  slots.forEach((slot, si) => {
    const ctx = contexts.get(slot.date) as CheckContext;
    workers.forEach((worker, wi) => {
      if (checkEligibility(worker, slot.template, existing, ctx) !== null) return;
      const continuity =
        history.get(`${worker.id}|${slot.template.id}|${weekdayOfKey(slot.date)}`) ??
        history.get(`${worker.id}|${slot.template.id}`) ??
        0;
      candidates.push({ name: `x${wi}_${si}`, worker: wi, slot: si, continuity });
    });
  });

  const rows: Row[] = [];
  const bySlot = new Map<number, Candidate[]>();
  const byWorker = new Map<number, Candidate[]>();
  for (const c of candidates) {
    (bySlot.get(c.slot) ?? bySlot.set(c.slot, []).get(c.slot)!).push(c);
    (byWorker.get(c.worker) ?? byWorker.set(c.worker, []).get(c.worker)!).push(c);
  }

  // Coverage: at most `required` workers per slot.
  slots.forEach((slot, si) => {
    const cs = bySlot.get(si) ?? [];
    if (cs.length > slot.required) {
      rows.push({ name: `cov${si}`, terms: cs.map((c) => [1, c.name]), sense: '<=', rhs: slot.required });
    }
  });

  const restMinutes = (constraints?.minRestHoursBetweenShifts ?? 0) * 60;
  const existingFor = (workerId: string, keep: (e: Entry) => boolean): number =>
    existing.reduce((sum, e) => (e.workerId === workerId && keep(e) ? sum + e.end - e.start : sum), 0);

  for (const [wi, cs] of byWorker) {
    const worker = workers[wi];
    // Overlap + rest cliques.
    const sorted = [...cs].sort((a, b) => slots[a.slot].start - slots[b.slot].start);
    const cliques = new Set<string>();
    for (const anchor of sorted) {
      const p = slots[anchor.slot].start;
      const members = sorted.filter((c) => slots[c.slot].start <= p && p < slots[c.slot].end + restMinutes);
      if (members.length < 2) continue;
      const key = members.map((c) => c.name).join(',');
      if (cliques.has(key)) continue;
      cliques.add(key);
      rows.push({ name: `clq${wi}_${cliques.size - 1}`, terms: members.map((c) => [1, c.name]), sense: '<=', rhs: 1 });
    }

    // Daily hours (by start date).
    if (constraints?.maxDailyHours !== undefined) {
      const cap = constraints.maxDailyHours * 60;
      dates.forEach((date, di) => {
        const day = cs.filter((c) => slots[c.slot].date === date);
        const total = day.reduce((sum, c) => sum + slots[c.slot].minutes, 0);
        const room = cap - existingFor(worker.id, (e) => e.date === date);
        if (day.length > 1 && total > room) {
          rows.push({ name: `day${wi}_${di}`, terms: day.map((c) => [slots[c.slot].minutes, c.name]), sense: '<=', rhs: room });
        }
      });
    }

    // Weekly hours (ISO week of the start date).
    if (constraints?.maxWeeklyHours !== undefined) {
      const cap = constraints.maxWeeklyHours * 60;
      [...weekStarts].sort().forEach((weekStart, ki) => {
        const week = cs.filter((c) => getWeekBounds(slots[c.slot].date).weekStart === weekStart);
        const total = week.reduce((sum, c) => sum + slots[c.slot].minutes, 0);
        const { weekEnd } = getWeekBounds(weekStart);
        const room = cap - existingFor(worker.id, (e) => e.date >= weekStart && e.date <= weekEnd);
        if (week.length > 1 && total > room) {
          rows.push({ name: `wk${wi}_${ki}`, terms: week.map((c) => [slots[c.slot].minutes, c.name]), sense: '<=', rhs: room });
        }
      });
    }
  }

  // Role groups for fairness: workers of a role who can take at least one slot.
  const groupMembers = new Map<string, number[]>();
  for (const wi of [...byWorker.keys()].sort((a, b) => a - b)) {
    const role = workers[wi].role;
    (groupMembers.get(role) ?? groupMembers.set(role, []).get(role)!).push(wi);
  }
  const groups: RoleGroup[] = [...groupMembers.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([role, members], gi) => ({ role, name: `d${gi}`, members }));

  return { input, dates, workers, slots, candidates, rows, groups, existingMinutes, existing, contexts, at };
}

// ─── LP text ──────────────────────────────────────────────────────────────────

const fmtNumber = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(6));

const fmtTerms = (terms: Term[]): string => {
  if (terms.length === 0) return '0 x_none';
  const parts = terms.map(([c, v], i) => {
    const sign = c < 0 ? '-' : i === 0 ? '' : '+';
    const abs = Math.abs(c);
    return `${sign}${sign ? ' ' : ''}${abs === 1 ? '' : `${fmtNumber(abs)} `}${v}`;
  });
  // Keep lines short; the LP format lets an expression continue on the next line.
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 10) lines.push(parts.slice(i, i + 10).join(' '));
  return lines.join('\n   ');
};

const fmtRow = (row: Row): string => ` ${row.name}: ${fmtTerms(row.terms)} ${row.sense} ${fmtNumber(row.rhs)}`;

/** Fairness rows: n·H[w] − Σ_v H[v] ≤ n·d[g] and Σ_v H[v] − n·H[w] ≤ n·d[g]. */
export function fairnessRows(model: AssignmentModel): Row[] {
  const rows: Row[] = [];
  const byWorker = new Map<number, Candidate[]>();
  for (const c of model.candidates) (byWorker.get(c.worker) ?? byWorker.set(c.worker, []).get(c.worker)!).push(c);
  const minutes = (c: Candidate): number => model.slots[c.slot].minutes;
  for (const group of model.groups) {
    const n = group.members.length;
    const existingSum = group.members.reduce((sum, wi) => sum + model.existingMinutes[wi], 0);
    for (const wi of group.members) {
      // Σ_v X[v] with coefficient −1, plus n·X[w] (so w's own terms get n − 1).
      const coef = new Map<string, number>();
      for (const v of group.members) {
        for (const c of byWorker.get(v) ?? []) coef.set(c.name, (v === wi ? n - 1 : -1) * minutes(c));
      }
      const terms: Term[] = [...coef.entries()].filter(([, k]) => k !== 0).map(([v, k]) => [k, v]);
      const constant = n * model.existingMinutes[wi] - existingSum; // moves to the right-hand side
      rows.push({ name: `fp${wi}`, terms: [...terms, [-n, group.name]], sense: '<=', rhs: -constant });
      rows.push({ name: `fm${wi}`, terms: [...terms.map(([k, v]): Term => [-k, v]), [-n, group.name]], sense: '<=', rhs: constant });
    }
  }
  return rows;
}

/** CPLEX LP text for one stage of the lexicographic objective. */
export function buildLp(model: AssignmentModel, stage: Stage): string {
  const xs = model.candidates.map((c) => c.name);
  const rows = [...model.rows];
  let objective: string;
  if (stage.kind === 'coverage') {
    objective = `Maximize\n obj: ${fmtTerms(xs.map((v): Term => [1, v]))}`;
  } else {
    rows.push(...fairnessRows(model));
    rows.push({ name: 'covmin', terms: xs.map((v): Term => [1, v]), sense: '>=', rhs: stage.minCoverage });
    const ds = model.groups.map((g): Term => [1, g.name]);
    if (stage.kind === 'fairness') {
      objective = `Minimize\n obj: ${ds.length > 0 ? fmtTerms(ds) : '0 x_none'}`;
    } else {
      if (ds.length > 0) rows.push({ name: 'spreadmax', terms: ds, sense: '<=', rhs: stage.maxSpread });
      const cs = model.candidates.filter((c) => c.continuity > 0).map((c): Term => [c.continuity, c.name]);
      objective = `Maximize\n obj: ${cs.length > 0 ? fmtTerms(cs) : '0 x_none'}`;
    }
  }
  const lines = [objective, 'Subject To', ...rows.map(fmtRow), 'Bounds'];
  if (stage.kind !== 'coverage') for (const g of model.groups) lines.push(` ${g.name} >= 0`);
  lines.push('Binary');
  for (let i = 0; i < xs.length; i += 20) lines.push(` ${xs.slice(i, i + 20).join(' ')}`);
  lines.push('End');
  return lines.join('\n');
}

// ─── Solutions and scores ─────────────────────────────────────────────────────

/** Assignments chosen by a solver's column values (x > 0.5), in slot then worker order. */
export function decodeSolution(model: AssignmentModel, values: Record<string, number>): AssignedShift[] {
  return model.candidates
    .filter((c) => (values[c.name] ?? 0) > 0.5)
    .sort((a, b) => a.slot - b.slot || a.worker - b.worker)
    .map((c) => ({ date: model.slots[c.slot].date, templateId: model.slots[c.slot].template.id, workerId: model.workers[c.worker].id }));
}

/** Scores any schedule for the model's slots with the same measure the ILP optimizes. */
export function scoreSchedule(model: AssignmentModel, assignments: AssignedShift[]): ScheduleScore {
  const slotIndex = new Map(model.slots.map((s, i) => [slotKey(s.date, s.template.id), i]));
  const workerIndex = new Map(model.workers.map((w, i) => [w.id, i]));
  const continuity = new Map(model.candidates.map((c) => [`${c.worker}|${c.slot}`, c.continuity]));
  const minutes = [...model.existingMinutes];
  let filled = 0;
  let cont = 0;
  for (const a of assignments) {
    const si = slotIndex.get(slotKey(a.date, a.templateId));
    const wi = workerIndex.get(a.workerId);
    if (si === undefined || wi === undefined) continue;
    filled += 1;
    minutes[wi] += model.slots[si].minutes;
    cont += continuity.get(`${wi}|${si}`) ?? 0;
  }
  let spread = 0;
  for (const group of model.groups) {
    const mean = group.members.reduce((sum, wi) => sum + minutes[wi], 0) / group.members.length;
    spread += Math.max(...group.members.map((wi) => Math.abs(minutes[wi] - mean)));
  }
  return { filled, spreadMinutes: spread, continuity: cont };
}

/** Negative when `a` is better than `b`, positive when worse, 0 when equal (lexicographic). */
export function compareScores(a: ScheduleScore, b: ScheduleScore): number {
  if (a.filled !== b.filled) return b.filled - a.filled;
  if (Math.abs(a.spreadMinutes - b.spreadMinutes) > 0.5) return a.spreadMinutes - b.spreadMinutes;
  return b.continuity - a.continuity;
}
