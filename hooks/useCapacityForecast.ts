import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  listRoster,
  listShiftTemplates,
  listWorkers,
  type DbRosterShift,
  type DbWorker,
  type DbShiftTemplate,
} from '@/services/rosterService';
import { loadDemandTargets, type DemandForecast } from '@/services/demandForecast';
import { isoDate, parseTimeToMinutes, getWeekdayFromDate } from '@/utils/schedulerUtils';

// ─── Public types ─────────────────────────────────────────────────────────────

export type CapacityRisk = 'critical' | 'warning' | 'ok';

export type CapacityGap = {
  date: string;
  role: string;
  required: number;
  available: number;
  gap: number;
  risk: CapacityRisk;
  isProjected: boolean;
};

export type BurnoutRiskLevel = 'high' | 'medium' | 'low';

export type BurnoutRisk = {
  workerId: string;
  workerName: string;
  assignedHours: number;
  availableHours: number;
  utilizationPct: number;
  risk: BurnoutRiskLevel;
};

export type TrendDirection = 'improving' | 'stable' | 'degrading';

export type CapacityTrend = {
  role: string;
  direction: TrendDirection;
  projectedGapIn14Days: number;
  confidence: number;
};

export type UseCapacityForecastReturn = {
  gaps: CapacityGap[];
  burnoutRisks: BurnoutRisk[];
  trends: CapacityTrend[];
  loading: boolean;
};

// ─── Availability type (internal) ─────────────────────────────────────────────

type WorkerAvailability = {
  workerId: string;
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  startTime: string; // 'HH:MM'
  endTime: string;   // 'HH:MM'
};

// ─── Pure computation helpers ──────────────────────────────────────────────────

/**
 * Derives a numeric risk level from gap magnitude relative to demand.
 */
function deriveRisk(required: number, gap: number): CapacityRisk {
  if (required === 0) return 'ok';
  const shortfall = gap / required;
  if (shortfall >= 0.4) return 'critical';
  if (shortfall >= 0.15) return 'warning';
  return 'ok';
}

/**
 * Returns the total available hours for a worker on a given calendar date,
 * derived from their weekly availability windows.
 */
function availableHoursOnDate(
  workerId: string,
  date: string,
  availability: WorkerAvailability[],
): number {
  const dayOfWeek = new Date(date + 'T00:00:00').getDay();
  return availability
    .filter((a) => a.workerId === workerId && a.dayOfWeek === dayOfWeek)
    .reduce((sum, a) => {
      const start = parseTimeToMinutes(a.startTime);
      const end = parseTimeToMinutes(a.endTime);
      return sum + Math.max(0, end - start) / 60;
    }, 0);
}

/**
 * Returns the duration in hours of a shift template window.
 */
function templateDurationHours(template: DbShiftTemplate): number {
  const start = parseTimeToMinutes(template.startTime);
  const end = parseTimeToMinutes(template.endTime);
  return Math.max(0, end - start) / 60;
}

// ─── Exported pure functions ───────────────────────────────────────────────────

/**
 * computeCapacityGaps
 *
 * For every demand target, compute the number of Published shifts covering
 * that (date, role) pair and derive the shortfall with an associated risk level.
 * Gaps are flagged isProjected=false (they reflect actual current data).
 */
