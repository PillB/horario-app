/**
 * WelcomeTourContext — manages the welcome tour state, step navigation,
 * layout registration for spotlight targeting, and AsyncStorage persistence.
 *
 * Consumers:
 *   - <WelcomeTourProvider> wraps the app (or tab navigator) root.
 *   - useWelcomeTour() provides state + actions to any component.
 *   - registerLayout() is called by spotlight-aware wrappers to record
 *     the on-screen position of each tour target element.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Lightweight step descriptor — title/description live in i18n or component layer. */
export type TourStepMeta = {
  id: number;
  target: string;
  requiresAction?: boolean;
};

/** @deprecated Use TourStepMeta. Kept for backward compatibility. */
export type TourStep = TourStepMeta;

type StepLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TourState = {
  isActive: boolean;
  currentStepIndex: number;
  hasCompleted: boolean;
  stepLayouts: Record<string, StepLayout>;
  userRole: 'manager' | 'worker' | null;
  completedActions: string[];
};

type TourAction =
  | { type: 'START_TOUR' }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'COMPLETE_TOUR' }
  | { type: 'SKIP_TOUR' }
  | { type: 'RESET_TOUR' }
  | { type: 'SET_HAS_COMPLETED'; payload: boolean }
  | { type: 'REGISTER_LAYOUT'; target: string; layout: StepLayout }
  | { type: 'SET_USER_ROLE'; payload: 'manager' | 'worker' }
  | { type: 'RECORD_TOUR_ACTION'; payload: string };

type WelcomeTourContextValue = TourState & {
  /** The active step list derived from userRole (MANAGER_STEPS, WORKER_STEPS, or empty). */
  currentSteps: readonly TourStepMeta[];
  /** The currently active step, or null when role is not yet chosen. */
  currentStep: TourStepMeta | null;
  /** Total number of steps in the active step list. */
  totalSteps: number;
  /**
   * True when the user is allowed to advance:
   * the step has no requiresAction requirement, OR the action has already been recorded.
   */
  canAdvance: boolean;
  /** Completion percentage: (currentStepIndex / Math.max(totalSteps - 1, 1)) * 100 */
  progressPercent: number;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  resetTour: () => void;
  registerLayout: (target: string, layout: StepLayout) => void;
  /** Persists role to AsyncStorage and updates state. */
  setUserRole: (role: 'manager' | 'worker') => void;
  /**
   * Marks a target as actioned. If the current step matches, schedules an
   * auto-advance after 600 ms and dispatches NEXT_STEP at that point.
   */
  recordTourAction: (target: string) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const MANAGER_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header' },
  { id: 2, target: 'streak-counter' },
  { id: 3, target: 'scheduler-tab' },
  { id: 4, target: 'workers-section', requiresAction: true },
  { id: 5, target: 'availability-section', requiresAction: true },
  { id: 6, target: 'shift-templates-section', requiresAction: true },
  { id: 7, target: 'roster-section', requiresAction: true },
  { id: 8, target: 'demand-section' },
] as const;

export const WORKER_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header' },
  { id: 2, target: 'streak-counter' },
  { id: 3, target: 'scheduler-tab' },
  { id: 4, target: 'workers-section', requiresAction: true },
  { id: 5, target: 'demand-section' },
] as const;

/**
 * Backward-compat alias — existing consumers that imported TOUR_STEPS continue
 * to compile; they receive the manager step list.
 */
export const TOUR_STEPS: readonly TourStepMeta[] = MANAGER_STEPS;

const STORAGE_KEY = 'horario.tour';
const ROLE_KEY = 'horario.userRole';
const SEEN_KEY = 'horario.tourSeen';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepsForRole(role: 'manager' | 'worker' | null): readonly TourStepMeta[] {
  if (role === 'worker') return WORKER_STEPS;
  if (role === 'manager') return MANAGER_STEPS;
  return MANAGER_STEPS; // default so totalSteps is never 0 before role is set
}

