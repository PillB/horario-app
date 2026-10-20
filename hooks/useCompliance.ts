/**
 * Labor-law findings for the visible week of the roster.
 *
 * Each shift is checked under the rules of the location it belongs to
 * (utils/scheduleLocation.ts). With no stored location the result says so
 * instead of guessing a jurisdiction.
 *
 * The engine needs context around the week: rest before the first shift and
 * whole workweeks for weekly limits. So it evaluates from the day before the
 * Monday on or before the first visible day to the day after the Sunday on or
 * after the last one, then keeps only findings that involve a visible shift
 * (plus findings about no shift in particular, such as a baseline-only pack).
 */
import { useMemo } from 'react';

import { evaluateRoster } from '@/services/labor/engine';
import type { Finding, LaborShift, LaborWorker, Verdict } from '@/services/labor/types';
import type { Worker } from '@/types/scheduler';
import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';
import type { BusinessLocation } from '@/utils/locationValidation';
import { resolveShiftLocation } from '@/utils/scheduleLocation';
import type { Shift, ShiftTemplate } from '@/utils/schedulerMetrics';
import { isValidTimeZone, zonedShiftSpan } from '@/utils/zonedTime';

export type ComplianceShift = Shift & { template?: ShiftTemplate; worker?: Worker };

/** Display order of the groups. */
export const VERDICT_ORDER: readonly Verdict[] = ['violation', 'premium', 'warning', 'refusable', 'review'];

/** Most severe first; a shift's marker shows the most severe verdict it has. */
const SEVERITY: readonly Verdict[] = ['violation', 'refusable', 'premium', 'warning', 'review'];

export type ComplianceFinding = Finding & { workerName: string; locationName: string };

export type ComplianceResult = {
  /** loading: locations not loaded yet; no-location: the account has none; ready: evaluated. */
  status: 'loading' | 'no-location' | 'ready';
  findings: ComplianceFinding[];
  byVerdict: Record<Verdict, ComplianceFinding[]>;
  /** Most severe verdict per visible shift id. */
  markers: Record<string, Verdict>;
  /** Visible shifts not checked: several locations exist and the entry names none of them. */
  unlinkedShiftIds: string[];
};

export type ComplianceInput = {
  shifts: readonly ComplianceShift[];
  locations: readonly BusinessLocation[];
  locationsLoaded: boolean;
  /** First visible day, 'YYYY-MM-DD'. */
  weekStart: string;
  /** Days shown (default 7). */
  days?: number;
};

const emptyGroups = (): Record<Verdict, ComplianceFinding[]> => ({
  violation: [], premium: [], warning: [], refusable: [], review: [],
});

const EMPTY = (status: ComplianceResult['status']): ComplianceResult => ({
  status, findings: [], byVerdict: emptyGroups(), markers: {}, unlinkedShiftIds: [],
});

const toLaborWorker = (id: string, worker: Worker | undefined): LaborWorker => ({
  id,
  birthDate: worker?.birthDate ?? undefined,
  nightWorker: worker?.nightWorker ?? false,
  weeklyLimitOptOut: worker?.weeklyLimitOptOut ?? false,
  noFixedHours: worker?.noFixedHours ?? false,
});

/** Pure evaluation behind useCompliance (exported for tests). */
export function evaluateCompliance({ shifts, locations, locationsLoaded, weekStart, days = 7 }: ComplianceInput): ComplianceResult {
  if (!locationsLoaded) return EMPTY('loading');
  if (locations.length === 0) return EMPTY('no-location');

  const lastVisible = addDaysToKey(weekStart, days - 1);
  const mondayBefore = addDaysToKey(weekStart, -((weekdayOfKey(weekStart) + 6) % 7));
  const sundayAfter = addDaysToKey(lastVisible, (7 - weekdayOfKey(lastVisible)) % 7);
  const from = addDaysToKey(mondayBefore, -1);
  const to = addDaysToKey(sundayAfter, 1);

  const visible = new Set<string>();
  const unlinked: string[] = [];
  const byLocation = new Map<string, { location: BusinessLocation; shifts: Map<string, LaborShift[]>; workers: Map<string, Worker | undefined> }>();

  for (const shift of shifts) {
    if (shift.date < from || shift.date > to) continue;
    const isVisible = shift.date >= weekStart && shift.date <= lastVisible;
    const location = resolveShiftLocation(locations, shift.location);
    if (!location) {
      if (isVisible) unlinked.push(shift.id);
      continue;
    }
    if (!shift.template || !isValidTimeZone(location.timeZone)) continue;
    if (isVisible) visible.add(shift.id);
    const group = byLocation.get(location.id) ?? { location, shifts: new Map(), workers: new Map() };
    byLocation.set(location.id, group);
    const span = zonedShiftSpan(shift.date, shift.template.start, shift.template.end, location.timeZone);
    const list = group.shifts.get(shift.workerId) ?? [];
    list.push({ id: shift.id, start: span.start, end: span.end });
    group.shifts.set(shift.workerId, list);
    if (!group.workers.has(shift.workerId) || shift.worker) group.workers.set(shift.workerId, shift.worker);
  }

  const findings: ComplianceFinding[] = [];
  const seenGeneral = new Set<string>();
  for (const { location, shifts: shiftsByWorker, workers } of byLocation.values()) {
    const laborWorkers = Array.from(workers, ([id, worker]) => toLaborWorker(id, worker));
    const raw = evaluateRoster(
      { jurisdiction: location.jurisdictionCode, timeZone: location.timeZone, industry: location.industry },
      laborWorkers,
      Object.fromEntries(shiftsByWorker),
    );
    for (const f of raw) {
      if (f.shiftIds.length === 0) {
        // Not about a shift (e.g. "this pack is only a baseline"): once per location.
        const key = `${location.id}|${f.rule}|${f.message}`;
        if (seenGeneral.has(key)) continue;
        seenGeneral.add(key);
        findings.push({ ...f, workerName: '', locationName: location.name });
        continue;
      }
      if (!f.shiftIds.some((id) => visible.has(id))) continue;
      findings.push({ ...f, workerName: workers.get(f.workerId)?.name ?? f.workerId, locationName: location.name });
    }
  }

  const byVerdict = emptyGroups();
  const markers: Record<string, Verdict> = {};
  for (const f of findings) {
    byVerdict[f.verdict].push(f);
    for (const id of f.shiftIds) {
      if (!visible.has(id)) continue;
      const current = markers[id];
      if (current === undefined || SEVERITY.indexOf(f.verdict) < SEVERITY.indexOf(current)) markers[id] = f.verdict;
    }
  }

  return { status: 'ready', findings, byVerdict, markers, unlinkedShiftIds: unlinked };
}

/** Memoized compliance findings for the visible week. */
export const useCompliance = ({ shifts, locations, locationsLoaded, weekStart, days }: ComplianceInput): ComplianceResult =>
  useMemo(
    () => evaluateCompliance({ shifts, locations, locationsLoaded, weekStart, days }),
    [shifts, locations, locationsLoaded, weekStart, days],
  );
