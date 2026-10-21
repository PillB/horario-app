/**
 * Location overrides: a business's own limits for one location, stored in
 * `locations.overrides` (CHG-089). They cover the numeric limits the engine
 * has (rest minimum, daily and weekly maximums, break minutes) and may only
 * make a rule stricter than the law:
 *
 * - On save, each override must be stricter than the resolved pack value for
 *   the location's jurisdiction on that date (validateOverrides). An equal
 *   value counts only when the pack's rule is advisory (a warning), because
 *   the override turns it into a hard limit.
 * - When applied (applyOverrides), the stricter of the pack and the override
 *   wins on every date, so an override saved before the law tightened can
 *   never loosen it.
 *
 * An applied override is a hard limit: its rule's verdict becomes a violation
 * and the finding cites the override plus the legal source it tightens. The
 * auto-assigner takes rest, daily and weekly overrides through
 * legalConstraintsFor; breaks are not an assigner constraint.
 */
import { mapDated, resolveDated } from './dated';
import { getJurisdiction } from './jurisdictions';
import type { BreakTrigger, Cite, DateKey, LocationOverride, RulePack } from './types';

export type { LocationOverride };

export const OVERRIDE_RULES = ['rest.minHours', 'daily.maxHours', 'weekly.maxHours', 'breaks.minMinutes'] as const;
export type OverrideRule = (typeof OVERRIDE_RULES)[number];

export const MAX_OVERRIDES = 20;
const NOTE_MAX = 200;

type Range = { min: number; max: number; integer?: boolean; unit: string };
const VALUE_RANGE: Record<OverrideRule, Range> = {
  'rest.minHours': { min: 0, max: 24, unit: 'h' },
  'daily.maxHours': { min: 0, max: 24, unit: 'h' },
  'weekly.maxHours': { min: 0, max: 168, unit: 'h' },
  'breaks.minMinutes': { min: 0, max: 480, integer: true, unit: 'min' },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isOverrideRule = (v: unknown): v is OverrideRule => (OVERRIDE_RULES as readonly unknown[]).includes(v);

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** Parses one override object (shape and ranges only; strictness needs the pack). */
export function parseOverride(raw: unknown, index = 0): Parsed<LocationOverride> {
  const at = `overrides[${index}]`;
  if (!isRecord(raw)) return { ok: false, message: `${at} must be an object` };
  const { rule, value, note, afterHours } = raw;
  if (!isOverrideRule(rule)) return { ok: false, message: `${at}.rule must be one of ${OVERRIDE_RULES.join(', ')}` };
  const allowed = rule === 'breaks.minMinutes' ? ['rule', 'value', 'note', 'afterHours'] : ['rule', 'value', 'note'];
  const extra = Object.keys(raw).find((k) => !allowed.includes(k));
  if (extra) return { ok: false, message: `${at}.${extra} is not allowed for ${rule}` };

  const range = VALUE_RANGE[rule];
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value <= range.min || value > range.max ||
    (range.integer && !Number.isInteger(value))
  ) {
    return { ok: false, message: `${at}.value must be ${range.integer ? 'a whole number ' : 'a number '}above ${range.min} and at most ${range.max} ${range.unit}` };
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > NOTE_MAX)) {
    return { ok: false, message: `${at}.note must be a string of up to ${NOTE_MAX} characters` };
  }
  const cleanNote = typeof note === 'string' && note.trim() ? { note: note.trim() } : {};
  if (rule === 'breaks.minMinutes') {
    if (typeof afterHours !== 'number' || !Number.isFinite(afterHours) || afterHours < 0 || afterHours >= 24) {
      return { ok: false, message: `${at}.afterHours must be a number from 0 to under 24` };
    }
    return { ok: true, value: { rule, value, afterHours, ...cleanNote } };
  }
  return { ok: true, value: { rule, value, ...cleanNote } };
}

/** Stored overrides for evaluation: invalid entries are left out (they were checked on save). */
export const parseStoredOverrides = (raw: unknown): LocationOverride[] => {
  if (!Array.isArray(raw)) return [];
  const out: LocationOverride[] = [];
  raw.forEach((item, i) => {
    const parsed = parseOverride(item, i);
    if (parsed.ok) out.push(parsed.value);
  });
  return out;
};

// ─── The pack's own value ────────────────────────────────────────────────────

/** Break minutes the triggers require when slightly more than `hours` are worked. */
const breakMinutesJustOver = (triggers: BreakTrigger[], hours: number): number => {
  const worked = hours + 1e-6;
  return triggers.reduce((req, t) => (worked > t.afterHours ? Math.max(req, t.minMinutes) : req), 0);
};

/** The value the pack sets for an override's rule on `date`; `hard` = a violation, not a warning. */
export type PackLimit = { value: number; hard: boolean };

export function packLimitFor(pack: RulePack, override: LocationOverride, date: DateKey): PackLimit | undefined {
  switch (override.rule) {
    case 'rest.minHours': {
      const rest = pack.restBetweenShifts;
      return rest ? { value: resolveDated(rest.minHours, date), hard: (rest.verdict ?? 'violation') === 'violation' } : undefined;
    }
    case 'daily.maxHours': {
      const limits: PackLimit[] = [];
      if (pack.dailyTotalMax) limits.push({ value: pack.dailyTotalMax.hours, hard: (pack.dailyTotalMax.verdict ?? 'violation') === 'violation' });
      const ordinary = pack.dailyOrdinaryMax;
      if (ordinary && ordinary.excess === 'violation') {
        const raw = resolveDated(ordinary.hours, date);
        limits.push({ value: typeof raw === 'number' ? raw : Math.min(raw.day, raw.night, raw.mixed), hard: true });
      }
      if (!limits.length) return undefined;
      const lowest = Math.min(...limits.map((l) => l.value));
      return { value: lowest, hard: limits.some((l) => l.value === lowest && l.hard) };
    }
    case 'weekly.maxHours': {
      const weekly = pack.weeklyMax;
      return weekly ? { value: weekly.hours, hard: (weekly.verdict ?? 'violation') === 'violation' } : undefined;
    }
    case 'breaks.minMinutes': {
      const rule = pack.breaks;
      if (!rule) return undefined;
      const value = breakMinutesJustOver(rule.triggers, override.afterHours);
      return value > 0 ? { value, hard: (rule.verdict ?? 'violation') === 'violation' } : undefined;
    }
  }
}

