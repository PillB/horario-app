/**
 * useAnalytics — live scheduling-performance metrics.
 *
 * Fetches all roster shifts, workers, templates, and demand targets in parallel
 * (no date filter — all-time view) and computes the key SMB metrics:
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
  type DbRosterShift,
  type DbShiftTemplate,
  type DbWorker,
} from '@/services/rosterService';
import { loadDemandTargets } from '@/services/demandForecast';
import { computeUncoveredLoss } from '@/app/(tabs)/schedulerMetrics';
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
  draftShifts: number;          // count of Draft status
  publishedShifts: number;      // count of Published status
  workerHours: WorkerHoursEntry[]; // sorted descending by hours
  fairnessScore: number;        // std dev of worker hours (lower = fairer)
  uncoveredRevenue: number;     // $ from computeUncoveredLoss
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

// ─── Pure computation helpers (exported for testing) ─────────────────────────

/** Computes hours for a single shift from its template duration. */
export const shiftHours = (template: DbShiftTemplate): number => {
  const start = parseTimeToMinutes(template.startTime);
  const end = parseTimeToMinutes(template.endTime);
  // Handle overnight shifts (end < start) gracefully.
  return end > start ? (end - start) / 60 : 0;
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

export function useAnalytics(accountId: string): AnalyticsSummary {
  const [coverageRate, setCoverageRate] = useState(0);
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
      // Fetch all four data sources in parallel — no date filter = all-time view.
      const [shifts, workers, dbTemplates, targets] = await Promise.all([
        listRoster(accountId),
        listWorkers(accountId),
        listShiftTemplates(accountId),
        loadDemandTargets(),
      ]);

      if (requestId !== requestIdRef.current) return;

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

      let totalScheduled = 0;
      for (const shift of shifts) {
        if (shift.status !== 'Published') continue;
        const template = templateMap.get(shift.templateId);
        if (!template) continue;
        totalScheduled += template.coverage ?? 1;
      }

      const rate =
        totalRequired > 0 ? Math.min(100, (totalScheduled / totalRequired) * 100) : 0;

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
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    coverageRate,
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
