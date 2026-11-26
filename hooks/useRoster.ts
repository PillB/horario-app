/**
 * Roster shifts (with status and notified), loaded from and saved through the
 * secure proxy. Writes are optimistic and roll back, returning the server's
 * error, when the proxy refuses them (CHG-088). This replaces the old
 * "optimistic only" behaviour, where a refused write still showed as saved.
 */
import { useCallback } from 'react';

import { log } from '@/services/logger';
import {
  addRosterShifts,
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

/** `alreadyStored`: the request failed, but after a reload every shift was on the roster (a lost answer). */
export type AddShiftsResult = { success: true; alreadyStored?: boolean; error?: never } | { success: false; error: string; status?: number };

/**
 * A refusal after which the batch may still be stored: a conflict (409, the
 * slots are taken) or no clear answer (no status: the request or its answer
 * was lost; 5xx: a gateway or the server failed after the database may have
 * committed). Any other refusal (400, 402, 403) saved nothing.
 */
const mayBeStored = (status: number | undefined) => status === undefined || status === 409 || status >= 500;

const sameSlot = (a: Pick<Shift, 'date' | 'workerId' | 'templateId'>, b: Pick<Shift, 'date' | 'workerId' | 'templateId'>) =>
  a.date === b.date && a.workerId === b.workerId && a.templateId === b.templateId;

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
  const { items, write, refresh, getItems } = list;

  /** A new shift is never notified (the server stores false whatever is sent, CHG-091). */
  const addShift = useCallback(
    async (shift: Omit<Shift, 'id'>): Promise<UpsertRosterShiftResult> => {
      const checked = validateRosterShiftInput({ ...shift, notified: false, id: newUuid() });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id: checked.value.id as string, accountId };
      const result = await write({
        id: input.id,
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

  /**
   * Adds several new shifts in one request: all are stored or none
   * (applying an auto-assign result must never leave half a schedule).
   * A shift may carry its client id: the caller keeps it until the save
   * succeeds, so a retry after a lost answer is the same rows (the server
   * then replays the run instead of refusing or counting it again).
   */
  const addShifts = useCallback(
    async (shifts: (Omit<Shift, 'id'> & { id?: string })[], options: { countAutoAssign?: boolean } = {}): Promise<AddShiftsResult> => {
      const inputs: (DbRosterShift & { id: string })[] = [];
      for (const shift of shifts) {
        const checked = validateRosterShiftInput({ ...shift, notified: false, id: shift.id ?? newUuid() });
        if (!checked.ok) return { success: false, error: checked.error };
        inputs.push({ ...checked.value, id: checked.value.id as string, accountId, notified: false });
      }
      if (!inputs.length) return { success: true };
      const ids = new Set(inputs.map((s) => s.id));
      const result = await write({
        id: inputs[0].id,
        // A retry's rows may already be listed (the reload after a lost answer).
        apply: (prev) => [...prev.filter((s) => !ids.has(s.id)), ...inputs.map(dbToShift)],
        commit: () => addRosterShifts(inputs.map(({ id, date, workerId, templateId, location, status }) => ({ id, date, workerId, templateId, location, status })), options),
        rollback: (prev) => prev.filter((s) => !ids.has(s.id)),
        reconcile: (prev, r) => (r.success ? r.shifts.reduce((list, s) => upsertById(list, dbToShift(s)), prev) : prev),
        // Reloaded below, once, and awaited: the check needs the server's rows.
        reloadOnFailure: false,
      });
      if (result.success) {
        log.info('ROSTER', 'Shifts added', { count: inputs.length });
        return { success: true };
      }
      // A retry after a lost answer can be refused as "already on the roster".
      // Only a reload that succeeded says what is stored (the rolled-back
      // optimistic rows are gone by then); when every shift is there, the batch
      // is saved: say so instead of failing (QA, CHG-109).
      const reloaded = await refresh();
      const stored = reloaded && mayBeStored(result.status) ? getItems() : [];
      if (stored.length > 0 && inputs.every((input) => stored.some((s) => sameSlot(s, input)))) {
        log.info('ROSTER', 'Shifts already on the roster', { count: inputs.length });
        return { success: true, alreadyStored: true };
      }
      log.warn('ROSTER', 'Shifts add rolled back', { count: inputs.length, reason: result.error });
      return { success: false, error: result.error, ...(result.status !== undefined ? { status: result.status } : {}) };
    },
    [accountId, getItems, refresh, write],
  );

  /**
   * Saves new values (date, worker, template, location, status) for an
   * existing shift. `notified` follows the server's rule (CHG-091): a
   * `notified` in `changes` is ignored; the stored value is kept, and cleared
   * when the date, worker, template or status changes. Use notifyShift to set it.
   */
  const updateShift = useCallback(
    async (id: string, changes: RosterShiftChanges): Promise<UpsertRosterShiftResult> => {
      const previous = items.find((s) => s.id === id);
      if (!previous) return { success: false, error: 'Shift not found' };
      const next = { ...previous, ...changes };
      const reassigned =
        next.date !== previous.date ||
        next.workerId !== previous.workerId ||
        next.templateId !== previous.templateId ||
        next.status !== previous.status;
      const checked = validateRosterShiftInput({ ...next, notified: previous.notified && !reassigned, id });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id, accountId };
      const result = await write({
        id,
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
        id,
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
        id,
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
        id,
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
    addShifts,
    updateShift,
    setShiftStatus,
    notifyShift,
    removeShift,
    refresh: list.refresh,
    /** The list as last set, read synchronously: a run started right after a reload sees it (F-6). */
    getRoster: getItems,
  };
};
