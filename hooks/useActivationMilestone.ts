import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ActivationState = {
  activation_target_defined: boolean;
  activation_reached: boolean;
  time_to_activation_ms: number | null;
  first_open_ts: number | null;
  activated_at_ts: number | null;
};

export type UseActivationMilestoneReturn = {
  activationState: ActivationState;
  markTargetDefined: () => Promise<void>;
  markActivationReached: () => Promise<void>;
  showSuccessFeedback: boolean;
  dismissSuccessFeedback: () => void;
  isLoading: boolean;
};

const STORAGE_KEY = 'horario:activation';

const DEFAULT_STATE: ActivationState = {
  activation_target_defined: false,
  activation_reached: false,
  time_to_activation_ms: null,
  first_open_ts: null,
  activated_at_ts: null,
};

const isActivationState = (value: unknown): value is ActivationState => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['activation_target_defined'] === 'boolean' &&
    typeof v['activation_reached'] === 'boolean' &&
    (v['time_to_activation_ms'] === null || typeof v['time_to_activation_ms'] === 'number') &&
    (v['first_open_ts'] === null || typeof v['first_open_ts'] === 'number') &&
    (v['activated_at_ts'] === null || typeof v['activated_at_ts'] === 'number')
  );
};

const persistState = (state: ActivationState): void => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {
    // fire-and-forget, never throw
  });
};

export function useActivationMilestone(): UseActivationMilestoneReturn {
  const [activationState, setActivationState] = useState<ActivationState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedbackDismissed, setFeedbackDismissed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;

        const now = Date.now();

        if (raw !== null) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw) as unknown;
          } catch {
            parsed = null;
          }

          if (isActivationState(parsed)) {
            const hydratedState: ActivationState = {
              ...parsed,
              first_open_ts: parsed.first_open_ts ?? now,
            };

            if (hydratedState.first_open_ts !== parsed.first_open_ts) {
              persistState(hydratedState);
            }

            setActivationState(hydratedState);
          } else {
            const freshState: ActivationState = {
              ...DEFAULT_STATE,
              first_open_ts: now,
            };
            persistState(freshState);
            setActivationState(freshState);
          }
        } else {
          const freshState: ActivationState = {
            ...DEFAULT_STATE,
            first_open_ts: now,
          };
          persistState(freshState);
          setActivationState(freshState);
        }
      } catch {
        if (cancelled) return;
        const now = Date.now();
        const freshState: ActivationState = {
          ...DEFAULT_STATE,
          first_open_ts: now,
        };
        setActivationState(freshState);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const markTargetDefined = useCallback(async (): Promise<void> => {
    setActivationState((prev) => {
      if (prev.activation_target_defined) return prev;
      const next: ActivationState = {
        ...prev,
        activation_target_defined: true,
      };
      persistState(next);
      return next;
    });
  }, []);

  const markActivationReached = useCallback(async (): Promise<void> => {
    setActivationState((prev) => {
      if (prev.activation_reached) return prev;

      const now = Date.now();
      const activatedAtTs = now;
      const timeToActivationMs =
        prev.first_open_ts !== null ? activatedAtTs - prev.first_open_ts : null;

      const next: ActivationState = {
        ...prev,
        activation_reached: true,
        activated_at_ts: activatedAtTs,
        time_to_activation_ms: timeToActivationMs,
      };
      persistState(next);
      return next;
    });
  }, []);

  const dismissSuccessFeedback = useCallback((): void => {
    setFeedbackDismissed(true);
  }, []);

  const showSuccessFeedback = activationState.activation_reached && !feedbackDismissed;

  return {
    activationState,
    markTargetDefined,
    markActivationReached,
    showSuccessFeedback,
    dismissSuccessFeedback,
    isLoading,
  };
}