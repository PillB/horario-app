import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trackEvent } from '@/services/analytics';

const STORAGE_KEY = 'horario:ttfs';

type PersistedMetrics = {
  totalSessions: number;
  totalTimeMs: number;
  firstSchedulePublishedAt: number | null;
};

type UseTimeToScheduleReturn = {
  startSession: () => void;
  markSchedulePublished: () => Promise<void>;
  sessionDurationMs: number | null;
  totalSessions: number;
  avgTimeMs: number | null;
  resetSession: () => Promise<void>;
};

const DEFAULT_METRICS: PersistedMetrics = {
  totalSessions: 0,
  totalTimeMs: 0,
  firstSchedulePublishedAt: null,
};

async function loadMetrics(): Promise<PersistedMetrics> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_METRICS };
    const parsed = JSON.parse(raw) as Partial<PersistedMetrics>;
    return {
      totalSessions:
        typeof parsed.totalSessions === 'number' ? parsed.totalSessions : 0,
      totalTimeMs:
        typeof parsed.totalTimeMs === 'number' ? parsed.totalTimeMs : 0,
      firstSchedulePublishedAt:
        typeof parsed.firstSchedulePublishedAt === 'number'
          ? parsed.firstSchedulePublishedAt
          : null,
    };
  } catch {
    return { ...DEFAULT_METRICS };
  }
}

async function saveMetrics(metrics: PersistedMetrics): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  } catch {
    // Analytics persistence must never break the app.
  }
}

export function useTimeToSchedule(): UseTimeToScheduleReturn {
  const scheduleSessionStart = useRef<number | null>(null);
  const hasPublishedInSession = useRef<boolean>(false);

  const [sessionDurationMs, setSessionDurationMs] = useState<number | null>(null);
  const [totalSessions, setTotalSessions] = useState<number>(0);
  const [avgTimeMs, setAvgTimeMs] = useState<number | null>(null);

  // Load persisted metrics on mount so derived state reflects historical data.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const metrics = await loadMetrics();
      if (cancelled) return;
      setTotalSessions(metrics.totalSessions);
      if (metrics.totalSessions > 0) {
        setAvgTimeMs(
          Math.round(metrics.totalTimeMs / metrics.totalSessions),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Call when the user navigates to the scheduler tab.
   * Records the wall-clock start of the scheduling session.
   */
  const startSession = useCallback((): void => {
    scheduleSessionStart.current = Date.now();
    hasPublishedInSession.current = false;
    setSessionDurationMs(null);
  }, []);

  /**
   * Call when the first roster entry is saved.
   * Computes time-to-first-schedule, persists it, and fires the analytics event.
   */
  const markSchedulePublished = useCallback(async (): Promise<void> => {
    if (hasPublishedInSession.current) {
      // Only record the *first* publish within a session.
      return;
    }

    const schedulePublishedAt = Date.now();
    const sessionStart = scheduleSessionStart.current;

    if (sessionStart === null) {
      // Session was never started; nothing meaningful to record.
      return;
    }

    hasPublishedInSession.current = true;
    const timeToFirstScheduleMs = schedulePublishedAt - sessionStart;

    setSessionDurationMs(timeToFirstScheduleMs);

    const existing = await loadMetrics();
    const isVeryFirstPublish = existing.firstSchedulePublishedAt === null;

    const updated: PersistedMetrics = {
      totalSessions: existing.totalSessions + 1,
      totalTimeMs: existing.totalTimeMs + timeToFirstScheduleMs,
      firstSchedulePublishedAt:
        existing.firstSchedulePublishedAt ?? schedulePublishedAt,
    };

    await saveMetrics(updated);

    setTotalSessions(updated.totalSessions);
    setAvgTimeMs(Math.round(updated.totalTimeMs / updated.totalSessions));

    if (isVeryFirstPublish) {
      await trackEvent('first_schedule_published', {
        time_to_activation_ms: timeToFirstScheduleMs,
      });
    } else {
      await trackEvent('schedule_published', {
        time_to_schedule_ms: timeToFirstScheduleMs,
        session_count: updated.totalSessions,
      });
    }
  }, []);

  /**
   * Resets all persisted metrics and in-memory state.
   * Intended for use in tests and debug tooling only.
   */
  const resetSession = useCallback(async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Swallowed intentionally.
    }
    scheduleSessionStart.current = null;
    hasPublishedInSession.current = false;
    setSessionDurationMs(null);
    setTotalSessions(0);
    setAvgTimeMs(null);
  }, []);

  return {
    startSession,
    markSchedulePublished,
    sessionDurationMs,
    totalSessions,
    avgTimeMs,
    resetSession,
  };
}