function lastStepIndex(role: 'manager' | 'worker' | null): number {
  return stepsForRole(role).length - 1;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initialState: TourState = {
  isActive: false,
  currentStepIndex: 0,
  hasCompleted: false,
  stepLayouts: {},
  userRole: null,
  completedActions: [],
};

function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'START_TOUR':
      return { ...state, isActive: true, currentStepIndex: 0 };

    case 'NEXT_STEP': {
      const last = lastStepIndex(state.userRole);
      if (state.currentStepIndex >= last) {
        return { ...state, isActive: false, hasCompleted: true };
      }
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };
    }

    case 'PREV_STEP':
      if (state.currentStepIndex === 0) return state;
      return { ...state, currentStepIndex: state.currentStepIndex - 1 };

    case 'COMPLETE_TOUR':
      return { ...state, isActive: false, hasCompleted: true };

    case 'SKIP_TOUR':
      return { ...state, isActive: false, hasCompleted: true };

    case 'RESET_TOUR':
      return {
        ...state,
        hasCompleted: false,
        currentStepIndex: 0,
        isActive: false,
        completedActions: [],
      };

    case 'SET_HAS_COMPLETED':
      return { ...state, hasCompleted: action.payload };

    case 'REGISTER_LAYOUT':
      return {
        ...state,
        stepLayouts: { ...state.stepLayouts, [action.target]: action.layout },
      };

    case 'SET_USER_ROLE':
      return { ...state, userRole: action.payload, currentStepIndex: 0 };

    case 'RECORD_TOUR_ACTION': {
      if (state.completedActions.includes(action.payload)) return state;
      return {
        ...state,
        completedActions: [...state.completedActions, action.payload],
      };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WelcomeTourContext = createContext<WelcomeTourContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WelcomeTourProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tourReducer, initialState);

  // ── Derived step list & helpers ──────────────────────────────────────────

  const currentSteps = useMemo(() => stepsForRole(state.userRole), [state.userRole]);

  const totalSteps = currentSteps.length;

  const currentStep: TourStepMeta | null = useMemo(() => {
    if (state.userRole === null) return null;
    return currentSteps[state.currentStepIndex] ?? null;
  }, [state.userRole, state.currentStepIndex, currentSteps]);

  const canAdvance = useMemo(() => {
    if (!currentStep) return false;
    if (!currentStep.requiresAction) return true;
    return state.completedActions.includes(currentStep.target);
  }, [currentStep, state.completedActions]);

  const progressPercent = useMemo(
    () => (state.currentStepIndex / Math.max(totalSteps - 1, 1)) * 100,
    [state.currentStepIndex, totalSteps],
  );

  // ── AsyncStorage bootstrap ───────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [tourRaw, roleRaw, seenRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(ROLE_KEY),
          AsyncStorage.getItem(SEEN_KEY),
        ]);

        // Restore completion flag.
        let hasCompleted = false;
        if (tourRaw !== null) {
          try {
            const parsed = JSON.parse(tourRaw) as { hasCompleted: boolean };
            if (typeof parsed.hasCompleted === 'boolean') {
              hasCompleted = parsed.hasCompleted;
              dispatch({ type: 'SET_HAS_COMPLETED', payload: parsed.hasCompleted });
            }
          } catch {
            // Malformed JSON — treat as not completed.
          }
        }

        // Restore role.
        if (roleRaw === 'manager' || roleRaw === 'worker') {
          dispatch({ type: 'SET_USER_ROLE', payload: roleRaw });
        }

        // Auto-start on first launch: not completed and never seen before.
        if (!hasCompleted && seenRaw === null) {
          dispatch({ type: 'START_TOUR' });
          AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
        }
      } catch {
        // Storage read failure is non-fatal; tour defaults to not started.
      }
    })();
  }, []);

  // ── Persistence helpers ──────────────────────────────────────────────────

  const persistCompletion = useCallback((hasCompleted: boolean) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ hasCompleted })).catch(
      () => undefined,
    );
  }, []);

  const persistRole = useCallback((role: 'manager' | 'worker') => {
    AsyncStorage.setItem(ROLE_KEY, role).catch(() => undefined);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const startTour = useCallback(() => {
    dispatch({ type: 'START_TOUR' });
  }, []);

  const nextStep = useCallback(() => {
    const last = lastStepIndex(state.userRole);
    if (state.currentStepIndex >= last) {
      dispatch({ type: 'COMPLETE_TOUR' });
      persistCompletion(true);
    } else {
      dispatch({ type: 'NEXT_STEP' });
    }
  }, [state.currentStepIndex, state.userRole, persistCompletion]);

  const prevStep = useCallback(() => {
    dispatch({ type: 'PREV_STEP' });
  }, []);

  const skipTour = useCallback(() => {
    dispatch({ type: 'SKIP_TOUR' });
    persistCompletion(true);
  }, [persistCompletion]);

  const completeTour = useCallback(() => {
    dispatch({ type: 'COMPLETE_TOUR' });
    persistCompletion(true);
  }, [persistCompletion]);

  const resetTour = useCallback(() => {
    dispatch({ type: 'RESET_TOUR' });
    persistCompletion(false);
  }, [persistCompletion]);

  const registerLayout = useCallback((target: string, layout: StepLayout) => {
    dispatch({ type: 'REGISTER_LAYOUT', target, layout });
  }, []);

  const setUserRole = useCallback(
    (role: 'manager' | 'worker') => {
      dispatch({ type: 'SET_USER_ROLE', payload: role });
      persistRole(role);
    },
    [persistRole],
  );

  const recordTourAction = useCallback(
    (target: string) => {
      dispatch({ type: 'RECORD_TOUR_ACTION', payload: target });

      // If the recorded action matches the current step, schedule auto-advance.
      if (currentStep && currentStep.target === target) {
        const stepIndex = state.currentStepIndex;
        const role = state.userRole;
        const last = lastStepIndex(role);

        setTimeout(() => {
          if (stepIndex >= last) {
            dispatch({ type: 'COMPLETE_TOUR' });
            persistCompletion(true);
          } else {
            dispatch({ type: 'NEXT_STEP' });
          }
        }, 600);
      }
    },
    [currentStep, state.currentStepIndex, state.userRole, persistCompletion],
  );

  // ── Context value ────────────────────────────────────────────────────────

  const value = useMemo<WelcomeTourContextValue>(
    () => ({
      ...state,
      currentSteps,
      currentStep,
      totalSteps,
      canAdvance,
      progressPercent,
      startTour,
      nextStep,
      prevStep,
      skipTour,
      completeTour,
      resetTour,
      registerLayout,
      setUserRole,
      recordTourAction,
    }),
    [
      state,
      currentSteps,
      currentStep,
      totalSteps,
      canAdvance,
      progressPercent,
      startTour,
      nextStep,
      prevStep,
      skipTour,
      completeTour,
      resetTour,
      registerLayout,
      setUserRole,
      recordTourAction,
    ],
  );

  return (
    <WelcomeTourContext.Provider value={value}>
      {children}
    </WelcomeTourContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Access tour state and actions from any component inside <WelcomeTourProvider>. */
export function useWelcomeTour(): WelcomeTourContextValue {
  const ctx = useContext(WelcomeTourContext);
  if (!ctx) {
    throw new Error('useWelcomeTour must be used inside <WelcomeTourProvider>');
  }
  return ctx;
}