export function computeCapacityGaps(
  demandTargets: DemandForecast[],
  roster: DbRosterShift[],
  templates: DbShiftTemplate[],
  workers: DbWorker[],
  availability: WorkerAvailability[],
): CapacityGap[] {
  const templateMap = new Map<string, DbShiftTemplate>(
    templates.map((t) => [t.id, t]),
  );
  const workerMap = new Map<string, DbWorker>(workers.map((w) => [w.id, w]));

  // Count published coverage per (date, role)
  const coverageByKey = new Map<string, number>();
  for (const shift of roster) {
    if (shift.status !== 'Published') continue;
    const template = templateMap.get(shift.templateId);
    if (!template) continue;
    const worker = workerMap.get(shift.workerId);
    if (!worker) continue;
    const key = `${shift.date}::${template.role}`;
    coverageByKey.set(key, (coverageByKey.get(key) ?? 0) + (template.coverage ?? 1));
  }

  // Count total available workers per (date, role) across the roster window
  // "available" = workers whose role matches AND who have availability on that date
  const availableByKey = new Map<string, number>();
  const dateRolePairs = new Set<string>(
    demandTargets.map((t) => `${t.date}::${t.role}`),
  );
  for (const [key] of dateRolePairs) {
    const [date, role] = key.split('::');
    const eligibleWorkers = workers.filter(
      (w) => w.role === role && availableHoursOnDate(w.id, date, availability) > 0,
    );
    availableByKey.set(key, eligibleWorkers.length);
  }

  return demandTargets.map((target) => {
    const key = `${target.date}::${target.role}`;
    const covered = coverageByKey.get(key) ?? 0;
    const available = availableByKey.get(key) ?? 0;
    const gap = Math.max(0, target.required - covered);
    return {
      date: target.date,
      role: target.role,
      required: target.required,
      available,
      gap,
      risk: deriveRisk(target.required, gap),
      isProjected: false,
    };
  });
}

/**
 * computeBurnoutRisks
 *
 * Looks back `lookbackDays` days from today, sums each worker's assigned shift
 * hours and available hours, then flags workers whose utilization exceeds
 * thresholds: >90% = high, 70–90% = medium, <70% = low.
 */
export function computeBurnoutRisks(
  workers: DbWorker[],
  roster: DbRosterShift[],
  templates: DbShiftTemplate[],
  availability: WorkerAvailability[],
  lookbackDays: number,
): BurnoutRisk[] {
  const templateMap = new Map<string, DbShiftTemplate>(
    templates.map((t) => [t.id, t]),
  );

  // Build the date range [lookbackStart, today]
  const today = new Date();
  const lookbackStart = new Date(today);
  lookbackStart.setDate(today.getDate() - lookbackDays);
  const startStr = lookbackStart.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);

  // Sum assigned hours per worker within the window
  const assignedHoursMap = new Map<string, number>();
  for (const shift of roster) {
    if (shift.date < startStr || shift.date > endStr) continue;
    if (shift.status !== 'Published') continue;
    const template = templateMap.get(shift.templateId);
    if (!template) continue;
    const duration = templateDurationHours(template);
    assignedHoursMap.set(
      shift.workerId,
      (assignedHoursMap.get(shift.workerId) ?? 0) + duration,
    );
  }

  // Sum total available hours per worker within the window
  const results: BurnoutRisk[] = [];

  for (const worker of workers) {
    let totalAvailableHours = 0;

    // Iterate through each day in the lookback window
    const cursor = new Date(lookbackStart);
    while (cursor <= today) {
      const dateStr = cursor.toISOString().slice(0, 10);
      totalAvailableHours += availableHoursOnDate(worker.id, dateStr, availability);
      cursor.setDate(cursor.getDate() + 1);
    }

    const assignedHours = assignedHoursMap.get(worker.id) ?? 0;
    const utilizationPct =
      totalAvailableHours > 0
        ? Math.min(100, (assignedHours / totalAvailableHours) * 100)
        : 0;

    const risk: BurnoutRiskLevel =
      utilizationPct >= 90 ? 'high'
      : utilizationPct >= 70 ? 'medium'
      : 'low';

    results.push({
      workerId: worker.id,
      workerName: worker.name,
      assignedHours: Math.round(assignedHours * 10) / 10,
      availableHours: Math.round(totalAvailableHours * 10) / 10,
      utilizationPct: Math.round(utilizationPct * 10) / 10,
      risk,
    });
  }

  return results.sort((a, b) => b.utilizationPct - a.utilizationPct);
}

