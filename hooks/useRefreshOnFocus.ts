/**
 * useRefreshOnFocus — reload stored data when the user comes back to a screen.
 *
 * Tabs stay mounted: a location added on Profile, a plan bought on another
 * screen or a week published in the Scheduler must show when the user returns.
 * The first focus is the mount, and each hook already loads on mount, so it is
 * skipped: no duplicate request on first render (the pattern Home used for its
 * roster summary, CHG-095; shared since CHG-109).
 *
 * `reload` is read when the screen gains focus, so passing a new function each
 * render does not re-run the effect.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

export function useRefreshOnFocus(reload: () => void): void {
  const focusedOnce = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      reloadRef.current();
    }, []),
  );
}

/**
 * Runs `reload` each time `signal` changes after the mount (a screen's focus
 * counter, passed to a child that owns its data). The mount itself never
 * reloads, whatever the signal's value then: the child's hooks load on mount.
 */
export function useReloadOnSignal(signal: number | undefined, reload: () => void): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const seen = useRef(signal);
  useEffect(() => {
    if (seen.current === signal) return;
    seen.current = signal;
    reloadRef.current();
  }, [signal]);
}
