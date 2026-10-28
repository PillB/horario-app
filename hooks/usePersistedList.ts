/**
 * State for a list of records stored through the secure proxy: load with a
 * request-id guard (only the latest load may update state, see
 * useDemandForecast), load errors kept apart from "no rows", and optimistic
 * writes that roll back when the server refuses them.
 *
 * Writes that finish out of order (CHG-091, QA G2): a write rolls back, or
 * applies the server's answer, only while its item is still the value that
 * write applied. When something replaced the item since (a later write, that
 * write's answer, a reload), this outcome is not applied; once the last write
 * in flight for that id settles, the list reloads from the server, which
 * holds the truth. Chosen over queueing writes per id: the screen keeps
 * answering at once, a slow request does not hold back the next one, and a
 * reload in between is covered by the same check.
 *
 * Tenant switches (CHG-091, QA G3): the outcome of a write is dropped when
 * the key changed while it was in flight, so one tenant's row never lands in
 * another tenant's list.
 *
 * Used by useWorkers, useShiftTemplates and useRoster (CHG-088).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type LoadResult<T> = { ok: true; data: T[]; truncated: boolean } | { ok: false; error: string };

type WriteResult = { success: boolean; error?: string };

export type OptimisticWrite<T, R extends WriteResult> = {
  /** The item the write changes (for a nested change such as an availability slot, its parent). */
  id: string;
  /** Applied at once, before the request. */
  apply: (items: T[]) => T[];
  /** The request. */
  commit: () => Promise<R>;
  /** Undoes `apply` when the request fails. Runs only while the item is still what `apply` left. */
  rollback: (items: T[]) => T[];
  /** Applies the server's answer (e.g. the stored row) after a success. Same condition as `rollback`. */
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
  const [items, setItemsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // The list as last set, so a write can compare its item synchronously.
  const itemsRef = useRef<T[]>([]);
  const update = useCallback((change: (prev: T[]) => T[]) => {
    itemsRef.current = change(itemsRef.current);
    setItemsState(itemsRef.current);
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;
  const requestIdRef = useRef(0);
  const loadInFlightRef = useRef(false);
  /** Bumped on every key change; a write started under another epoch changes nothing. */
  const epochRef = useRef(0);
  /** Writes in flight per item id, and the ids whose outcome was not applied. */
  const pendingRef = useRef(new Map<string, number>());
  const staleRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    loadInFlightRef.current = true;
    setLoading(true);
    const result = await loadRef.current();
    if (requestIdRef.current !== requestId) return;
    loadInFlightRef.current = false;
    if (result.ok) {
      update(() => result.data);
      setTruncated(result.truncated);
      setError(null);
      setLoaded(true);
    } else {
      // Keep what is on screen; say that it could not be refreshed.
      setError(result.error);
    }
    setLoading(false);
  }, [update]);

  useEffect(() => {
    epochRef.current += 1;
    pendingRef.current = new Map();
    staleRef.current = new Set();
    update(() => []);
    setLoaded(false);
    setTruncated(false);
    void refresh();
    return () => {
      requestIdRef.current += 1;
      loadInFlightRef.current = false;
    };
  }, [key, refresh, update]);

  const write = useCallback(
    async <R extends WriteResult>({ id, apply, commit, rollback, reconcile }: OptimisticWrite<T, R>): Promise<R> => {
      const epoch = epochRef.current;
      const pending = pendingRef.current;
      const stale = staleRef.current;
      update(apply);
      const applied = itemsRef.current.find((i) => i.id === id);
      pending.set(id, (pending.get(id) ?? 0) + 1);

      const result = await commit();
      // The tenant (or filters) changed while the request ran: this is not that list any more.
      if (epochRef.current !== epoch) return result;

      const unchanged = itemsRef.current.find((i) => i.id === id) === applied;
      if (!unchanged) stale.add(id);
      else if (!result.success) update(rollback);
      else if (reconcile) update((prev) => reconcile(prev, result));

      const left = (pending.get(id) ?? 1) - 1;
      if (left > 0) pending.set(id, left);
      else pending.delete(id);

      if (left === 0 && stale.delete(id)) void refresh();
      // A load that started before this write may not include it.
      else if (result.success && loadInFlightRef.current) void refresh();
      return result;
    },
    [refresh, update],
  );

  return { items, loading, loaded, error, truncated, refresh, write };
};
