/**
 * Workers and their weekly availability, loaded from and saved through the
 * secure proxy (services/rosterService.ts). Writes are optimistic: the screen
 * changes at once and goes back, with the server's error returned, when the
 * proxy refuses the write (CHG-088; before, a failed save still showed as
 * saved and was gone on reload).
 */
import { useCallback, useMemo } from 'react';

import { log } from '@/services/logger';
import {
  deleteAvailability,
  deleteWorker,
  fetchWorkerAvailability,
  fetchWorkers,
  upsertAvailability,
  upsertWorker,
  type DayOfWeek,
  type DbAvailability,
  type DbWorker,
  type MutationResult,
  type UpsertAvailabilityResult,
  type UpsertWorkerResult,
} from '@/services/rosterService';
import { newUuid, validateAvailabilityInput, validateWorkerInput } from '@/utils/schedulingValidation';
import type { WorkerLaborAttributes } from '@/utils/workerLaborValidation';
import { removeById, restoreAt, upsertById, usePersistedList, type LoadResult } from './usePersistedList';

export type WorkerAvailabilitySlot = {
  /** The stored slot's id (absent only on slots built outside this hook). */
  id?: string;
  day: string;
  from: string;
  to: string;
};

export type WorkerWithAvailability = {
  id: string;
  /** Short human-readable identifier shown in the UI, e.g. "W-1". Derived from list position. */
  displayId: string;
  name: string;
  role: string;
  skills: string[];
  availability: WorkerAvailabilitySlot[];
  birthDate?: string | null;
  nightWorker?: boolean;
  weeklyLimitOptOut?: boolean;
  noFixedHours?: boolean;
};

export type WorkerChanges = { name: string; role: string; skills: string[] } & Partial<WorkerLaborAttributes>;

type StoredWorker = Omit<WorkerWithAvailability, 'displayId'>;

const toSlot = (av: DbAvailability): WorkerAvailabilitySlot => ({ id: av.id, day: av.dayOfWeek, from: av.fromTime, to: av.toTime });

const toStoredWorker = (db: DbWorker, availability: WorkerAvailabilitySlot[]): StoredWorker => ({
  id: db.id,
  name: db.name,
  role: db.role,
  skills: db.skills ?? [],
  birthDate: db.birthDate ?? null,
  nightWorker: db.nightWorker ?? false,
  weeklyLimitOptOut: db.weeklyLimitOptOut ?? false,
  noFixedHours: db.noFixedHours ?? false,
  availability,
});

const loadWorkers = async (): Promise<LoadResult<StoredWorker>> => {
  const [workers, availability] = await Promise.all([fetchWorkers(), fetchWorkerAvailability()]);
  if (!workers.ok) return workers;
  if (!availability.ok) return availability;
  const slots = new Map<string, WorkerAvailabilitySlot[]>();
  availability.data.forEach((av) => slots.set(av.workerId, [...(slots.get(av.workerId) ?? []), toSlot(av)]));
  log.debug('WORKER', 'Workers loaded', { count: workers.data.length });
  return {
    ok: true,
    data: workers.data.map((w) => toStoredWorker(w, slots.get(w.id) ?? [])),
    truncated: workers.truncated || availability.truncated,
  };
};

const withSlots = (items: StoredWorker[], workerId: string, change: (slots: WorkerAvailabilitySlot[]) => WorkerAvailabilitySlot[]) =>
  items.map((w) => (w.id === workerId ? { ...w, availability: change(w.availability) } : w));