/**
 * projectCapacityTrend
 *
 * Groups the supplied CapacityGap[] by role, buckets them into `lookbackWeeks`
 * weekly cohorts (oldest → newest), then runs a least-squares linear regression
 * on average gap per week to extrapolate the gap 14 days (2 weeks) into the
 * future.
 *
 * Confidence is a 0–1 value reflecting how many weeks have data (more data →
 * higher confidence, capped at 1.0).
 */
export function projectCapacityTrend(
  capacityGaps: CapacityGap[],
  lookbackWeeks: number,
): CapacityTrend[] {
  if (capacityGaps.length === 0) return [];

  // Group gaps by role
  const gapsByRole = new Map<string, CapacityGap[]>();
  for (const gap of capacityGaps) {
    const list = gapsByRole.get(gap.role) ?? [];
    list.push(gap);
    gapsByRole.set(gap.role, list);
  }

  const trends: CapacityTrend[] = [];

  for (const [role, roleGaps] of gapsByRole) {
    // Assign each gap entry to a week bucket (0 = oldest, lookbackWeeks-1 = newest)
    const weekBuckets: number[][] = Array.from({ length: lookbackWeeks }, () => []);

    for (const gap of roleGaps) {
      const gapDate = new Date(gap.date + 'T00:00:00');
      const now = new Date();
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weeksAgo = Math.floor((now.getTime() - gapDate.getTime()) / msPerWeek);
      const bucketIndex = lookbackWeeks - 1 - weeksAgo;
      if (bucketIndex >= 0 && bucketIndex < lookbackWeeks) {
        weekBuckets[bucketIndex].push(gap.gap);
      }
    }

    // Compute average gap per week bucket; skip empty buckets
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < lookbackWeeks; i++) {
      if (weekBuckets[i].length === 0) continue;
      const avg =
        weekBuckets[i].reduce((s, v) => s + v, 0) / weekBuckets[i].length;
      points.push({ x: i, y: avg });
    }

    if (points.length === 0) continue;

    // Least-squares linear regression: y = slope * x + intercept
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
    const denominator = n * sumX2 - sumX * sumX;

    let slope = 0;
    let intercept = sumY / n;

    if (denominator !== 0) {
      slope = (n * sumXY - sumX * sumY) / denominator;
      intercept = (sumY - slope * sumX) / n;
    }

    // Project 2 weeks (2 units) ahead of the last known week bucket
    const projectedX = (lookbackWeeks - 1) + 2;
    const projectedGapIn14Days = Math.max(0, slope * projectedX + intercept);

    // Direction: compare projected value to current (last bucket average)
    const currentAvg = points[points.length - 1].y;
    const delta = projectedGapIn14Days - currentAvg;

    const direction: TrendDirection =
      delta < -0.5 ? 'improving'
      : delta > 0.5 ? 'degrading'
      : 'stable';

    // Confidence: saturates at 1.0 when we have data for all lookback weeks
    const confidence = Math.min(1, points.length / Math.max(1, lookbackWeeks));

    trends.push({
      role,
      direction,
      projectedGapIn14Days: Math.round(projectedGapIn14Days * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  return trends.sort((a, b) => b.projectedGapIn14Days - a.projectedGapIn14Days);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 28;
const LOOKBACK_WEEKS = 4;
const FORECAST_DAYS = 14;

export function useCapacityForecast(accountId: string): UseCapacityForecastReturn {
  const [rawGaps, setRawGaps] = useState<CapacityGap[]>([]);
  const [rawBurnout, setRawBurnout] = useState<BurnoutRisk[]>([]);
  const [rawTrends, setRawTrends] = useState<CapacityTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const today = isoDate(0);
      const futureDate = isoDate(FORECAST_DAYS);
      const pastDate = (() => {
        const d = new Date();
        d.setDate(d.getDate() - LOOKBACK_DAYS);
        return d.toISOString().slice(0, 10);
      })();

      const [
        futureRoster,
        pastRoster,
        demandTargets,
        workers,
        templates,
      ] = await Promise.all([
        listRoster(accountId, { fromDate: today, toDate: futureDate }),
        listRoster(accountId, { fromDate: pastDate, toDate: today }),
        loadDemandTargets({ date: today }),
        listWorkers(accountId),
        listShiftTemplates(accountId),
      ]);

      if (requestId !== requestIdRef.current) return;

      // We do not have a real availability service imported here, so we derive
      // a best-effort availability list from historical roster patterns.
      // In production this would call a dedicated listAvailability(accountId).
      const derivedAvailability = deriveAvailabilityFromRoster(
        [...pastRoster, ...futureRoster],
        templates,
        workers,
      );

      const gaps = computeCapacityGaps(
        demandTargets,
        futureRoster,
        templates,
        workers,
        derivedAvailability,
      );

      const burnoutRisks = computeBurnoutRisks(
        workers,
        pastRoster,
        templates,
        derivedAvailability,
        LOOKBACK_DAYS,
      );

      // For trend projection we combine past + future gaps to have enough data
      const allGapsForTrend = computeCapacityGaps(
        demandTargets,
        [...pastRoster, ...futureRoster],
        templates,
        workers,
        derivedAvailability,
      );

      const trends = projectCapacityTrend(allGapsForTrend, LOOKBACK_WEEKS);

      setRawGaps(gaps);
      setRawBurnout(burnoutRisks);
      setRawTrends(trends);
    } catch (_err) {
      if (requestId !== requestIdRef.current) return;
      setRawGaps([]);
      setRawBurnout([]);
      setRawTrends([]);
    } finally {
      if (requestIdRef.current === requestIdRef.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  // Memoize the return object so consumers get stable references
  const gaps = useMemo(() => rawGaps, [rawGaps]);
  const burnoutRisks = useMemo(() => rawBurnout, [rawBurnout]);
  const trends = useMemo(() => rawTrends, [rawTrends]);

  return { gaps, burnoutRisks, trends, loading };
}

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * deriveAvailabilityFromRoster
 *
 * In the absence of a dedicated availability API, infer each worker's
 * availability from their historical (and future) shift assignments.
 * Each unique (workerId, dayOfWeek) combination gets an availability window
 * equal to the broadest start/end times seen across all their templates on
 * that weekday.
 *
 * This is a graceful fallback; replace with a real listAvailability() call
 * when the service is available.
 */
function deriveAvailabilityFromRoster(
  roster: DbRosterShift[],
  templates: DbShiftTemplate[],
  workers: DbWorker[],
): WorkerAvailability[] {
  const templateMap = new Map<string, DbShiftTemplate>(
    templates.map((t) => [t.id, t]),
  );
  const workerIds = new Set(workers.map((w) => w.id));

  type Window = { startTime: string; endTime: string };
  const windowMap = new Map<string, Window>();

  for (const shift of roster) {
    if (!workerIds.has(shift.workerId)) continue;
    const template = templateMap.get(shift.templateId);
    if (!template) continue;

    const dayOfWeek = new Date(shift.date + 'T00:00:00').getDay();
    const key = `${shift.workerId}::${dayOfWeek}`;
    const existing = windowMap.get(key);

    if (!existing) {
      windowMap.set(key, {
        startTime: template.startTime,
        endTime: template.endTime,
      });
    } else {
      // Expand to broadest window seen
      windowMap.set(key, {
        startTime:
          template.startTime < existing.startTime
            ? template.startTime
            : existing.startTime,
        endTime:
          template.endTime > existing.endTime
            ? template.endTime
            : existing.endTime,
      });
    }
  }

  const availability: WorkerAvailability[] = [];
  for (const [key, window] of windowMap) {
    const [workerId, dayStr] = key.split('::');
    availability.push({
      workerId,
      dayOfWeek: parseInt(dayStr, 10),
      startTime: window.startTime,
      endTime: window.endTime,
    });
  }
  return availability;
}