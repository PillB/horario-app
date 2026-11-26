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
  /**
   * False when the caller reloads after a failure itself (it awaits `refresh`
   * to read what the server holds), so the list is not loaded twice.
   */
  reloadOnFailure?: boolean;
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

const NO_ITEMS: never[] = [];

/**
 * `key` names what is loaded (tenant, filters). A new key clears the list and
 * loads again, so one tenant's rows never show while another's load. The
 * render in which the key changes (before the effect clears the state) shows
 * no rows, not loaded, no error: the state still belongs to the old key (QA L2, CHG-109).
 */
export const usePersistedList = <T extends { id: string }>(key: string, load: () => Promise<LoadResult<T>>) => {
  const [items, setItemsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  /** The key the state above belongs to. */
  const [stateKey, setStateKey] = useState(key);

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

  /** True when this load succeeded and its rows are what the list now holds. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const requestId = ++requestIdRef.current;
    loadInFlightRef.current = true;
    setLoading(true);
    const result = await loadRef.current();
    if (requestIdRef.current !== requestId) return false;
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
    return result.ok;
  }, [update]);

  useEffect(() => {
    epochRef.current += 1;
    pendingRef.current = new Map();
    staleRef.current = new Set();
    update(() => []);
    setLoaded(false);
    setTruncated(false);
    setError(null);
    setStateKey(key);
    void refresh();
    return () => {
      requestIdRef.current += 1;
      loadInFlightRef.current = false;
    };
  }, [key, refresh, update]);

  const write = useCallback(
    async <R extends WriteResult>({ id, apply, commit, rollback, reconcile, reloadOnFailure = true }: OptimisticWrite<T, R>): Promise<R> => {
      const epoch = epochRef.current;
      const pending = pendingRef.current;
      const stale = staleRef.current;
      update(apply);
      const applied = itemsRef.current.find((i) => i.id === id);
      pending.set(id, (pending.get(id) ?? 0) + 1);

      const result = await commit();
      // The tenant (or filters) changed while the request ran: this is not that list any more.
      if (epochRef.current !== epoch) return result;

      let reloadAfterFailure = false;
      const unchanged = itemsRef.current.find((i) => i.id === id) === applied;
      if (!unchanged) stale.add(id);
      else if (!result.success) {
        update(rollback);
        // The server may have saved it and only the answer was lost: show what is stored,
        // so a retry is not a second copy.
        reloadAfterFailure = reloadOnFailure;
      }
      else if (reconcile) update((prev) => reconcile(prev, result));

      const left = (pending.get(id) ?? 1) - 1;
      if (left > 0) pending.set(id, left);
      else pending.delete(id);

      if (left === 0 && stale.delete(id)) void refresh();
      else if (reloadAfterFailure) void refresh();
      // A load that started before this write may not include it.
      else if (result.success && loadInFlightRef.current) void refresh();
      return result;
    },
    [refresh, update],
  );

  /** The list as last set, read synchronously (e.g. right after an awaited refresh). */
  const getItems = useCallback(() => itemsRef.current, []);

  const current = stateKey === key;
  return {
    items: current ? items : (NO_ITEMS as T[]),
    loading: current ? loading : true,
    loaded: current && loaded,
    error: current ? error : null,
    truncated: current && truncated,
    refresh,
    write,
    getItems,
  };
};

/**
 * True when `row` already holds every value in `wanted`. A key `wanted` leaves
 * undefined is not part of the edit; a stored null and an absent field are the same.
 */
export const sameValues = <T extends object>(row: T, wanted: Partial<T>): boolean =>
  (Object.keys(wanted) as (keyof T)[])
    .filter((key) => wanted[key] !== undefined)
    .every((key) => JSON.stringify(row[key] ?? null) === JSON.stringify(wanted[key]));

/**
 * The outcome of an edit the server refused, judged from the list reloaded
 * after it (`reloaded` false = the reload failed, nothing is known):
 * - `saved`: the stored row already holds the values (the user's own save
 *   went through and only its answer was lost, or the same edit was made elsewhere);
 * - `conflict`: 409 and the row was changed since the edit read it (its
 *   `updatedAt` is not `sentUpdatedAt`, the one the save sent); `row` is that
 *   version, whose `updatedAt` a save must send to replace it. A 409 on a row
 *   nobody changed is another rule (a template edit that would double-book
 *   someone), so it is `failed` and keeps the server's reason;
 * - `failed`: anything else (deleted, refused for another reason, unknown).
 */
export type RefusedEdit<T> = { kind: 'saved' } | { kind: 'conflict'; row: T } | { kind: 'failed' };

export const judgeRefusedEdit = <T extends { id: string; updatedAt?: string }>(
  reloaded: boolean,
  rows: T[],
  id: string,
  wanted: Partial<T>,
  status: number | undefined,
  sentUpdatedAt: string | undefined,
): RefusedEdit<T> => {
  const row = reloaded ? rows.find((r) => r.id === id) : undefined;
  if (!row) return { kind: 'failed' };
  if (sameValues(row, wanted)) return { kind: 'saved' };
  const changedSince = sentUpdatedAt !== undefined && row.updatedAt !== sentUpdatedAt;
  return status === 409 && changedSince ? { kind: 'conflict', row } : { kind: 'failed' };
};
