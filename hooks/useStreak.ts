import { useCallback, useEffect, useMemo, useState } from 'react';

type StreakState = {
  count: number;
  longest: number;
  lastActionDate: string | null;
};

const memoryStore = new Map<string, StreakState>();

const STORAGE_PREFIX = 'streak::';
const STREAK_CAP = 365;

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const getStorageKey = (actionKey: string) => `${STORAGE_PREFIX}${actionKey}`;

const readPersistedState = (actionKey: string): StreakState | null => {
  const storageKey = getStorageKey(actionKey);
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        return JSON.parse(raw) as StreakState;
      }
    }
  } catch (error) {
    console.warn('Failed to read streak from storage, falling back to memory.', error);
  }

  return memoryStore.get(storageKey) ?? null;
};

const persistState = (actionKey: string, state: StreakState) => {
  const storageKey = getStorageKey(actionKey);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } else {
      memoryStore.set(storageKey, state);
    }
  } catch (error) {
    memoryStore.set(storageKey, state);
    console.warn('Failed to persist streak to local storage, caching in memory.', error);
  }
};

const daysBetween = (current: Date, previous: Date) => {
  const msInDay = 24 * 60 * 60 * 1000;
  const start = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const end = Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth(), previous.getUTCDate());
  return Math.floor((start - end) / msInDay);
};

export const computeNextStreak = (
  previous: StreakState | null,
  actionDate: Date
): StreakState => {
  const lastActionDate = previous?.lastActionDate ? new Date(`${previous.lastActionDate}T00:00:00Z`) : null;
  const todayLabel = formatDate(actionDate);

  if (!lastActionDate) {
    return { count: 1, longest: 1, lastActionDate: todayLabel };
  }

  const deltaDays = daysBetween(actionDate, lastActionDate);

  if (deltaDays === 0) {
    return previous;
  }

  if (deltaDays === 1) {
    const nextCount = Math.min(STREAK_CAP, (previous?.count ?? 0) + 1);
    return {
      count: nextCount,
      longest: Math.max(previous?.longest ?? nextCount, nextCount),
      lastActionDate: todayLabel,
    };
  }

  return {
    count: 1,
    longest: Math.max(previous?.longest ?? 1, previous?.count ?? 1, 1),
    lastActionDate: todayLabel,
  };
};

export function useStreak(actionKey: string, today: Date = new Date()) {
  const [state, setState] = useState<StreakState>({ count: 0, longest: 0, lastActionDate: null });

  useEffect(() => {
    const persisted = readPersistedState(actionKey);
    if (persisted) {
      setState(persisted);
    }
  }, [actionKey]);

  const recordAction = useCallback(
    (actionDate: Date = new Date()) => {
      setState((prev) => {
        const next = computeNextStreak(prev, actionDate);
        persistState(actionKey, next);
        return next;
      });
    },
    [actionKey]
  );

  const todayLabel = useMemo(() => formatDate(today), [today]);
  const isFresh = state.lastActionDate === todayLabel;
  const progress = useMemo(() => Math.min(1, state.count / 7), [state.count]);

  return {
    streakCount: state.count,
    longestStreak: state.longest,
    lastActionDate: state.lastActionDate,
    isFresh,
    progress,
    recordAction,
  } as const;
}
