/**
 * Property-based fuzz test for `assignShifts`.
 *
 * Generates thousands of random scheduling problems (seeded, deterministic) including
 * overnight templates, overnight availability, existing roster entries on adjacent days
 * whose templates are only in the catalog, and random labor constraints. Every output is
 * checked against invariants computed by an INDEPENDENT reference model in this file
 * (minute bitmaps for availability, absolute intervals for overlap/rest), not by the
 * engine's own helpers.
 *
 * Invariants:
 *   I1  every assignment is for the input date, a requested template and a known worker
 *   I2  worker role === template role
 *   I3  worker availability (prev/same/next weekday, overnight slots, 23:59 = 24:00)
 *       covers every minute of the shift
 *   I4  no two shifts of a worker overlap (new vs new and new vs existing, across midnight)
 *   I5  min rest between every new shift and every other shift of the worker (when set)
 *   I6  daily / ISO-weekly hours (attributed to the start date) within limits (when set)
 *   I7  per template: assigned + missing === required, assigned <= required, and the
 *       shortfall entry exists iff assigned < required, with consistent numbers
 *   I8  no open slot while some worker could still legally take it (greedy completeness)
 *
 * The same invariants are checked on the ILP optimizer's output (CHG-085, real HiGHS),
 * which must also cover at least as many positions as the greedy, and exactly as many
 * as a brute-force search finds on small cases.
 *
 * A third ILP run covers multi-date models (`dates[]`, CHG-087): the same hard
 * constraints checked order-independently, plus "never worse than the greedy".
 *
 * The suite runs twice: with the deprecated fixed offset (every day 24h), and with a
 * random IANA zone on dates around DST changes. In the zoned run the reference model
 * places wall times with `zonedToUtc` (tested on its own in utils/__tests__/zonedTime)
 * and measures everything in elapsed minutes.
 */
import { assignShifts, type AssignmentInput, type AssignmentResult, type LaborConstraints } from '../shiftAssigner';
import { createHighsSolver, type HighsModule } from '../optimizer/highsSolver';
import { compareScores } from '../optimizer/assignmentModel';
import { greedyAssign, optimizeAssignments } from '../optimizer/shiftOptimizer';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import { getWeekdayFromDate } from '@/utils/schedulerUtils';
import { zonedToUtc } from '@/utils/zonedTime';

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

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

type Rng = () => number;
const int = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(rng: Rng, items: T[]): T => items[Math.floor(rng() * items.length)];
const chance = (rng: Rng, p: number): boolean => rng() < p;

// ─── Reference time model (independent of the engine) ───────────────────────

