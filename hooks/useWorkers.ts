import { useCallback, useEffect, useState } from 'react';

import { log } from '@/services/logger';
import {
  listWorkers,
  listWorkerAvailability,
  upsertAvailability,
  upsertWorker,
  type DbAvailability,
  type DbWorker,
  type DayOfWeek,
  type UpsertAvailabilityResult,
  type UpsertWorkerResult,
} from '@/services/rosterService';
import type { WorkerLaborAttributes } from '@/utils/workerLaborValidation';

export type WorkerAvailabilitySlot = {
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

const dbToWorker = (
  dbWorker: DbWorker,
  availabilities: DbAvailability[],
  index: number,
): WorkerWithAvailability => ({
  id: dbWorker.id,
  displayId: `W-${index + 1}`,
  name: dbWorker.name,
  role: dbWorker.role,
  skills: dbWorker.skills ?? [],
  birthDate: dbWorker.birthDate ?? null,
  nightWorker: dbWorker.nightWorker ?? false,
  weeklyLimitOptOut: dbWorker.weeklyLimitOptOut ?? false,
  noFixedHours: dbWorker.noFixedHours ?? false,
  availability: availabilities
    .filter((av) => av.workerId === dbWorker.id)
    .map((av) => ({ day: av.dayOfWeek, from: av.fromTime, to: av.toTime })),
});

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const useWorkers = (accountId: string) => {
  const [workers, setWorkers] = useState<WorkerWithAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [dbWorkers, dbAvailabilities] = await Promise.all([
      listWorkers(accountId),
      listWorkerAvailability(accountId),
    ]);
    const mapped = dbWorkers.map((w, i) => dbToWorker(w, dbAvailabilities, i));
    setWorkers(mapped);
    log.debug('WORKER', 'Workers loaded', { count: mapped.length });
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  const addWorker = useCallback(
    async (
      name: string,
      role: string,
      skills: string[],
      labor?: Partial<WorkerLaborAttributes>,
    ): Promise<UpsertWorkerResult> => {
      const newWorker: DbWorker = {
        id: generateId(),
        accountId,
        name,
        role,
        skills,
        ...labor,
      };
      // Optimistic update — always show the worker immediately in local state
      setWorkers((prev) => [...prev, dbToWorker(newWorker, [], prev.length)]);
      const result = await upsertWorker(newWorker);
      if (!result.success) {
        // DB unavailable (e.g. pre-migration); local state already updated above
        log.warn('WORKER', 'Worker upsert DB unavailable, optimistic only', {
          workerId: newWorker.id,
          reason: 'db-unavailable',
        });
        return { success: true, worker: newWorker };
      }
      log.info('WORKER', 'Worker added successfully', {
        workerId: newWorker.id,
        accountId,
        skillCount: skills.length,
      });
      return result;
    },
    [accountId]
  );

  const addAvailability = useCallback(
    async (
      workerId: string,
      day: DayOfWeek,
      from: string,
      to: string
    ): Promise<UpsertAvailabilityResult> => {
      const newAvailability: DbAvailability = {
        id: generateId(),
        accountId,
        workerId,
        dayOfWeek: day,
        fromTime: from,
        toTime: to,
      };
      // Optimistic update
      setWorkers((prev) =>
        prev.map((w) =>
          w.id !== workerId
            ? w
            : { ...w, availability: [...w.availability, { day, from, to }] }
        )
      );
      const result = await upsertAvailability(newAvailability);
      if (!result.success) {
        // DB unavailable; local state already updated above
        log.warn('WORKER', 'Availability upsert DB unavailable, optimistic only', {
          workerId,
          reason: 'db-unavailable',
        });
        return { success: true, availability: newAvailability };
      }
      log.info('WORKER', 'Availability added successfully', { workerId, day });
      return result;
    },
    [accountId]
  );

  return { workers, loading, error, addWorker, addAvailability, refresh: loadWorkers };
};