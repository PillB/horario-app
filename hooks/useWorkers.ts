import { useCallback, useEffect, useState } from 'react';

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

export type WorkerAvailabilitySlot = {
  day: string;
  from: string;
  to: string;
};

export type WorkerWithAvailability = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  availability: WorkerAvailabilitySlot[];
};

const dbToWorker = (dbWorker: DbWorker, availabilities: DbAvailability[]): WorkerWithAvailability => ({
  id: dbWorker.id,
  name: dbWorker.name,
  role: dbWorker.role,
  skills: dbWorker.skills ?? [],
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
    setWorkers(dbWorkers.map((w) => dbToWorker(w, dbAvailabilities)));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  const addWorker = useCallback(
    async (name: string, role: string, skills: string[]): Promise<UpsertWorkerResult> => {
      const newWorker: DbWorker = {
        id: generateId(),
        accountId,
        name,
        role,
        skills,
      };
      const result = await upsertWorker(newWorker);
      if (result.success) {
        setWorkers((prev) => [...prev, dbToWorker(result.worker, [])]);
      }
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
      const result = await upsertAvailability({
        id: generateId(),
        accountId,
        workerId,
        dayOfWeek: day,
        fromTime: from,
        toTime: to,
      });
      if (result.success) {
        setWorkers((prev) =>
          prev.map((w) =>
            w.id !== workerId
              ? w
              : { ...w, availability: [...w.availability, { day, from, to }] }
          )
        );
      }
      return result;
    },
    [accountId]
  );

  return { workers, loading, error, addWorker, addAvailability, refresh: loadWorkers };
};
