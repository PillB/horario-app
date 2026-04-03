import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { log } from '@/services/logger';
import type { DayOfWeek } from '@/services/rosterService';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EXCEPTIONS_STORAGE_PREFIX = '@horario/availability_exceptions/';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimeSlot = {
  from: string; // "HH:MM" 24-h
  to: string;   // "HH:MM" 24-h
};

/** Grid state: each day maps to zero or more time slots. */
export type AvailabilityGrid = Record<DayOfWeek, TimeSlot[]>;

/** A one-off date-based unavailability exception stored locally. */
export type AvailabilityException = {
  /** ISO date, e.g. "2024-07-04" */
  date: string;
  reason: string;
  createdAt: string;
};

export type AvailabilityGridHook = ReturnType<typeof useAvailabilityGrid>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildEmptyGrid = (): AvailabilityGrid =>
  Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, []])) as unknown as AvailabilityGrid;

const storageKey = (workerId: string): string =>
  `${EXCEPTIONS_STORAGE_PREFIX}${workerId}`;

/**
 * Parses "HH:MM" into total minutes-since-midnight for comparison.
 * Returns -1 on malformed input so callers can detect invalid times.
 */
const toMinutes = (time: string): number => {
  const parts = time.split(':');
  const h = parseInt(parts[0] ?? '', 10);
  const m = parseInt(parts[1] ?? '', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
};

/**
 * Returns true when two time slots overlap (exclusive touching boundaries are
 * allowed, e.g. 09:00–12:00 and 12:00–14:00 do NOT overlap).
 */
const slotsOverlap = (a: TimeSlot, b: TimeSlot): boolean => {
  const aFrom = toMinutes(a.from);
  const aTo = toMinutes(a.to);
  const bFrom = toMinutes(b.from);
  const bTo = toMinutes(b.to);
  if (aFrom < 0 || aTo < 0 || bFrom < 0 || bTo < 0) return false;
  return aFrom < bTo && bFrom < aTo;
};

// ─── Human-readable summary helper ───────────────────────────────────────────

/**
 * Compresses a grid into a human-readable string such as:
 *   "Mon–Fri 09:00–17:00, Sat 10:00–14:00, exceptions: 3"
 *
 * Days with identical single-slot schedules are merged into ranges.
 */
const buildSummary = (
  grid: AvailabilityGrid,
  exceptions: AvailabilityException[],
): string => {
  type Range = { days: DayOfWeek[]; slot: TimeSlot };
  const ranges: Range[] = [];

  for (const day of DAYS_OF_WEEK) {
    const slots = grid[day];
    if (!slots || slots.length !== 1) continue;
    const slot = slots[0];
    if (!slot) continue;

    const last = ranges[ranges.length - 1];
    if (
      last &&
      last.slot.from === slot.from &&
      last.slot.to === slot.to &&
      DAYS_OF_WEEK.indexOf(day) ===
        DAYS_OF_WEEK.indexOf(last.days[last.days.length - 1] as DayOfWeek) + 1
    ) {
      last.days.push(day);
    } else {
      ranges.push({ days: [day], slot });
    }
  }

  const dayLabel = (d: DayOfWeek): string => d;

  const parts: string[] = ranges.map((r) => {
    const first = r.days[0];
    const last = r.days[r.days.length - 1];
    const dayPart =
      r.days.length === 1
        ? dayLabel(first as DayOfWeek)
        : `${dayLabel(first as DayOfWeek)}–${dayLabel(last as DayOfWeek)}`;
    return `${dayPart} ${r.slot.from}–${r.slot.to}`;
  });

  // Days with multiple slots are listed individually
  for (const day of DAYS_OF_WEEK) {
    const slots = grid[day];
    if (!slots || slots.length <= 1) continue;
    const slotDesc = slots.map((s) => `${s.from}–${s.to}`).join(', ');
    parts.push(`${dayLabel(day)} ${slotDesc}`);
  }

  if (exceptions.length > 0) {
    parts.push(`exceptions: ${exceptions.length}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No availability set';
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useAvailabilityGrid
 *
 * Manages a 7-day availability grid (in-memory) plus date-based exceptions
 * (persisted to AsyncStorage keyed by workerId).
 *
 * The grid is intentionally kept in-memory so the parent screen can decide
 * when to flush it to the DB via `useWorkers.addAvailability`.
 */
export const useAvailabilityGrid = (workerId: string) => {
  const [grid, setGrid] = useState<AvailabilityGrid>(buildEmptyGrid);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);

  // ── Load persisted exceptions on mount / workerId change ─────────────────

  useEffect(() => {
    let cancelled = false;

    const loadExceptions = async () => {
      setExceptionsLoading(true);
      try {
        const raw = await AsyncStorage.getItem(storageKey(workerId));
        if (!cancelled) {
          const parsed: AvailabilityException[] =
            raw ? (JSON.parse(raw) as AvailabilityException[]) : [];
          setExceptions(parsed);
          log.debug('UI', 'Exceptions loaded', {
            workerId,
            count: parsed.length,
          });
        }
      } catch (err) {
        if (!cancelled) {
          log.warn('UI', 'Failed to load exceptions', {
            workerId,
            error: err instanceof Error ? err.message : String(err),
          });
          setExceptions([]);
        }
      } finally {
        if (!cancelled) setExceptionsLoading(false);
      }
    };

    void loadExceptions();
    return () => { cancelled = true; };
  }, [workerId]);

  // ── Persist exceptions whenever they change ───────────────────────────────

  const persistExceptions = useCallback(
    async (updated: AvailabilityException[]): Promise<void> => {
      try {
        await AsyncStorage.setItem(storageKey(workerId), JSON.stringify(updated));
      } catch (err) {
        log.warn('UI', 'Failed to persist exceptions', {
          workerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [workerId],
  );

  // ── addSlot ───────────────────────────────────────────────────────────────

  /**
   * Adds a time slot to the given day.
   * Silently ignores the request when the slot would overlap an existing one
   * or when `from` >= `to`.
   *
   * Returns `true` if the slot was added, `false` if rejected.
   */
  const addSlot = useCallback(
    (day: DayOfWeek, from: string, to: string): boolean => {
      if (toMinutes(from) < 0 || toMinutes(to) < 0) {
        log.warn('UI', 'addSlot: invalid time format', { day, from, to });
        return false;
      }
      if (toMinutes(from) >= toMinutes(to)) {
        log.warn('UI', 'addSlot: from must be before to', { day, from, to });
        return false;
      }

      const newSlot: TimeSlot = { from, to };
      let rejected = false;

      setGrid((prev) => {
        const existing = prev[day];
        if (existing.some((s) => slotsOverlap(s, newSlot))) {
          rejected = true;
          return prev; // no change
        }
        const sorted = [...existing, newSlot].sort(
          (a, b) => toMinutes(a.from) - toMinutes(b.from),
        );
        return { ...prev, [day]: sorted };
      });

      if (rejected) {
        log.debug('UI', 'addSlot: slot overlaps existing — ignored', {
          day,
          from,
          to,
        });
      }
      return !rejected;
    },
    [],
  );

  // ── removeSlot ────────────────────────────────────────────────────────────

  /**
   * Removes the slot whose `from` time matches on the given day.
   * No-ops silently if not found.
   */
  const removeSlot = useCallback((day: DayOfWeek, from: string): void => {
    setGrid((prev) => ({
      ...prev,
      [day]: prev[day].filter((s) => s.from !== from),
    }));
  }, []);

  // ── toggleDay ─────────────────────────────────────────────────────────────

  /**
   * If the day has no slots → adds a single slot [defaultFrom, defaultTo].
   * If the day already has slots → clears all slots (marking the day as
   * unavailable).
   *
   * Designed for a simple toggle-chip in the UI.
   */
  const toggleDay = useCallback(
    (day: DayOfWeek, defaultFrom: string, defaultTo: string): void => {
      setGrid((prev) => {
        if (prev[day].length > 0) {
          return { ...prev, [day]: [] };
        }
        if (
          toMinutes(defaultFrom) < 0 ||
          toMinutes(defaultTo) < 0 ||
          toMinutes(defaultFrom) >= toMinutes(defaultTo)
        ) {
          log.warn('UI', 'toggleDay: invalid default times', {
            day,
            defaultFrom,
            defaultTo,
          });
          return prev;
        }
        return {
          ...prev,
          [day]: [{ from: defaultFrom, to: defaultTo }],
        };
      });
    },
    [],
  );

  // ── addException ──────────────────────────────────────────────────────────

  /**
   * Records a one-off date-based unavailability exception.
   * Duplicate dates overwrite the previous entry for that date.
   * Persists to AsyncStorage.
   */
  const addException = useCallback(
    async (date: string, reason: string): Promise<void> => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!isoDateRegex.test(date)) {
        log.warn('UI', 'addException: invalid date format (expected YYYY-MM-DD)', {
          date,
        });
        return;
      }

      const entry: AvailabilityException = {
        date,
        reason: reason.trim(),
        createdAt: new Date().toISOString(),
      };

      setExceptions((prev) => {
        const filtered = prev.filter((e) => e.date !== date);
        const updated = [...filtered, entry].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        void persistExceptions(updated);
        return updated;
      });

      log.info('UI', 'Exception added', { workerId, date, reason });
    },
    [workerId, persistExceptions],
  );

  // ── removeException ───────────────────────────────────────────────────────

  /**
   * Removes the exception for the given ISO date.  No-ops if not found.
   */
  const removeException = useCallback(
    async (date: string): Promise<void> => {
      setExceptions((prev) => {
        const updated = prev.filter((e) => e.date !== date);
        void persistExceptions(updated);
        return updated;
      });
      log.info('UI', 'Exception removed', { workerId, date });
    },
    [workerId, persistExceptions],
  );

  // ── resetGrid ─────────────────────────────────────────────────────────────

  /**
   * Clears all in-memory grid slots, resetting to the empty state.
   * Does not affect persisted exceptions.
   */
  const resetGrid = useCallback((): void => {
    setGrid(buildEmptyGrid());
  }, []);

  // ── isDayActive ───────────────────────────────────────────────────────────

  /** Returns true when the given day has at least one slot. */
  const isDayActive = useCallback(
    (day: DayOfWeek): boolean => (grid[day]?.length ?? 0) > 0,
    [grid],
  );

  // ── getAvailabilitySummary ────────────────────────────────────────────────

  /**
   * Returns a human-readable summary of the current grid and exceptions.
   *
   * Example output:
   *   "Mon–Fri 09:00–17:00, Sat 10:00–14:00, exceptions: 2"
   */
  const getAvailabilitySummary = useCallback(
    (): string => buildSummary(grid, exceptions),
    [grid, exceptions],
  );

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    /** Current 7-day grid state. */
    grid,
    /** One-off date exceptions loaded from / synced to AsyncStorage. */
    exceptions,
    exceptionsLoading,
    /** Ordered constant for iterating days. */
    daysOfWeek: DAYS_OF_WEEK,
    addSlot,
    removeSlot,
    toggleDay,
    addException,
    removeException,
    resetGrid,
    isDayActive,
    getAvailabilitySummary,
  };
};