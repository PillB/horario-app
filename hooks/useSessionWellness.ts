import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type WellnessConfig = {
  breakAfterMinutes?: number;
  cooldownMinutes?: number;
};

type WellnessState = {
  lastActiveAt: number | null;
  lastBreakAt: number | null;
};

export const shouldShowBreakPrompt = (
  state: WellnessState,
  now: number,
  config: Required<WellnessConfig>
) => {
  const { lastActiveAt, lastBreakAt } = state;
  if (!lastActiveAt) return false;

  const minutesSinceActive = (now - lastActiveAt) / 60000;
  if (minutesSinceActive < config.breakAfterMinutes) return false;

  if (!lastBreakAt) return true;
  const minutesSinceBreak = (now - lastBreakAt) / 60000;
  return minutesSinceBreak >= config.cooldownMinutes;
};

export const useSessionWellness = (config: WellnessConfig = {}) => {
  const mergedConfig = useMemo<Required<WellnessConfig>>(
    () => ({ breakAfterMinutes: 20, cooldownMinutes: 30, ...config }),
    [config.breakAfterMinutes, config.cooldownMinutes]
  );

  const [state, setState] = useState<WellnessState>({ lastActiveAt: null, lastBreakAt: null });
  const [promptVisible, setPromptVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recordInteraction = useCallback(() => {
    setState((prev) => ({ ...prev, lastActiveAt: Date.now() }));
  }, []);

  const acknowledgeBreak = useCallback(() => {
    setState((prev) => ({ ...prev, lastBreakAt: Date.now() }));
    setPromptVisible(false);
  }, []);

  const dismissPrompt = useCallback(() => setPromptVisible(false), []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      setPromptVisible((current) => {
        const nextShouldShow = shouldShowBreakPrompt(state, now, mergedConfig);
        return nextShouldShow || current;
      });
    }, 60 * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [mergedConfig, state]);

  const minutesActive = useMemo(() => {
    if (!state.lastActiveAt) return 0;
    return Math.max(0, Math.floor((Date.now() - state.lastActiveAt) / 60000));
  }, [state.lastActiveAt]);

  return {
    promptVisible,
    recordInteraction,
    acknowledgeBreak,
    dismissPrompt,
    minutesActive,
  } as const;
};

export type SessionWellnessApi = ReturnType<typeof useSessionWellness>;
