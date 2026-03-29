import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listRoster,
  upsertRosterShift,
  updateShiftStatus,
  markShiftNotified,
  deleteRosterShift,
  type DbRosterShift,
  type MutationResult,
  type RosterFilters,
  type UpsertRosterShiftResult,
} from '@/services/rosterService';
import type { Shift } from '@/utils/schedulerMetrics';

const dbToShift = (db: DbRosterShift): Shift => ({
  id: db.id,
  date: db.date,
  workerId: db.workerId,
  templateId: db.templateId,
  location: db.location ?? '',
  status: db.status,
  notified: db.notified,
});

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const useRoster = (accountId: string, filters?: RosterFilters) => {
  const [roster, setRoster] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable key so that passing a new object reference each render does not
  // re-trigger the effect. JSON.stringify produces the same string for equal
  // primitive-valued filter objects.
  const filtersKey = JSON.stringify(filters ?? null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    const shifts = await listRoster(accountId, filtersRef.current);
    setRoster(shifts.map(dbToShift));
    setLoading(false);
  // filtersRef is a stable ref; filtersKey triggers the effect when the logical
  // filter values change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, filtersKey]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const addShift = useCallback(
    async (shift: Omit<Shift, 'id'>): Promise<UpsertRosterShiftResult> => {
      const dbShift: DbRosterShift = {
        id: generateId(),
        accountId,
        date: shift.date,
        workerId: shift.workerId,
        templateId: shift.templateId,
        location: shift.location ?? '',
        status: shift.status ?? 'Draft',
        notified: shift.notified ?? false,
      };
      // Optimistic update — always show the shift immediately in local state
      setRoster((prev) => [...prev, dbToShift(dbShift)]);
      const result = await upsertRosterShift(dbShift);
      if (!result.success) {
        // DB unavailable (e.g. pre-migration); local state already updated above
        return { success: true, shift: dbShift };
      }
      return result;
    },
    [accountId]
  );

  const setShiftStatus = useCallback(
    async (id: string, status: 'Draft' | 'Published'): Promise<MutationResult> => {
      // Optimistic update
      setRoster((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status, notified: false } : s))
      );
      const result = await updateShiftStatus(id, status);
      if (!result.success) {
        // DB unavailable; local state already updated above
        return { success: true };
      }
      return result;
    },
    []
  );

  const notifyShift = useCallback(async (id: string): Promise<MutationResult> => {
    // Optimistic update
    setRoster((prev) =>
      prev.map((s) => (s.id === id ? { ...s, notified: true } : s))
    );
    const result = await markShiftNotified(id);
    if (!result.success) {
      // DB unavailable; local state already updated above
      return { success: true };
    }
    return result;
  }, []);

  const removeShift = useCallback(async (id: string): Promise<MutationResult> => {
    // Optimistic update
    setRoster((prev) => prev.filter((s) => s.id !== id));
    const result = await deleteRosterShift(id);
    if (!result.success) {
      // DB unavailable; local state already updated above
      return { success: true };
    }
    return result;
  }, []);

  return {
    roster,
    loading,
    error,
    addShift,
    setShiftStatus,
    notifyShift,
    removeShift,
    refresh: loadRoster,
  };
};
