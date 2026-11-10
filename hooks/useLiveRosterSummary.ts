/**
 * useLiveRosterSummary — live home screen data.
 *
 * Fetches the upcoming roster, workers, templates, and demand targets in
 * parallel, resolves names, and computes staffing gaps.
 * Replaces the hardcoded arrays in app/(tabs)/index.tsx.
 *
 * All data is fetched inside a single load() call to avoid the nested-async
 * state-update cascade that would result from depending on useShiftTemplates.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRoster,
  fetchShiftTemplates,
  fetchWorkers,
  type DbRosterShift,
  type DbWorker,
  type DbShiftTemplate,
} from '@/services/rosterService';
import { fetchOverrideTargets, type DemandForecast } from '@/services/demandForecast';
import { isoDate } from '@/utils/schedulerUtils';

// ─── Public types ─────────────────────────────────────────────────────────────

export type LiveUpcomingShift = DbRosterShift & {
  workerName: string;
  templateName: string;
  templateStart: string;
  templateEnd: string;
};

export type LiveStaffingGap = DemandForecast & {
  scheduled: number;
  gap: number;
};

export type LiveRosterSummary = {
  /** The next MAX_UPCOMING shifts, for the list. */
  upcomingShifts: LiveUpcomingShift[];
  /** Every shift in the next UPCOMING_DAYS (not capped like upcomingShifts). */
  shiftCount: number;
  /** How many of those are published. */
  publishedCount: number;
  staffingGaps: LiveStaffingGap[];
  /** What the account has set up so far (drives the "next step" card). */
  setup: { workers: number; templates: number; targets: number };
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const UPCOMING_DAYS = 7;
const MAX_UPCOMING = 10;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveRosterSummary(accountId: string): LiveRosterSummary {
  const [upcomingShifts, setUpcomingShifts] = useState<LiveUpcomingShift[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<LiveStaffingGap[]>([]);
  const [counts, setCounts] = useState({ shiftCount: 0, publishedCount: 0 });
  const [setup, setSetup] = useState({ workers: 0, templates: 0, targets: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const fromDate = isoDate(0);
      const toDate = isoDate(UPCOMING_DAYS);

      // All fetches in parallel — no sequential state-change cascade
      const [rosterResult, targetsResult, workersResult, templatesResult] = await Promise.all([
        fetchRoster({ fromDate, toDate }),
        // Every stored target: the setup checklist asks whether any exists,
        // and the gaps below keep the ones inside the roster window.
        fetchOverrideTargets(),
        fetchWorkers(),
        fetchShiftTemplates(),
      ]);

      if (requestId !== requestIdRef.current) return; // stale request

      // A failed load is reported: an empty list would read as an empty account.
      const failed = [rosterResult, targetsResult, workersResult, templatesResult].find((r) => !r.ok);
      if (failed && !failed.ok) throw new Error(failed.error);
      const shifts = rosterResult.ok ? rosterResult.data : [];
      const targets = targetsResult.ok ? targetsResult.targets : [];
      const workers = workersResult.ok ? workersResult.data : [];
      const dbTemplates = templatesResult.ok ? templatesResult.data : [];

      const workerMap = new Map<string, DbWorker>(workers.map((w) => [w.id, w]));
      const templateMap = new Map<string, DbShiftTemplate>(dbTemplates.map((t) => [t.id, t]));

      // Upcoming shifts (sorted by date + start time, capped at MAX_UPCOMING)
      const resolved: LiveUpcomingShift[] = shifts
        .map((shift) => {
          const worker = workerMap.get(shift.workerId);
          const template = templateMap.get(shift.templateId);
          return {
            ...shift,
            workerName: worker?.name ?? shift.workerId,
            templateName: template?.name ?? shift.templateId,
            templateStart: template?.startTime ?? '??:??',
            templateEnd: template?.endTime ?? '??:??',
          };
        })
        .sort((a, b) => {
          const aTime = `${a.date}T${a.templateStart}`;
          const bTime = `${b.date}T${b.templateStart}`;
          return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
        })
        .slice(0, MAX_UPCOMING);

      // Staffing gaps: demand targets where coverage (published only) < required
      const coverageByDateRole = shifts
        .filter((s) => s.status === 'Published')
        .reduce<Record<string, number>>((acc, shift) => {
          const template = templateMap.get(shift.templateId);
          if (!template) return acc;
          const key = `${shift.date}::${template.role}`;
          // A roster row is one worker in one position; `coverage` is how many
          // the template needs, not how many this row supplies.
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});

      const gaps: LiveStaffingGap[] = targets
        .filter((target) => target.date >= fromDate && target.date <= toDate)
        .map((target) => {
          const scheduled = coverageByDateRole[`${target.date}::${target.role}`] ?? 0;
          return { ...target, scheduled, gap: Math.max(0, target.required - scheduled) };
        })
        .filter((t) => t.gap > 0);

      setUpcomingShifts(resolved);
      setCounts({ shiftCount: shifts.length, publishedCount: shifts.filter((s) => s.status === 'Published').length });
      setStaffingGaps(gaps);
      setSetup({ workers: workers.length, templates: dbTemplates.length, targets: targets.length });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load roster summary.');
      setUpcomingShifts([]);
      setCounts({ shiftCount: 0, publishedCount: 0 });
      setStaffingGaps([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  // accountId is not sent (the server takes the tenant from the session), but
  // a tenant switch must reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  return { upcomingShifts, ...counts, staffingGaps, setup, loading, error, refresh: load };
}
