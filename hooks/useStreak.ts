import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { daysBetweenKeys, isDateKey, toDateKey } from '@/utils/dateKeys';

type StreakState = {
  count: number;
  longest: number;
  lastActionDate: string | null;
};

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const memoryStore = new Map<string, string>();
let cachedStorage: AsyncStorageLike | null = null;

const STORAGE_PREFIX = 'streak::';
const STREAK_CAP = 365;

/** Device-local calendar date of the action (not the UTC date). */
const formatDate = (value: Date) => toDateKey(value);

const getStorageKey = (actionKey: string) => `${STORAGE_PREFIX}${actionKey}`;

const ensureStorage = async (): Promise<AsyncStorageLike> => {
  if (cachedStorage) {
    return cachedStorage;
  }

  if (AsyncStorage != null) {
    cachedStorage = AsyncStorage;
    return AsyncStorage;
  }

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    cachedStorage = {
      getItem: async (key) => window.localStorage.getItem(key),
      setItem: async (key, value) => window.localStorage.setItem(key, value),
    };
    return cachedStorage;
  }

  cachedStorage = {
    getItem: async (key) => memoryStore.get(key) ?? null,
    setItem: async (key, value) => {
      memoryStore.set(key, value);
    },
  };

  return cachedStorage;
};

const readPersistedState = async (actionKey: string): Promise<StreakState | null> => {
  const storageKey = getStorageKey(actionKey);
  try {
    const storage = await ensureStorage();
    const raw = await storage.getItem(storageKey);
    if (raw) {
      return JSON.parse(raw) as StreakState;
    }
  } catch (error) {
    console.warn('Failed to read streak from storage, falling back to memory.', error);
    const fallback = memoryStore.get(storageKey);
    if (fallback) {
      return JSON.parse(fallback) as StreakState;
    }
  }

  return null;
};

const persistState = async (actionKey: string, state: StreakState) => {
  const storageKey = getStorageKey(actionKey);
  const payload = JSON.stringify(state);

  try {
    const storage = await ensureStorage();
    await storage.setItem(storageKey, payload);
  } catch (error) {
    memoryStore.set(storageKey, payload);
    console.warn('Failed to persist streak to async storage, caching in memory.', error);
  }
};

export const computeNextStreak = (
  previous: StreakState | null,
  actionDate: Date
): StreakState => {
  const lastActionDate =
    previous?.lastActionDate && isDateKey(previous.lastActionDate) ? previous.lastActionDate : null;
  const todayLabel = formatDate(actionDate);

  if (!lastActionDate) {
    return { count: 1, longest: 1, lastActionDate: todayLabel };
  }

  const deltaDays = daysBetweenKeys(lastActionDate, todayLabel);

  if (deltaDays === 0) {
    return previous as StreakState;
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
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      const persisted = await readPersistedState(actionKey);
      if (persisted && isMounted) {
        stateRef.current = persisted;
        setState(persisted);
      }
    };

    void hydrate();

    return () => {
      isMounted = false;
    };
  }, [actionKey]);

  const recordAction = useCallback(
    async (actionDate: Date = new Date()) => {
      let nextState: StreakState | null = null;

      setState((prev) => {
        nextState = computeNextStreak(prev, actionDate);
        stateRef.current = nextState;
        return nextState;
      });

      if (!nextState) {
        nextState = computeNextStreak(stateRef.current, actionDate);
      }

      await persistState(actionKey, nextState);
      return nextState;
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