const isMinimum = (rule: OverrideRule) => rule === 'rest.minHours' || rule === 'breaks.minMinutes';

/** True when the override tightens the pack on `date`. */
export const isStricter = (pack: RulePack, override: LocationOverride, date: DateKey): boolean => {
  const limit = packLimitFor(pack, override, date);
  if (!limit) return true;
  if (override.value === limit.value) return !limit.hard;
  return isMinimum(override.rule) ? override.value > limit.value : override.value < limit.value;
};

const describe = (o: LocationOverride, value = o.value): string => {
  switch (o.rule) {
    case 'rest.minHours': return `a minimum rest of ${value} h between shifts`;
    case 'daily.maxHours': return `a daily maximum of ${value} h`;
    case 'weekly.maxHours': return `a weekly maximum of ${value} h`;
    case 'breaks.minMinutes': return `a break of ${value} min after more than ${o.afterHours} h of work`;
  }
};

export type OverridesValidation =
  | { ok: true; value: LocationOverride[] }
  | { ok: false; code: 'OVERRIDES_INVALID' | 'OVERRIDE_NOT_STRICTER'; message: string };

/**
 * Validates a location's overrides against its resolved pack on `date`
 * (the location's local today when saving). Each override must parse, appear
 * once per rule (breaks: once per afterHours) and be stricter than the pack.
 */
export function validateOverrides(raw: unknown, pack: RulePack, date: DateKey): OverridesValidation {
  if (!Array.isArray(raw) || raw.length > MAX_OVERRIDES) {
    return { ok: false, code: 'OVERRIDES_INVALID', message: `overrides must be an array of up to ${MAX_OVERRIDES} objects` };
  }
  const seen = new Set<string>();
  const out: LocationOverride[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseOverride(raw[i], i);
    if (!parsed.ok) return { ok: false, code: 'OVERRIDES_INVALID', message: parsed.message };
    const o = parsed.value;
    const key = o.rule === 'breaks.minMinutes' ? `${o.rule}|${o.afterHours}` : o.rule;
    if (seen.has(key)) return { ok: false, code: 'OVERRIDES_INVALID', message: `overrides[${i}] repeats ${o.rule}` };
    seen.add(key);
    if (!isStricter(pack, o, date)) {
      const limit = packLimitFor(pack, o, date)!;
      const place = getJurisdiction(pack.code)?.name ?? pack.code;
      return {
        ok: false,
        code: 'OVERRIDE_NOT_STRICTER',
        message: `overrides[${i}]: ${describe(o)} is not stricter than the law in ${place} on ${date}, which sets ${describe(o, limit.value)}. A location override can only make a rule stricter.`,
      };
    }
    out.push(o);
  }
  return { ok: true, value: out };
}

// ─── Applying overrides ──────────────────────────────────────────────────────

const overrideCite = (o: LocationOverride, legal?: Cite): Cite => ({
  source: `Location override${o.note ? ` (${o.note})` : ''}${legal ? `; stricter than ${legal.source}` : ''}`,
  ...(legal?.url ? { url: legal.url } : {}),
  confidence: 'high',
});

/**
 * The pack with a location's overrides applied, the stricter value winning on
 * every date. Without overrides the pack is returned unchanged.
 */
export function applyOverrides(pack: RulePack, overrides: readonly LocationOverride[] | undefined): RulePack {
  if (!overrides?.length) return pack;
  const out: RulePack = { ...pack };
  for (const o of overrides) {
    switch (o.rule) {
      case 'rest.minHours': {
        const rest = out.restBetweenShifts;
        out.restBetweenShifts = rest
          ? {
            ...rest,
            minHours: mapDated(rest.minHours, (h) => Math.max(h, o.value)),
            verdict: 'violation',
            // The business limit applies to every pair (Ontario's 13 h exemption is the law's).
            exemptIfPairTotalHoursLte: undefined,
            cite: overrideCite(o, rest.cite),
          }
          : { minHours: o.value, cite: overrideCite(o) };
        break;
      }
      case 'daily.maxHours': {
        const cur = out.dailyTotalMax;
        if (!cur || o.value < cur.hours || (o.value === cur.hours && cur.verdict === 'warning')) {
          out.dailyTotalMax = { hours: o.value, verdict: 'violation', cite: overrideCite(o, cur?.cite ?? out.dailyOrdinaryMax?.cite) };
        }
        break;
      }
      case 'weekly.maxHours': {
        const cur = out.weeklyMax;
        if (!cur || o.value < cur.hours || (o.value === cur.hours && cur.verdict === 'warning')) {
          out.weeklyMax = { hours: o.value, verdict: 'violation', cite: overrideCite(o, cur?.cite) };
        }
        break;
      }
      case 'breaks.minMinutes': {
        const cur = out.breaks;
        const trigger: BreakTrigger = { afterHours: o.afterHours, minMinutes: o.value };
        out.breaks = cur
          ? { ...cur, triggers: [...cur.triggers, trigger], verdict: 'violation', cite: overrideCite(o, cur.cite) }
          : { triggers: [trigger], cite: overrideCite(o) };
        break;
      }
    }
  }
  return out;
}
