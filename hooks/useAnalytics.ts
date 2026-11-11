/**
 * useAnalytics — live scheduling-performance metrics.
 *
 * Fetches all roster shifts, workers, templates, and demand targets in parallel
 * and computes the key SMB metrics, for every stored date or for the dates of
 * an optional range (`AnalyticsRange`, both ends included):
 *
 *  - coverageRate      % of total demand covered by Published shifts
 *  - draftShifts       count of Draft shifts awaiting approval
 *  - publishedShifts   count of Published shifts
 *  - workerHours       per-worker hours (published only), sorted descending
 *  - fairnessScore     std dev of worker hours (lower = more equitable)
 *  - uncoveredRevenue  $ exposure from schedulerMetrics.computeUncoveredLoss
 *
 * Uses the same requestIdRef stale-guard pattern as useDemandForecast and
 * useLiveRosterSummary to prevent out-of-order state updates.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRoster,
  listShiftTemplates,
  listWorkers,
  type DbShiftTemplate,
  type DbWorker,
} from '@/services/rosterService';
import { loadDemandTargets } from '@/services/demandForecast';
import { computeUncoveredLoss } from '@/utils/schedulerMetrics';
import { parseTimeToMinutes } from '@/utils/schedulerUtils';

// ─── Public types ─────────────────────────────────────────────────────────────

export type WorkerHoursEntry = {
  workerId: string;
  workerName: string;
  hours: number;
  shiftsCount: number;
};

export type AnalyticsSummary = {
  coverageRate: number;         // 0–100 (%)
  /** False when no demand target exists: the coverage rate then means nothing. */
  hasDemand: boolean;
  draftShifts: number;          // count of Draft status
  publishedShifts: number;      // count of Published status
  workerHours: WorkerHoursEntry[]; // sorted descending by hours
  fairnessScore: number;        // std dev of worker hours (lower = fairer)
  uncoveredRevenue: number;     // $ from computeUncoveredLoss
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/** Dates to count, both ends included; a missing end is open. */
export type AnalyticsRange = { from?: string; to?: string };

/** True when `date` (YYYY-MM-DD) is inside the range. */
export const inRange = (date: string, range?: AnalyticsRange): boolean =>
  (!range?.from || date >= range.from) && (!range?.to || date <= range.to);

// ─── Pure computation helpers (exported for testing) ─────────────────────────

/** Computes hours for a single shift from its template duration. */
export const shiftHours = (template: DbShiftTemplate): number => {
  const start = parseTimeToMinutes(template.startTime);
  const end = parseTimeToMinutes(template.endTime);
  // An end before the start is an overnight shift (22:00–06:00 is 8 h on the
  // clock; the scheduler's DST-exact lengths are not needed for this chart).
  if (end === start) return 0;
  return (end > start ? end - start : end + 24 * 60 - start) / 60;
};

/** Population standard deviation of an array. Returns 0 for arrays of 0 or 1. */
export const stdDev = (values: number[]): number => {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalytics(accountId: string, range?: AnalyticsRange): AnalyticsSummary {
  const from = range?.from;
  const to = range?.to;
  const [coverageRate, setCoverageRate] = useState(0);
  const [hasDemand, setHasDemand] = useState(false);
  const [draftShifts, setDraftShifts] = useState(0);
  const [publishedShifts, setPublishedShifts] = useState(0);
  const [workerHours, setWorkerHours] = useState<WorkerHoursEntry[]>([]);
  const [fairnessScore, setFairnessScore] = useState(0);
  const [uncoveredRevenue, setUncoveredRevenue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      // The range is applied here, not in the request: the targets filter of the
      // proxy matches one exact date only.
      const [allShifts, workers, dbTemplates, allTargets] = await Promise.all([
        listRoster(accountId),
        listWorkers(accountId),
        listShiftTemplates(accountId),
        loadDemandTargets(),
      ]);

      if (requestId !== requestIdRef.current) return;

      const shifts = allShifts.filter((s) => inRange(s.date, { from, to }));
      const targets = allTargets.filter((target) => inRange(target.date, { from, to }));

      const workerMap = new Map<string, DbWorker>(workers.map((w) => [w.id, w]));
      const templateMap = new Map<string, DbShiftTemplate>(
        dbTemplates.map((t) => [t.id, t]),
      );

      // ── Shift counts ──────────────────────────────────────────────────────
      const drafts = shifts.filter((s) => s.status === 'Draft').length;
      const published = shifts.filter((s) => s.status === 'Published').length;

      // ── Worker hours (published only) ─────────────────────────────────────
      const hoursAccum = new Map<string, number>();
      const countAccum = new Map<string, number>();

      for (const shift of shifts) {
        if (shift.status !== 'Published') continue;
        const template = templateMap.get(shift.templateId);
        if (!template) continue;
        const h = shiftHours(template);
        hoursAccum.set(shift.workerId, (hoursAccum.get(shift.workerId) ?? 0) + h);
        countAccum.set(shift.workerId, (countAccum.get(shift.workerId) ?? 0) + 1);
      }

      const workerHoursEntries: WorkerHoursEntry[] = Array.from(hoursAccum.entries())
        .map(([workerId, hours]) => ({
          workerId,
          workerName: workerMap.get(workerId)?.name ?? workerId,
          hours,
          shiftsCount: countAccum.get(workerId) ?? 0,
        }))
        .sort((a, b) => b.hours - a.hours);

      // ── Fairness score (std dev of hours across workers) ──────────────────
      const hourValues = workerHoursEntries.map((e) => e.hours);
      const fairness = stdDev(hourValues);

      // ── Coverage rate ─────────────────────────────────────────────────────
      const totalRequired = targets.reduce((sum, t) => sum + t.required, 0);

      // One published roster row is one person in one position (the template's
      // `coverage` is how many it needs, not how many a row supplies). Counted
      // per date and role, so extra people on one day do not hide a gap on another.
      const scheduledByDateRole = new Map<string, number>();
      for (const shift of shifts) {
        if (shift.status !== 'Published') continue;
        const template = templateMap.get(shift.templateId);
        if (!template) continue;
        const key = `${shift.date}::${template.role}`;
        scheduledByDateRole.set(key, (scheduledByDateRole.get(key) ?? 0) + 1);
      }
      const totalFilled = targets.reduce(
        (sum, t) => sum + Math.min(t.required, scheduledByDateRole.get(`${t.date}::${t.role}`) ?? 0),
        0,
      );

      const rate = totalRequired > 0 ? (totalFilled / totalRequired) * 100 : 0;

      // ── Uncovered revenue ─────────────────────────────────────────────────
      // computeUncoveredLoss expects ShiftTemplate with start/end (not startTime/endTime).
      const metricsTemplates = dbTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        start: t.startTime,
        end: t.endTime,
        coverage: t.coverage,
      }));
      // DbRosterShift is a structural superset of the Shift type expected by
      // computeUncoveredLoss (extra fields are ignored by the function).
      const { loss } = computeUncoveredLoss(
        targets,
        shifts as unknown as Parameters<typeof computeUncoveredLoss>[1],
        metricsTemplates,
      );

      setCoverageRate(Math.round(rate));
      setHasDemand(totalRequired > 0);
      setDraftShifts(drafts);
      setPublishedShifts(published);
      setWorkerHours(workerHoursEntries);
      setFairnessScore(Math.round(fairness * 10) / 10);
      setUncoveredRevenue(loss);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [accountId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    coverageRate,
    hasDemand,
    draftShifts,
    publishedShifts,
    workerHours,
    fairnessScore,
    uncoveredRevenue,
    loading,
    error,
    refresh: load,
  };
}