/** `accountId` only names the tenant (a new one reloads); the proxy takes it from the session. */
export const useWorkers = (accountId: string) => {
  const list = usePersistedList<StoredWorker>(accountId, loadWorkers);
  const { items, write } = list;

  const workers = useMemo<WorkerWithAvailability[]>(
    () => items.map((w, i) => ({ ...w, displayId: `W-${i + 1}` })),
    [items],
  );

  const addWorker = useCallback(
    async (name: string, role: string, skills: string[], labor?: Partial<WorkerLaborAttributes>): Promise<UpsertWorkerResult> => {
      const checked = validateWorkerInput({ id: newUuid(), name, role, skills, ...labor });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id: checked.value.id as string, accountId };
      const optimistic = toStoredWorker(input, []);
      const result = await write({
        apply: (prev) => [...prev, optimistic],
        commit: () => upsertWorker(input),
        rollback: (prev) => removeById(prev, input.id),
        reconcile: (prev, r) => (r.success ? upsertById(prev, toStoredWorker(r.worker, prev.find((w) => w.id === r.worker.id)?.availability ?? [])) : prev),
      });
      if (result.success) log.info('WORKER', 'Worker added', { workerId: input.id, skillCount: skills.length });
      else log.warn('WORKER', 'Worker add rolled back', { workerId: input.id, reason: result.error });
      return result;
    },
    [accountId, write],
  );

  /** Saves new values for an existing worker; labor fields left out keep their stored value. */
  const updateWorker = useCallback(
    async (id: string, changes: WorkerChanges): Promise<UpsertWorkerResult> => {
      const previous = items.find((w) => w.id === id);
      if (!previous) return { success: false, error: 'Worker not found' };
      const checked = validateWorkerInput({ ...changes, id });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id, accountId };
      const result = await write({
        apply: (prev) => prev.map((w) => (w.id === id ? { ...w, ...checked.value, id } : w)),
        commit: () => upsertWorker(input),
        rollback: (prev) => prev.map((w) => (w.id === id ? previous : w)),
        reconcile: (prev, r) => (r.success ? prev.map((w) => (w.id === id ? toStoredWorker(r.worker, w.availability) : w)) : prev),
      });
      if (!result.success) log.warn('WORKER', 'Worker update rolled back', { workerId: id, reason: result.error });
      return result;
    },
    [accountId, items, write],
  );

  /** Deleting a worker deletes their availability; the proxy refuses (409) while shifts reference them. */
  const removeWorker = useCallback(
    async (id: string): Promise<MutationResult> => {
      const index = items.findIndex((w) => w.id === id);
      if (index === -1) return { success: false, error: 'Worker not found' };
      const previous = items[index];
      const result = await write({
        apply: (prev) => removeById(prev, id),
        commit: () => deleteWorker(id),
        rollback: (prev) => restoreAt(prev, previous, index),
      });
      if (!result.success) log.warn('WORKER', 'Worker delete rolled back', { workerId: id, reason: result.error });
      return result;
    },
    [items, write],
  );

  const addAvailability = useCallback(
    async (workerId: string, day: DayOfWeek, from: string, to: string): Promise<UpsertAvailabilityResult> => {
      const checked = validateAvailabilityInput({ id: newUuid(), workerId, dayOfWeek: day, fromTime: from, toTime: to });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id: checked.value.id as string, accountId };
      const result = await write({
        apply: (prev) => withSlots(prev, workerId, (slots) => [...slots, { id: input.id, day, from, to }]),
        commit: () => upsertAvailability(input),
        rollback: (prev) => withSlots(prev, workerId, (slots) => slots.filter((s) => s.id !== input.id)),
        reconcile: (prev, r) =>
          r.success
            ? withSlots(prev, workerId, (slots) => [...slots.filter((s) => s.id !== input.id && s.id !== r.availability.id), toSlot(r.availability)])
            : prev,
      });
      if (result.success) log.info('WORKER', 'Availability added', { workerId, day });
      else log.warn('WORKER', 'Availability add rolled back', { workerId, reason: result.error });
      return result;
    },
    [accountId, write],
  );

  const removeAvailability = useCallback(
    async (workerId: string, slotId: string): Promise<MutationResult> => {
      const worker = items.find((w) => w.id === workerId);
      const index = worker?.availability.findIndex((s) => s.id === slotId) ?? -1;
      if (!worker || index === -1) return { success: false, error: 'Availability not found' };
      const previous = worker.availability[index];
      const result = await write({
        apply: (prev) => withSlots(prev, workerId, (slots) => slots.filter((s) => s.id !== slotId)),
        commit: () => deleteAvailability(slotId),
        rollback: (prev) =>
          withSlots(prev, workerId, (slots) => {
            if (slots.some((s) => s.id === slotId)) return slots;
            const next = slots.slice();
            next.splice(Math.min(index, next.length), 0, previous);
            return next;
          }),
      });
      if (!result.success) log.warn('WORKER', 'Availability delete rolled back', { workerId, reason: result.error });
      return result;
    },
    [items, write],
  );

  return {
    workers,
    loading: list.loading,
    /** True once a load has succeeded for this tenant. */
    loaded: list.loaded,
    /** The last load's error (the list keeps its previous rows). */
    error: list.error,
    /** More rows than the client reads (LIST_MAX_PAGES pages). */
    truncated: list.truncated,
    addWorker,
    updateWorker,
    removeWorker,
    addAvailability,
    removeAvailability,
    refresh: list.refresh,
  };
};
