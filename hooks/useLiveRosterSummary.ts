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
import { addDaysToKey, isoWeekDates } from '@/utils/dateKeys';
import { computeStaffingGaps } from '@/utils/staffingGaps';

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
  /** The next MAX_UPCOMING shifts from today, for the list. */
  upcomingShifts: LiveUpcomingShift[];
  /** Every shift of this Monday-to-Sunday week ("This week", as on Analytics). */
  shiftCount: number;
  /** How many of those are published. */
  publishedCount: number;
  /** Roles still to fill this week: from today to Sunday (a gap on a past day cannot be filled). */
  staffingGaps: LiveStaffingGap[];
  /** Demand targets from today to Sunday: no gaps means "staffed" only when this is > 0. */
  windowTargets: number;
  /** What the account has set up so far (drives the "next step" card). */
  setup: { workers: number; templates: number; targets: number };
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** The upcoming list: today and the six days after it. */
const UPCOMING_DAYS = 7;
const MAX_UPCOMING = 10;

/**
 * The dates Home reads for `today` (F-12, CHG-109). "This week" is the ISO week,
 * Monday to Sunday, the same week Analytics calls "This week"; before, Home
 * counted today to today + 7, eight days that ran into next week. The staffing
 * gaps are the days of that week from today on; the upcoming list is the next
 * seven days, which may reach into next week (it is labelled "Upcoming").
 */
export const homeWindows = (today: string) => {
  const week = isoWeekDates(today);
  const upcomingTo = addDaysToKey(today, UPCOMING_DAYS - 1);
  return {
    week: { from: week[0], to: week[6] },
    gaps: { from: today, to: week[6] },
    upcoming: { from: today, to: upcomingTo },
    // One read covers all three: Monday is never after today, Sunday never after today + 6.
    fetch: { from: week[0], to: upcomingTo },
  };
};

const within = (date: string, range: { from: string; to: string }) => date >= range.from && date <= range.to;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveRosterSummary(accountId: string): LiveRosterSummary {
  const [upcomingShifts, setUpcomingShifts] = useState<LiveUpcomingShift[]>([]);
  const [staffingGaps, setStaffingGaps] = useState<LiveStaffingGap[]>([]);
  const [counts, setCounts] = useState({ shiftCount: 0, publishedCount: 0, windowTargets: 0 });
  const [setup, setSetup] = useState({ workers: 0, templates: 0, targets: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const windows = homeWindows(isoDate(0));

      // All fetches in parallel — no sequential state-change cascade
      const [rosterResult, targetsResult, workersResult, templatesResult] = await Promise.all([
        fetchRoster({ fromDate: windows.fetch.from, toDate: windows.fetch.to }),
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
      const fetched = rosterResult.ok ? rosterResult.data : [];
      const weekShifts = fetched.filter((shift) => within(shift.date, windows.week));
      const targets = targetsResult.ok ? targetsResult.targets : [];
      const workers = workersResult.ok ? workersResult.data : [];
      const dbTemplates = templatesResult.ok ? templatesResult.data : [];

      const workerMap = new Map<string, DbWorker>(workers.map((w) => [w.id, w]));
      const templateMap = new Map<string, DbShiftTemplate>(dbTemplates.map((t) => [t.id, t]));

      // Upcoming shifts (sorted by date + start time, capped at MAX_UPCOMING)
      const resolved: LiveUpcomingShift[] = fetched
        .filter((shift) => within(shift.date, windows.upcoming))
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

      // Staffing gaps: one rule for every screen (utils/staffingGaps.ts).
      const inWindow = targets.filter((target) => within(target.date, windows.gaps));
      const gaps: LiveStaffingGap[] = computeStaffingGaps(inWindow, weekShifts, dbTemplates);

      setUpcomingShifts(resolved);
      setCounts({
        shiftCount: weekShifts.length,
        publishedCount: weekShifts.filter((s) => s.status === 'Published').length,
        windowTargets: inWindow.length,
      });
      setStaffingGaps(gaps);
      setSetup({ workers: workers.length, templates: dbTemplates.length, targets: targets.length });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load roster summary.');
      setUpcomingShifts([]);
      setCounts({ shiftCount: 0, publishedCount: 0, windowTargets: 0 });
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
