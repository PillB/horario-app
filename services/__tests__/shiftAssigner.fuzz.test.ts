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
 * The suite runs twice: with the deprecated fixed offset (every day 24h), and with a
 * random IANA zone on dates around DST changes. In the zoned run the reference model
 * places wall times with `zonedToUtc` (tested on its own in utils/__tests__/zonedTime)
 * and measures everything in elapsed minutes.
 */
import { assignShifts, type AssignmentInput, type AssignmentResult, type LaborConstraints } from '../shiftAssigner';
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

const absInterval = (t: ShiftTemplate, date: string, clock: Clock) => {
  const startMin = toMin(t.start);
  return { start: clock.abs(date, startMin), end: clock.abs(date, startMin + durationOf(t)) };
};
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
      const end = Math.min(clock.abs(day, to) - origin, bits.length);
      for (let m = clock.abs(day, from) - origin; m < end; m++) bits[m] = 1;
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
