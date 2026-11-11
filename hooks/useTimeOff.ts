/**
 * Days off: one-off dates a worker cannot work, loaded from and saved through
 * the secure proxy (`worker_time_off`, CHG-098). Before, they lived in the
 * device's storage only, so a second device never saw them.
 *
 * Days off an earlier version saved on this device are uploaded once, the
 * first time the stored list loads; an entry is removed from the device only
 * after the server accepted it.
 */
import { useCallback, useEffect, useRef } from 'react';

import { clearStoredExceptions, readStoredExceptions } from '@/hooks/useAvailabilityGrid';
import { log } from '@/services/logger';
import {
  deleteTimeOff,
  fetchTimeOff,
  upsertTimeOff,
  type DbTimeOff,
  type MutationResult,
  type UpsertTimeOffResult,
} from '@/services/rosterService';
import { isDateKey } from '@/utils/dateKeys';
import { newUuid } from '@/utils/schedulingValidation';
import { removeById, restoreAt, usePersistedList } from './usePersistedList';

export type TimeOff = Pick<DbTimeOff, 'id' | 'workerId' | 'date' | 'reason'>;

const toTimeOff = (row: DbTimeOff): TimeOff => ({ id: row.id, workerId: row.workerId, date: row.date, reason: row.reason });

const loadTimeOff = async () => {
  const result = await fetchTimeOff();
  return result.ok ? { ok: true as const, data: result.data.map(toTimeOff), truncated: result.truncated } : result;
};

const byDate = (a: TimeOff, b: TimeOff) => a.date.localeCompare(b.date);

/** Ids of the workers with a stored day off on `date`; an error when the list could not be read. */
export const fetchWorkersOffOn = async (date: string): Promise<{ ok: true; workerIds: Set<string> } | { ok: false; error: string }> => {
  const result = await fetchTimeOff(date);
  return result.ok ? { ok: true, workerIds: new Set(result.data.map((row) => row.workerId)) } : result;
};

/** `workerIds` are the stored workers: their device-only days off are uploaded once. */
export const useTimeOff = (accountId: string, workerIds: readonly string[]) => {
  const list = usePersistedList<TimeOff>(accountId, loadTimeOff);
  const { items, write, loaded } = list;

  const addTimeOff = useCallback(
    async (workerId: string, date: string, reason: string): Promise<UpsertTimeOffResult> => {
      if (!isDateKey(date)) return { success: false, error: 'date must be a real YYYY-MM-DD date' };
      const text = reason.trim();
      const existing = items.find((item) => item.workerId === workerId && item.date === date);
      const optimistic: TimeOff = { id: existing?.id ?? newUuid(), workerId, date, reason: text };
      const result = await write({
        id: optimistic.id,
        apply: (prev) => [...prev.filter((item) => item.id !== optimistic.id), optimistic].sort(byDate),
        commit: () => upsertTimeOff({ workerId, date, reason: text }),
        rollback: (prev) => (existing ? prev.map((item) => (item.id === optimistic.id ? existing : item)) : removeById(prev, optimistic.id)),
        reconcile: (prev, r) =>
          r.success
            ? [...prev.filter((item) => item.id !== optimistic.id && item.id !== r.timeOff.id), toTimeOff(r.timeOff)].sort(byDate)
            : prev,
      });
      if (!result.success) log.warn('WORKER', 'Day off save rolled back', { workerId, reason: result.error });
      return result;
    },
    [items, write],
  );

  const removeTimeOff = useCallback(
    async (id: string): Promise<MutationResult> => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return { success: false, error: 'Day off not found' };
      const previous = items[index];
      const result = await write({
        id,
        apply: (prev) => removeById(prev, id),
        commit: () => deleteTimeOff(id),
        rollback: (prev) => restoreAt(prev, previous, index),
      });
      if (!result.success) log.warn('WORKER', 'Day off delete rolled back', { id, reason: result.error });
      return result;
    },
    [items, write],
  );

  // One upload per worker per mount of the days this device still holds.
  const migratedRef = useRef(new Set<string>());
  const refresh = list.refresh;
  useEffect(() => {
    if (!loaded) return;
    const pending = workerIds.filter((id) => !migratedRef.current.has(id));
    if (pending.length === 0) return;
    pending.forEach((id) => migratedRef.current.add(id));
    void (async () => {
      let uploaded = 0;
      for (const workerId of pending) {
        const stored = await readStoredExceptions(workerId);
        if (stored.length === 0) continue;
        const results = await Promise.all(
          stored.filter((e) => isDateKey(e.date)).map((e) => upsertTimeOff({ workerId, date: e.date, reason: (e.reason ?? '').slice(0, 200) })),
        );
        // Keep the device copy until every day of this worker is on the server.
        if (results.every((r) => r.success)) {
          await clearStoredExceptions(workerId);
          uploaded += results.length;
        }
      }
      if (uploaded > 0) {
        log.info('WORKER', 'Device days off uploaded', { count: uploaded });
        refresh();
      }
    })();
  }, [loaded, refresh, workerIds]);

  return {
    timeOff: items,
    loading: list.loading,
    loaded,
    error: list.error,
    addTimeOff,
    removeTimeOff,
    refresh,
  };
};
