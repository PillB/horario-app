/**
 * Roster shifts (with status and notified), loaded from and saved through the
 * secure proxy. Writes are optimistic and roll back, returning the server's
 * error, when the proxy refuses them (CHG-088). This replaces the old
 * "optimistic only" behaviour, where a refused write still showed as saved.
 */
import { useCallback } from 'react';

import { log } from '@/services/logger';
import {
  deleteRosterShift,
  fetchRoster,
  markShiftNotified,
  updateShiftStatus,
  upsertRosterShift,
  type DbRosterShift,
  type MutationResult,
  type RosterFilters,
  type ShiftUpdateResult,
  type UpsertRosterShiftResult,
} from '@/services/rosterService';
import type { Shift } from '@/utils/schedulerMetrics';
import { newUuid, validateRosterShiftInput } from '@/utils/schedulingValidation';
import { removeById, restoreAt, upsertById, usePersistedList, type LoadResult } from './usePersistedList';

const dbToShift = (db: Pick<DbRosterShift, 'id' | 'date' | 'workerId' | 'templateId' | 'location' | 'status' | 'notified'>): Shift => ({
  id: db.id,
  date: db.date,
  workerId: db.workerId,
  templateId: db.templateId,
  location: db.location ?? '',
  status: db.status,
  notified: db.notified,
});

export type RosterShiftChanges = Partial<Omit<Shift, 'id'>>;

/** `accountId` only names the tenant (a new one reloads); the proxy takes it from the session. */
export const useRoster = (accountId: string, filters?: RosterFilters) => {
  // Stable key: a new filters object with the same values does not reload.
  const filtersKey = JSON.stringify(filters ?? null);
  const load = useCallback(async (): Promise<LoadResult<Shift>> => {
    const result = await fetchRoster(JSON.parse(filtersKey) ?? undefined);
    if (!result.ok) return result;
    log.debug('ROSTER', 'Roster loaded', { count: result.data.length });
    return { ok: true, data: result.data.map(dbToShift), truncated: result.truncated };
  }, [filtersKey]);
  const list = usePersistedList<Shift>(`${accountId}|${filtersKey}`, load);
  const { items, write } = list;

  const addShift = useCallback(
    async (shift: Omit<Shift, 'id'>): Promise<UpsertRosterShiftResult> => {
      const checked = validateRosterShiftInput({ ...shift, id: newUuid() });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id: checked.value.id as string, accountId };
      const result = await write({
        apply: (prev) => [...prev, dbToShift(input)],
        commit: () => upsertRosterShift(input),
        rollback: (prev) => removeById(prev, input.id),
        reconcile: (prev, r) => (r.success ? upsertById(prev, dbToShift(r.shift)) : prev),
      });
      if (result.success) log.info('ROSTER', 'Shift added', { shiftId: input.id, date: input.date, status: input.status });
      else log.warn('ROSTER', 'Shift add rolled back', { shiftId: input.id, reason: result.error });
      return result;
    },
    [accountId, write],
  );

  /** Saves new values (date, worker, template, location, status, notified) for an existing shift. */
  const updateShift = useCallback(
    async (id: string, changes: RosterShiftChanges): Promise<UpsertRosterShiftResult> => {
      const previous = items.find((s) => s.id === id);
      if (!previous) return { success: false, error: 'Shift not found' };
      const checked = validateRosterShiftInput({ ...previous, ...changes, id });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id, accountId };
      const result = await write({
        apply: (prev) => prev.map((s) => (s.id === id ? dbToShift(input) : s)),
        commit: () => upsertRosterShift(input),
        rollback: (prev) => prev.map((s) => (s.id === id ? previous : s)),
        reconcile: (prev, r) => (r.success ? upsertById(prev, dbToShift(r.shift)) : prev),
      });
      if (!result.success) log.warn('ROSTER', 'Shift update rolled back', { shiftId: id, reason: result.error });
      return result;
    },
    [accountId, items, write],
  );

  /** Publish or unpublish. A change of status clears `notified` (here and on the server). */
  const setShiftStatus = useCallback(
    async (id: string, status: 'Draft' | 'Published'): Promise<ShiftUpdateResult> => {
      const previous = items.find((s) => s.id === id);
      if (!previous) return { success: false, error: 'Shift not found' };
      const result = await write({
        apply: (prev) => prev.map((s) => (s.id === id && s.status !== status ? { ...s, status, notified: false } : s)),
        commit: () => updateShiftStatus(id, status),
        rollback: (prev) => prev.map((s) => (s.id === id ? previous : s)),
        reconcile: (prev, r) => (r.success && r.shift ? upsertById(prev, dbToShift(r.shift)) : prev),
      });
      if (result.success) log.info('ROSTER', 'Shift status changed', { shiftId: id, status });
      else log.warn('ROSTER', 'Shift status change rolled back', { shiftId: id, reason: result.error });
      return result;
    },
    [items, write],
  );

  /** Records that the worker was sent the shift. The server refuses (409) a draft. */
  const notifyShift = useCallback(
    async (id: string): Promise<ShiftUpdateResult> => {
      const previous = items.find((s) => s.id === id);
      if (!previous) return { success: false, error: 'Shift not found' };
      const result = await write({
        apply: (prev) => prev.map((s) => (s.id === id ? { ...s, notified: true } : s)),
        commit: () => markShiftNotified(id),
        rollback: (prev) => prev.map((s) => (s.id === id ? previous : s)),
        reconcile: (prev, r) => (r.success && r.shift ? upsertById(prev, dbToShift(r.shift)) : prev),
      });
      if (result.success) log.info('ROSTER', 'Shift marked notified', { shiftId: id });
      else log.warn('ROSTER', 'Shift notify rolled back', { shiftId: id, reason: result.error });
      return result;
    },
    [items, write],
  );

  const removeShift = useCallback(
    async (id: string): Promise<MutationResult> => {
      const index = items.findIndex((s) => s.id === id);
      if (index === -1) return { success: false, error: 'Shift not found' };
      const previous = items[index];
      const result = await write({
        apply: (prev) => removeById(prev, id),
        commit: () => deleteRosterShift(id),
        rollback: (prev) => restoreAt(prev, previous, index),
      });
      if (!result.success) log.warn('ROSTER', 'Shift delete rolled back', { shiftId: id, reason: result.error });
      return result;
    },
    [items, write],
  );

  return {
    roster: items,
    loading: list.loading,
    loaded: list.loaded,
    error: list.error,
    truncated: list.truncated,
    addShift,
    updateShift,
    setShiftStatus,
    notifyShift,
    removeShift,
    refresh: list.refresh,
  };
};
