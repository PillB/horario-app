/**
 * usePostingHabit — the Home "posted ahead" habit (CHG-105).
 *
 * Loads the roster for the habit window and computes, from roster.published_at
 * (set by the database), how many recent weeks were posted ahead. Nothing here
 * is self-reported, and nothing is stored on the device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchRoster } from '@/services/rosterService';
import { getBusinessTimeZone } from '@/utils/businessTimeZone';
import { todayKey } from '@/utils/dateKeys';
import {
  computePostingHabit,
  habitWindow,
  noticeGoalFor,
  type HabitShift,
  type NoticeGoal,
  type PostingHabit,
} from '@/utils/postingHabit';
import type { BusinessLocation } from '@/utils/locationValidation';

export type PostingHabitState = {
  habit: PostingHabit | null;
  goal: NoticeGoal;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function usePostingHabit(
  accountId: string,
  locations: readonly Pick<BusinessLocation, 'jurisdictionCode' | 'industry' | 'timeZone'>[],
  /** Fixed "today" for tests; the business zone's date otherwise. */
  todayOverride?: string,
): PostingHabitState {
  const goal = useMemo(() => noticeGoalFor(locations), [locations]);
  const timeZone = getBusinessTimeZone(locations[0] ?? null);
  const [shifts, setShifts] = useState<HabitShift[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const today = todayOverride ?? todayKey(timeZone);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const result = await fetchRoster(habitWindow(today, goal.days));
    if (requestId !== requestIdRef.current) return;
    if (result.ok) {
      setShifts(result.data.map(({ date, status, publishedAt }) => ({ date, status, publishedAt })));
    } else {
      setShifts(null);
      setError(result.error);
    }
    setLoading(false);
  // accountId is not sent (the tenant comes from the session), but a tenant switch must reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, today, goal.days]);

  useEffect(() => {
    void load();
  }, [load]);

  const habit = useMemo(
    () => (shifts ? computePostingHabit(shifts, { today, noticeDays: goal.days, timeZone }) : null),
    [goal.days, shifts, timeZone, today],
  );

  return { habit, goal, loading, error, refresh: load };
}