const DAY = 1440;
const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fmt = (minutes: number): string => {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const dayNumber = (date: string): number => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;
const addDays = (date: string, n: number): string => new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
const durationOf = (t: ShiftTemplate): number => {
  const d = (toMin(t.end) - toMin(t.start) + DAY) % DAY;
  return d === 0 ? DAY : d;
};
/** Reference wall-clock → absolute minutes: fixed 24h days, or an IANA zone. */
type Clock = { key: string; abs: (date: string, minutes: number) => number };
const FIXED_CLOCK: Clock = { key: 'fixed', abs: (date, minutes) => dayNumber(date) * DAY + minutes };
const zoneCache = new Map<string, number>();
const zoneClock = (timeZone: string): Clock => ({
  key: timeZone,
  abs: (date, minutes) => {
    const k = `${timeZone}|${date}|${minutes}`;
    let v = zoneCache.get(k);
    if (v === undefined) {
      v = Math.round(zonedToUtc(date, minutes, timeZone) / 60_000);
      zoneCache.set(k, v);
    }
    return v;
  },
});
const clockOf = (input: AssignmentInput): Clock => (input.timeZone ? zoneClock(input.timeZone) : FIXED_CLOCK);

/**
 * Reference span of local [from, from + length) on `date`. A span the DST gap makes zero or
 * negative moves to after the gap with its wall-clock length (CHG-087).
 */
const absSpan = (date: string, from: number, length: number, clock: Clock) => {
  const start = clock.abs(date, from);
  const end = clock.abs(date, from + length);
  return { start, end: end <= start ? start + length : end };
};
const absInterval = (t: ShiftTemplate, date: string, clock: Clock) => absSpan(date, toMin(t.start), durationOf(t), clock);
const isoWeekKey = (date: string): number => {
  const n = dayNumber(date);
  // 1970-01-01 was a Thursday → Monday-based week index
  return Math.floor((n + 3) / 7);
};
const requiredOf = (t: ShiftTemplate): number =>
  Number.isFinite(t.coverage) && t.coverage >= 1 ? Math.round(t.coverage) : 1;

/** Availability bitmap over the elapsed minutes of [D-1 00:00, D+2 00:00) local. */
const availabilityBitmap = (worker: Worker, date: string, clock: Clock): { origin: number; bits: Uint8Array } => {
  const origin = clock.abs(addDays(date, -1), 0);
  const bits = new Uint8Array(clock.abs(addDays(date, 2), 0) - origin);
  for (let k = -1; k <= 1; k++) {
    const day = addDays(date, k);
    const label = getWeekdayFromDate(day);
    for (const slot of worker.availability) {
      if (slot.day !== label) continue;
      const from = toMin(slot.from);
      let to = toMin(slot.to);
      if (to === DAY - 1) to = DAY;
      if (to <= from) to += DAY;
      const span = absSpan(day, from, to - from, clock);
      const end = Math.min(span.end - origin, bits.length);
      for (let m = span.start - origin; m < end; m++) bits[m] = 1;
    }
  }
  return { origin, bits };
};

const bitmapCache = new WeakMap<Worker, { key: string; origin: number; bits: Uint8Array }>();
const covers = (worker: Worker, t: ShiftTemplate, date: string, clock: Clock): boolean => {
  const key = `${date}|${clock.key}`;
  let cached = bitmapCache.get(worker);
  if (!cached || cached.key !== key) {
    cached = { key, ...availabilityBitmap(worker, date, clock) };
    bitmapCache.set(worker, cached);
  }
  const { origin, bits } = cached;
  const iv = absInterval(t, date, clock);
  for (let m = iv.start - origin; m < iv.end - origin; m++) if (!bits[m]) return false;
  return true;
};

type RefEntry = { workerId: string; date: string; start: number; end: number; isNew: boolean };

/** Reference check: could `worker` legally take `t` on `date` given `entries`? */
const legal = (
  worker: Worker,
  t: ShiftTemplate,
  date: string,
  entries: RefEntry[],
  clock: Clock,
  c: LaborConstraints | undefined
): boolean => {
  if (worker.role !== t.role) return false;
  if (!covers(worker, t, date, clock)) return false;
  const iv = absInterval(t, date, clock);
  const mine = entries.filter((e) => e.workerId === worker.id);
  if (mine.some((e) => e.start < iv.end && iv.start < e.end)) return false;
  const dur = iv.end - iv.start;
  if (c?.maxDailyHours !== undefined) {
    const day = mine.filter((e) => e.date === date).reduce((s, e) => s + e.end - e.start, 0);
    if (day + dur > c.maxDailyHours * 60) return false;
  }
  if (c?.maxWeeklyHours !== undefined) {
    const wk = isoWeekKey(date);
    const week = mine.filter((e) => isoWeekKey(e.date) === wk).reduce((s, e) => s + e.end - e.start, 0);
    if (week + dur > c.maxWeeklyHours * 60) return false;
  }
  if (c?.minRestHoursBetweenShifts !== undefined) {
    const rest = c.minRestHoursBetweenShifts * 60;
    if (mine.some((e) => (e.end <= iv.start ? iv.start - e.end : e.start - iv.end) < rest)) return false;
  }
  return true;
};

// ─── Case generator ──────────────────────────────────────────────────────────

const ROLES = ['Cook', 'Server'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BASE_DATE = '2026-03-23';
const TZ = 0;

const randomTime = (rng: Rng): string => fmt(int(rng, 0, 47) * 30);

const randomTemplate = (rng: Rng, id: string): ShiftTemplate => {
  const start = int(rng, 0, 23) * 60 + (chance(rng, 0.2) ? 30 : 0);
  const duration = int(rng, 2, 12) * 60;
  const coverageRoll = rng();
  const coverage = coverageRoll < 0.05 ? 0 : coverageRoll < 0.08 ? Number.NaN : int(rng, 1, 3);
  return { id, name: id, role: pick(rng, ROLES), start: fmt(start), end: fmt(start + duration), coverage };
};

const randomWorker = (rng: Rng, id: string, date: string): Worker => {
  const target = getWeekdayFromDate(date, TZ) ?? 'Mon';
  const targetIdx = WEEKDAYS.indexOf(target);
  const slots = int(rng, 0, 3);
  const availability = [];
  for (let i = 0; i < slots; i++) {
    // Bias towards the target weekday and its neighbours.
    const day = chance(rng, 0.8) ? WEEKDAYS[(targetIdx + int(rng, -1, 1) + 7) % 7] : pick(rng, WEEKDAYS);
    const roll = rng();
    const from = roll < 0.15 ? '00:00' : randomTime(rng);
    const to = roll < 0.3 ? '23:59' : roll < 0.4 ? '00:00' : randomTime(rng);
    availability.push({ day, from, to });
  }
  return { id, displayId: id, name: id, role: pick(rng, ROLES), skills: [], availability };
};

const randomConstraints = (rng: Rng): LaborConstraints | undefined => {
  if (chance(rng, 0.4)) return undefined;
  const c: LaborConstraints = {};
  if (chance(rng, 0.5)) c.maxDailyHours = int(rng, 6, 14);
  if (chance(rng, 0.5)) c.maxWeeklyHours = int(rng, 10, 48);
  if (chance(rng, 0.6)) c.minRestHoursBetweenShifts = pick(rng, [8, 11, 12]);
  return c;
};

/**
 * Zones for the zoned run (DST north and south, no DST, a non-hour offset) with the
 * 2026 dates their clocks change; zones without DST borrow the others' dates.
 */
const US_EU_AU = ['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25', '2026-04-05', '2026-10-04'];
const ZONE_DATES: Record<string, string[]> = {
  'America/New_York': ['2026-03-08', '2026-11-01'],
  'Europe/Madrid': ['2026-03-29', '2026-10-25'],
  'Australia/Sydney': ['2026-04-05', '2026-10-04'],
  'America/Lima': US_EU_AU,
  'Asia/Kolkata': US_EU_AU,
  UTC: US_EU_AU,
};
const ZONES = Object.keys(ZONE_DATES);

const generateCase = (seed: number, zoned = false): AssignmentInput => {
  const rng = mulberry32(seed);
  const timeZone = zoned ? pick(rng, ZONES) : undefined;
  // Zoned: mostly the change day or the day before (night shifts across the change).
  const date = timeZone
    ? addDays(pick(rng, ZONE_DATES[timeZone]), chance(rng, 0.7) ? int(rng, -1, 0) : int(rng, -4, 3))
    : addDays(BASE_DATE, int(rng, 0, 13));
  const templates = Array.from({ length: int(rng, 1, 5) }, (_, i) => randomTemplate(rng, `t${i}`));
  const extra = Array.from({ length: int(rng, 0, 3) }, (_, i) => randomTemplate(rng, `x${i}`));
  const workers = Array.from({ length: int(rng, 1, 7) }, (_, i) => randomWorker(rng, `w${i}`, date));
  const catalog = [...templates, ...extra];
  const existingRoster: Shift[] = Array.from({ length: int(rng, 0, 6) }, (_, i) => ({
    id: `e${i}`,
    date: addDays(date, int(rng, -2, 2)),
    workerId: pick(rng, workers).id,
    // Mostly catalog-only templates so A6 (catalog visibility) is exercised.
    templateId: (chance(rng, 0.7) && extra.length > 0 ? pick(rng, extra) : pick(rng, catalog)).id,
    location: 'HQ',
    status: 'Published',
    notified: false,
  }));
  return {
    date,
    templates,
    templateCatalog: catalog,
    workers,
    existingRoster,
    ...(timeZone ? { timeZone } : { timezoneOffsetMinutes: TZ }),
    constraints: randomConstraints(rng),
  };
};

// ─── Invariant checker ───────────────────────────────────────────────────────

const checkInvariants = (input: AssignmentInput, result: AssignmentResult): string[] => {
  const errors: string[] = [];
  const { date, templates, workers, existingRoster, constraints } = input;
  const clock = clockOf(input);
  const catalog = new Map((input.templateCatalog ?? templates).map((t) => [t.id, t]));

  const existing: RefEntry[] = existingRoster.flatMap((s) => {
    const t = catalog.get(s.templateId);
    return t ? [{ workerId: s.workerId, date: s.date, ...absInterval(t, s.date, clock), isNew: false }] : [];
  });
  const fresh: RefEntry[] = [];

  // I1–I3
  for (const a of result.assignments) {
    const t = templates.find((x) => x.id === a.templateId);
    const w = workers.find((x) => x.id === a.workerId);
    if (a.date !== date || !t || !w) {
      errors.push(`I1 bad assignment ${JSON.stringify(a)}`);
      continue;
    }
    if (w.role !== t.role) errors.push(`I2 role mismatch ${w.id}/${t.id}`);
    if (!covers(w, t, date, clock)) errors.push(`I3 availability ${w.id} does not cover ${t.id} ${t.start}-${t.end}`);
    fresh.push({ workerId: w.id, date, ...absInterval(t, date, clock), isNew: true });
  }

  // I4–I6
  const all = existing.concat(fresh);
  fresh.forEach((n, idx) => {
    const others = all.filter((e) => e.workerId === n.workerId && e !== n);
    for (const o of others) {
      if (o.start < n.end && n.start < o.end) errors.push(`I4 overlap for ${n.workerId} (new #${idx})`);
      else if (constraints?.minRestHoursBetweenShifts !== undefined) {
        const gap = o.end <= n.start ? n.start - o.end : o.start - n.end;
        if (gap < constraints.minRestHoursBetweenShifts * 60) errors.push(`I5 rest ${gap}min for ${n.workerId}`);
      }
    }
    const mine = all.filter((e) => e.workerId === n.workerId);
    if (constraints?.maxDailyHours !== undefined) {
      const day = mine.filter((e) => e.date === date).reduce((s, e) => s + e.end - e.start, 0);
      if (day > constraints.maxDailyHours * 60) errors.push(`I6 daily ${day}min for ${n.workerId}`);
    }
    if (constraints?.maxWeeklyHours !== undefined) {
      const wk = isoWeekKey(date);
      const week = mine.filter((e) => isoWeekKey(e.date) === wk).reduce((s, e) => s + e.end - e.start, 0);
      if (week > constraints.maxWeeklyHours * 60) errors.push(`I6 weekly ${week}min for ${n.workerId}`);
    }
  });

  // I7–I8
  for (const t of templates) {
    const required = requiredOf(t);
    const count = result.assignments.filter((a) => a.templateId === t.id).length;
    const shortfalls = result.unassigned.filter((u) => u.templateId === t.id);
    const missing = shortfalls.reduce((s, u) => s + u.missing, 0);
    if (count + missing !== required) errors.push(`I7 ${t.id}: assigned ${count} + missing ${missing} != required ${required}`);
    if (count > required) errors.push(`I7 ${t.id}: over-assigned ${count}/${required}`);
    if ((count < required) !== (shortfalls.length === 1)) errors.push(`I7 ${t.id}: shortfall entry mismatch`);
    for (const s of shortfalls) {
      if (s.assigned !== count || s.required !== required || s.date !== date || s.missing < 1 || !s.reasonCode) {
        errors.push(`I7 ${t.id}: inconsistent shortfall ${JSON.stringify(s)}`);
      }
    }
    if (count < required) {
      const taker = workers.find((w) => legal(w, t, date, all, clock, constraints));
      if (taker) errors.push(`I8 ${t.id} left open although ${taker.id} could take it`);
    }
  }
  return errors;
};

// ─── The property test ───────────────────────────────────────────────────────

const CASES = 5000;
const ZONED_CASES = 3000;

describe('assignShifts — property-based fuzz', () => {
  it(`holds all invariants over ${CASES} random cases (incl. overnight shifts)`, () => {
    const failures: string[] = [];
    let overnightTemplates = 0;
    let shortfallCases = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const input = generateCase(seed);
      overnightTemplates += input.templates.filter((t) => toMin(t.end) <= toMin(t.start)).length;
      const result = assignShifts(input);
      const errors = checkInvariants(input, result);
      if (result.unassigned.length > 0) shortfallCases++;
      if (errors.length > 0) failures.push(`seed ${seed}: ${errors.slice(0, 3).join('; ')}`);
    }
    // Sanity: the generator really exercises overnight shifts and shortfalls.
    expect(overnightTemplates).toBeGreaterThan(CASES / 4);
    expect(shortfallCases).toBeGreaterThan(CASES / 10);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it(`holds all invariants over ${ZONED_CASES} random cases in IANA zones around DST changes`, () => {
    const failures: string[] = [];
    const zones = new Set<string>();
    let dstLengthShifts = 0;
    for (let seed = 1; seed <= ZONED_CASES; seed++) {
      const input = generateCase(100_000 + seed, true);
      const clock = clockOf(input);
      zones.add(input.timeZone ?? '');
      for (const t of input.templates) {
        const iv = absInterval(t, input.date, clock);
        if (iv.end - iv.start !== durationOf(t)) dstLengthShifts++;
      }
      const result = assignShifts(input);
      const errors = checkInvariants(input, result);
      if (errors.length > 0) failures.push(`seed ${100_000 + seed} (${input.timeZone} ${input.date}): ${errors.slice(0, 3).join('; ')}`);
    }
    // Sanity: every zone is drawn and some shifts really are 23h-day / 25h-day lengths.
    expect(zones.size).toBe(ZONES.length);
    expect(dstLengthShifts).toBeGreaterThan(50);
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

// ─── ILP optimizer (CHG-085) ─────────────────────────────────────────────────

/** Most positions any legal schedule fills (depth-first search with the reference model). */
const bruteForceCoverage = (input: AssignmentInput): number => {
  const clock = clockOf(input);
  const catalog = new Map((input.templateCatalog ?? input.templates).map((t) => [t.id, t]));
  const existing: RefEntry[] = input.existingRoster.flatMap((s) => {
    const t = catalog.get(s.templateId);
    return t ? [{ workerId: s.workerId, date: s.date, ...absInterval(t, s.date, clock), isNew: false }] : [];
  });
  const positions = input.templates.flatMap((t) => Array.from({ length: requiredOf(t) }, () => t));
  let best = 0;
  const search = (i: number, entries: RefEntry[], filled: number, lastWorker: Map<string, number>): void => {
    if (filled + (positions.length - i) <= best) return;
    if (i === positions.length) {
      best = filled;
      return;
    }
    const t = positions[i];
    const from = lastWorker.get(t.id) ?? 0; // positions of one template take workers in index order
    input.workers.forEach((w, wi) => {
      if (wi < from || !legal(w, t, input.date, entries, clock, input.constraints)) return;
      const entry = { workerId: w.id, date: input.date, ...absInterval(t, input.date, clock), isNew: true };
      search(i + 1, entries.concat(entry), filled + 1, new Map(lastWorker).set(t.id, wi + 1));
    });
    search(i + 1, entries, filled, lastWorker);
  };
  search(0, existing, 0, new Map());
  return best;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const highs = createHighsSolver(require('highs') as () => Promise<HighsModule>);
const ILP_CASES = 300;

describe('optimizeAssignments (ILP) — property-based fuzz', () => {
  it(`holds all invariants, never covers less than the greedy and matches brute force (${2 * ILP_CASES} cases)`, async () => {
    const failures: string[] = [];
    let better = 0;
    let bruteChecked = 0;
    for (let k = 1; k <= 2 * ILP_CASES; k++) {
      const seed = k <= ILP_CASES ? k : 100_000 + k;
      const input = generateCase(seed, k > ILP_CASES);
      const result = await optimizeAssignments(input, { solver: highs, timeLimitMs: 5000 });
      const errors = checkInvariants(input, result);
      const greedy = assignShifts(input).assignments.length;
      if (result.assignments.length < greedy) errors.push(`ILP covers ${result.assignments.length} < greedy ${greedy}`);
      if (result.assignments.length > greedy) better++;
      const positions = input.templates.reduce((sum, t) => sum + requiredOf(t), 0);
      if (positions <= 6 && input.workers.length <= 5) {
        bruteChecked++;
        const optimum = bruteForceCoverage(input);
        if (result.assignments.length !== optimum) errors.push(`ILP covers ${result.assignments.length}, optimum ${optimum}`);
      }
      if (result.solver.dropped > 0) errors.push(`the re-check dropped ${result.solver.dropped} solver assignments`);
      if (result.solver.engine !== 'ilp' && result.solver.fallbackReason !== 'greedy_better') {
        errors.push(`solver fell back: ${result.solver.fallbackReason} ${result.solver.error ?? ''}`);
      }
      if (errors.length > 0) failures.push(`seed ${seed}: ${errors.slice(0, 3).join('; ')}`);
    }
    // Sanity: the cases include ones the greedy gets wrong, and brute force ran.
    expect(better).toBeGreaterThan(0);
    expect(bruteChecked).toBeGreaterThan(ILP_CASES / 2);
    expect(failures.slice(0, 10)).toEqual([]);
  }, 120_000);
});

// ─── ILP optimizer over several dates (CHG-087, QA F6) ───────────────────────

/**
 * Multi-date runs (`dates[]`, one model for the whole span): cross-day rest, ISO-week
 * hours (one span crosses the Sunday/Monday boundary), overnight templates, DST weeks
 * (including templates inside the spring-forward gap) and roster entries before, inside
 * and after the span. Adapted from QA's probe (redteam step 3b).
 */
const MULTI_STARTS: [string, string][] = [
  ['Europe/Madrid', '2026-03-26'],
  ['Europe/Madrid', '2026-10-22'],
  ['America/New_York', '2026-03-05'],
  ['America/New_York', '2026-10-29'],
  ['America/Lima', '2026-03-26'],
  ['Australia/Sydney', '2026-04-02'],
  ['Australia/Sydney', '2026-10-01'],
];
const MULTI_CASES = 150;

type MultiInput = AssignmentInput & { dates: string[]; timeZone: string };

const randomWeekWorker = (rng: Rng, id: string): Worker => {
  const availability = [];
  for (let i = int(rng, 1, 7); i > 0; i--) {
    const roll = rng();
    const from = roll < 0.25 ? '00:00' : randomTime(rng);
    const to = roll < 0.45 ? '23:59' : randomTime(rng);
    availability.push({ day: pick(rng, WEEKDAYS), from, to });
  }
  if (chance(rng, 0.3)) for (const day of WEEKDAYS) availability.push({ day, from: '00:00', to: '23:59' });
  return { id, displayId: id, name: id, role: pick(rng, ROLES), skills: [], availability };
};

const generateMultiCase = (seed: number): MultiInput => {
  const rng = mulberry32(seed);
  const [timeZone, start] = pick(rng, MULTI_STARTS);
  const dates = Array.from({ length: int(rng, 2, 7) }, (_, i) => addDays(start, i));
  const templates = Array.from({ length: int(rng, 1, 4) }, (_, i) => {
    const t = randomTemplate(rng, `t${i}`);
    if (chance(rng, 0.3)) {
      t.start = pick(rng, ['22:00', '23:00', '01:30', '02:00', '02:30']);
      t.end = pick(rng, ['06:00', '07:00', '03:00']);
    }
    if (!Number.isFinite(t.coverage) || t.coverage < 1) t.coverage = int(rng, 1, 3);
    return t;
  });
  // A template inside the spring-forward gap (zero-length before CHG-087), needing several workers.
  if (chance(rng, 0.3)) {
    templates.push({ id: 'gap', name: 'gap', role: pick(rng, ROLES), start: pick(rng, ['02:00', '02:30']), end: '03:00', coverage: int(rng, 2, 3) });
  }
  const workers = Array.from({ length: int(rng, 1, 6) }, (_, i) => randomWeekWorker(rng, `w${i}`));
  const old: ShiftTemplate = { id: 'old', name: 'old', role: 'Cook', start: '21:00', end: '05:00', coverage: 1 };
  const existingRoster: Shift[] = [];
  for (const w of workers) {
    if (!chance(rng, 0.4)) continue;
    existingRoster.push({
      id: `e-${w.id}`,
      date: addDays(start, int(rng, -1, dates.length)),
      workerId: w.id,
      templateId: chance(rng, 0.5) ? 'old' : pick(rng, templates).id,
      location: 'HQ',
      status: 'Published',
    });
  }
  return { date: dates[0], dates, timeZone, templates, templateCatalog: [old], workers, existingRoster, constraints: randomConstraints(rng) };
};

/** Every invariant, order-independent: each new shift must be legal against all OTHER shifts. */
const checkMultiInvariants = (input: MultiInput, result: AssignmentResult): string[] => {
  const errors: string[] = [];
  const clock = zoneClock(input.timeZone);
  const byId = new Map([...(input.templateCatalog ?? []), ...input.templates].map((t) => [t.id, t]));
  const workerById = new Map(input.workers.map((w) => [w.id, w]));
  const existing: RefEntry[] = input.existingRoster.map((s) => ({
    workerId: s.workerId,
    date: s.date,
    ...absInterval(byId.get(s.templateId) as ShiftTemplate, s.date, clock),
    isNew: false,
  }));
  const fresh = result.assignments.map((a) => {
    const t = byId.get(a.templateId);
    return t ? { workerId: a.workerId, date: a.date, ...absInterval(t, a.date, clock), isNew: true } : null;
  });
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  result.assignments.forEach((a, i) => {
    const w = workerById.get(a.workerId);
    const t = input.templates.find((x) => x.id === a.templateId);
    if (!w || !t || !input.dates.includes(a.date)) {
      errors.push(`I1 bad assignment ${JSON.stringify(a)}`);
      return;
    }
    const pair = `${a.workerId}|${a.date}|${a.templateId}`;
    if (seen.has(pair)) errors.push(`I4 ${a.workerId} holds two positions of ${a.date} ${a.templateId}`);
    seen.add(pair);
    const others = existing.concat(fresh.filter((e, j): e is RefEntry => e !== null && j !== i));
    if (!legal(w, t, a.date, others, clock, input.constraints)) errors.push(`I2–I6 illegal ${pair}`);
    counts.set(`${a.date}|${a.templateId}`, (counts.get(`${a.date}|${a.templateId}`) ?? 0) + 1);
  });
  const all = existing.concat(fresh.filter((e): e is RefEntry => e !== null));
  for (const date of input.dates) {
    for (const t of input.templates) {
      const required = requiredOf(t);
      const count = counts.get(`${date}|${t.id}`) ?? 0;
      const missing = result.unassigned
        .filter((u) => u.date === date && u.templateId === t.id)
        .reduce((s, u) => s + u.missing, 0);
      if (count > required) errors.push(`I7 over-covered ${date} ${t.id} ${count}/${required}`);
      if (count + missing !== required) errors.push(`I7 ${date} ${t.id}: ${count} + ${missing} != ${required}`);
      if (count < required) {
        const taker = input.workers.find(
          (w) => !seen.has(`${w.id}|${date}|${t.id}`) && legal(w, t, date, all, clock, input.constraints),
        );
        if (taker) errors.push(`I8 ${date} ${t.id} left open although ${taker.id} could take it`);
      }
    }
  }
  return errors;
};

describe('optimizeAssignments (ILP) over several dates — property-based fuzz', () => {
  it(`holds every hard constraint and is never worse than the greedy (${MULTI_CASES} cases)`, async () => {
    const failures: string[] = [];
    let better = 0;
    let gapSpans = 0;
    let weekBoundary = 0;
    for (let seed = 1; seed <= MULTI_CASES; seed++) {
      const input = generateMultiCase(700_000 + seed);
      const clock = zoneClock(input.timeZone);
      for (const d of input.dates) {
        for (const t of input.templates) {
          const from = toMin(t.start);
          if (clock.abs(d, from + durationOf(t)) <= clock.abs(d, from)) gapSpans++;
        }
      }
      if (new Set(input.dates.map(isoWeekKey)).size > 1) weekBoundary++;
      const result = await optimizeAssignments(input, { solver: highs, timeLimitMs: 5000 });
      const greedy = greedyAssign(input);
      const errors = checkMultiInvariants(input, result);
      const greedyErrors = checkMultiInvariants(input, greedy);
      if (greedyErrors.length > 0) errors.push(`greedy: ${greedyErrors[0]}`);
      if (result.assignments.length < greedy.assignments.length) {
        errors.push(`ILP covers ${result.assignments.length} < greedy ${greedy.assignments.length}`);
      }
      if (result.assignments.length > greedy.assignments.length) better++;
      const { score, greedyScore } = result.solver;
      if (score && greedyScore && compareScores(score, greedyScore) > 0) {
        errors.push(`ILP score ${JSON.stringify(score)} worse than greedy ${JSON.stringify(greedyScore)}`);
      }
      if (result.solver.dropped > 0) errors.push(`the re-check dropped ${result.solver.dropped} solver assignments`);
      if (result.solver.engine !== 'ilp' && result.solver.fallbackReason !== 'greedy_better') {
        errors.push(`solver fell back: ${result.solver.fallbackReason} ${result.solver.error ?? ''}`);
      }
      if (errors.length > 0) {
        failures.push(`seed ${700_000 + seed} (${input.timeZone} ${input.dates[0]}×${input.dates.length}): ${errors.slice(0, 3).join('; ')}`);
      }
    }
    // Sanity: the cases include DST-gap spans, ISO-week boundaries and ILP wins.
    expect(gapSpans).toBeGreaterThan(5);
    expect(weekBoundary).toBeGreaterThan(MULTI_CASES / 4);
    expect(better).toBeGreaterThan(0);
    expect(failures.slice(0, 10)).toEqual([]);
  }, 120_000);
});
