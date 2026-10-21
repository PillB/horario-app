/**
 * State for a list of records stored through the secure proxy: load with a
 * request-id guard (only the latest load may update state, see
 * useDemandForecast), load errors kept apart from "no rows", and optimistic
 * writes that roll back when the server refuses them.
 *
 * Used by useWorkers, useShiftTemplates and useRoster (CHG-088).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type LoadResult<T> = { ok: true; data: T[]; truncated: boolean } | { ok: false; error: string };

type WriteResult = { success: boolean; error?: string };

export type OptimisticWrite<T, R extends WriteResult> = {
  /** Applied at once, before the request. */
  apply: (items: T[]) => T[];
  /** The request. */
  commit: () => Promise<R>;
  /** Undoes `apply` when the request fails. Must be safe after a reload replaced the list. */
  rollback: (items: T[]) => T[];
  /** Applies the server's answer (e.g. the stored row) after a success. */
  reconcile?: (items: T[], result: R) => T[];
};

/** Replaces the item with the same id, or appends it. */
export const upsertById = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex((i) => i.id === item.id);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
};

export const removeById = <T extends { id: string }>(items: T[], id: string): T[] => items.filter((i) => i.id !== id);

/** Puts `item` back at `index` unless it is already there (a reload may have restored it). */
export const restoreAt = <T extends { id: string }>(items: T[], item: T, index: number): T[] => {
  if (items.some((i) => i.id === item.id)) return items;
  const next = items.slice();
  next.splice(Math.min(index, next.length), 0, item);
  return next;
};

/**
 * `key` names what is loaded (tenant, filters). A new key clears the list and
 * loads again, so one tenant's rows never show while another's load.
 */
export const usePersistedList = <T extends { id: string }>(key: string, load: () => Promise<LoadResult<T>>) => {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const loadRef = useRef(load);
  loadRef.current = load;
  const requestIdRef = useRef(0);
  const loadInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    loadInFlightRef.current = true;
    setLoading(true);
    const result = await loadRef.current();
    if (requestIdRef.current !== requestId) return;
    loadInFlightRef.current = false;
    if (result.ok) {
      setItems(result.data);
      setTruncated(result.truncated);
      setError(null);
      setLoaded(true);
    } else {
      // Keep what is on screen; say that it could not be refreshed.
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setItems([]);
    setLoaded(false);
    setTruncated(false);
    void refresh();
    return () => {
      requestIdRef.current += 1;
      loadInFlightRef.current = false;
    };
  }, [key, refresh]);

  const write = useCallback(
    async <R extends WriteResult>({ apply, commit, rollback, reconcile }: OptimisticWrite<T, R>): Promise<R> => {
      setItems(apply);
      const result = await commit();
      if (!result.success) {
        setItems(rollback);
        return result;
      }
      if (reconcile) setItems((prev) => reconcile(prev, result));
      // A load that started before this write may not include it.
      if (loadInFlightRef.current) void refresh();
      return result;
    },
    [refresh],
  );

  return { items, setItems, loading, loaded, error, truncated, refresh, write };
};
