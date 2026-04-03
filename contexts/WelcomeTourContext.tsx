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
  /** Which tab this step lives on — used for cross-tab navigation prompts */
  tab?: 'home' | 'scheduler' | 'analytics';
  /** Shown as a 💡 chip in the callout card to guide interactive field filling */
  interactiveHint?: string;
};

/** @deprecated Use TourStepMeta. Kept for backward compatibility. */
export type TourStep = TourStepMeta;

export type TourMode = 'overview' | 'manager' | 'worker' | 'home' | 'scheduler' | 'analytics';

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
  tourMode: TourMode | null;
};

type TourAction =
  | { type: 'START_TOUR' }
  | { type: 'START_TOUR_MODE'; payload: TourMode }
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
  /** The active step list derived from tourMode / userRole. */
  currentSteps: readonly TourStepMeta[];
  /** The currently active step, or null when the tour is not active. */
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
  /** The currently active tour mode, or null when using legacy role-based flow. */
  tourMode: TourMode | null;
  startTour: () => void;
  /** Start a specific named guide flow. */
  startTourMode: (mode: TourMode) => void;
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

/** 5-step overview: one highlight per app section, no required actions */
export const OVERVIEW_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header', tab: 'home' },
  { id: 2, target: 'streak-counter', tab: 'home' },
  { id: 3, target: 'workers-section', tab: 'scheduler' },
  { id: 4, target: 'demand-section', tab: 'scheduler' },
  { id: 5, target: 'analytics-kpis', tab: 'analytics' },
] as const;

/** 6-step Home tab detail tour */
export const HOME_DETAIL_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header', tab: 'home' },
  { id: 2, target: 'week-stats', tab: 'home' },
  { id: 3, target: 'streak-counter', tab: 'home' },
  { id: 4, target: 'upcoming-shifts', tab: 'home' },
  { id: 5, target: 'staffing-gaps', tab: 'home' },
  { id: 6, target: 'quick-actions', tab: 'home' },
] as const;

/** 5-step Scheduler tab detail tour with interactive hints */
export const SCHEDULER_DETAIL_STEPS: readonly TourStepMeta[] = [
  {
    id: 1,
    target: 'workers-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Enter a worker name, role, and skills — then tap "Add worker" to continue',
  },
  {
    id: 2,
    target: 'availability-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Select a day (e.g. Mon), enter From: 09:00, To: 17:00 — then tap "Add availability"',
  },
  {
    id: 3,
    target: 'shift-templates-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Enter a template name, role, start/end times, and coverage count — then tap "Add template"',
  },
  {
    id: 4,
    target: 'roster-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Pick a worker, pick a template, enter a date (YYYY-MM-DD) — then tap "Save and notify team"',
  },
  {
    id: 5,
    target: 'demand-section',
    tab: 'scheduler',
    interactiveHint: 'Try entering a role, start date, and daily demand — then tap "Save baseline targets"',
  },
] as const;

/** 4-step Analytics tab detail tour */
export const ANALYTICS_DETAIL_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'analytics-kpis', tab: 'analytics' },
  { id: 2, target: 'analytics-revenue', tab: 'analytics' },
  { id: 3, target: 'analytics-hours', tab: 'analytics' },
  { id: 4, target: 'analytics-fairness', tab: 'analytics' },
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

function stepsForMode(
  mode: TourMode | null,
  role: 'manager' | 'worker' | null,
): readonly TourStepMeta[] {
  switch (mode) {
    case 'overview':
      return OVERVIEW_STEPS;
    case 'home':
      return HOME_DETAIL_STEPS;
    case 'scheduler':
      return SCHEDULER_DETAIL_STEPS;
    case 'analytics':
      return ANALYTICS_DETAIL_STEPS;
    case 'manager':
      return MANAGER_STEPS;
    case 'worker':
      return WORKER_STEPS;
    default:
      // Legacy fallback when mode is null but role is set
      if (role === 'worker') return WORKER_STEPS;
      return MANAGER_STEPS;
  }
}

function lastStepIndex(mode: TourMode | null, role: 'manager' | 'worker' | null): number {
  return stepsForMode(mode, role).length - 1;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initialState: TourState = {
  isActive: false,
  currentStepIndex: 0,
  hasCompleted: false,
  stepLayouts: {},
  userRole: null,
  completedActions: [],
  tourMode: null,
};

function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'START_TOUR':
      return { ...state, isActive: true, currentStepIndex: 0 };

    case 'START_TOUR_MODE':
      return {
        ...state,
        isActive: true,
        currentStepIndex: 0,
        tourMode: action.payload,
        completedActions: [],
        // Keep userRole unchanged — it may already be set
      };

    case 'NEXT_STEP': {
      const last = lastStepIndex(state.tourMode, state.userRole);
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

  const currentSteps = useMemo(
    () => stepsForMode(state.tourMode, state.userRole),
    [state.tourMode, state.userRole],
  );

  const totalSteps = currentSteps.length;

  const currentStep: TourStepMeta | null = useMemo(() => {
    // Allow steps without a role for mode-based tours
    if (!state.isActive) return null;
    return currentSteps[state.currentStepIndex] ?? null;
  }, [state.isActive, state.currentStepIndex, currentSteps]);

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

  const persistCompletion = useCallback((completed: boolean) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ hasCompleted: completed })).catch(() => undefined);
  }, []);

  const persistRole = useCallback((role: 'manager' | 'worker') => {
    AsyncStorage.setItem(ROLE_KEY, role).catch(() => undefined);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const startTour = useCallback(() => {
    dispatch({ type: 'START_TOUR' });
  }, []);

  const startTourMode = useCallback(
    (mode: TourMode) => {
      dispatch({ type: 'START_TOUR_MODE', payload: mode });
      if (mode === 'manager') persistRole('manager');
      if (mode === 'worker') persistRole('worker');
    },
    [persistRole],
  );

  const nextStep = useCallback(() => {
    const last = lastStepIndex(state.tourMode, state.userRole);
    if (state.currentStepIndex >= last) {
      dispatch({ type: 'COMPLETE_TOUR' });
      persistCompletion(true);
    } else {
      dispatch({ type: 'NEXT_STEP' });
    }
  }, [state.currentStepIndex, state.tourMode, state.userRole, persistCompletion]);

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
      if (currentStep && currentStep.target === target) {
        const stepIndex = state.currentStepIndex;
        const last = lastStepIndex(state.tourMode, state.userRole);
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
    [currentStep, state.currentStepIndex, state.tourMode, state.userRole, persistCompletion],
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
      startTourMode,
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
      startTourMode,
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