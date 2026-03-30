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

export type TourStep = {
  id: number;
  title: string;
  description: string;
  target: string;
};

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
};

type TourAction =
  | { type: 'START_TOUR' }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'COMPLETE_TOUR' }
  | { type: 'SKIP_TOUR' }
  | { type: 'RESET_TOUR' }
  | { type: 'SET_HAS_COMPLETED'; payload: boolean }
  | { type: 'REGISTER_LAYOUT'; target: string; layout: StepLayout };

type WelcomeTourContextValue = TourState & {
  currentStep: TourStep;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  resetTour: () => void;
  registerLayout: (target: string, layout: StepLayout) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 1,
    title: 'Welcome to Horario!',
    description:
      "Your all-in-one scheduling hub. Let's take a 30-second tour so you get the most out of the app.",
    target: 'home-header',
  },
  {
    id: 2,
    title: 'Your Daily Streak',
    description:
      'Build a scheduling habit. Your streak grows every day you open the scheduler and make an update.',
    target: 'streak-counter',
  },
  {
    id: 3,
    title: 'Scheduler Tab',
    description:
      'Add workers, define shift templates, build your roster, and set demand targets — all from here.',
    target: 'scheduler-tab',
  },
  {
    id: 4,
    title: 'Workers',
    description:
      'Add your team members with their roles and availability windows so the scheduler knows who is free.',
    target: 'workers-section',
  },
  {
    id: 5,
    title: 'Shift Templates',
    description:
      'Define reusable shift blueprints — role, start time, end time, and minimum coverage required.',
    target: 'shift-templates-section',
  },
  {
    id: 6,
    title: 'Roster',
    description:
      'Assign workers to templates for specific dates. The app validates availability and role matches.',
    target: 'roster-section',
  },
  {
    id: 7,
    title: 'Demand Forecasting',
    description:
      'Set staffing targets per role per day. The AI model can generate forecasts from your historical data.',
    target: 'demand-section',
  },
] as const;

const STORAGE_KEY = 'horario.tour';
const LAST_STEP_INDEX = TOUR_STEPS.length - 1;

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initialState: TourState = {
  isActive: false,
  currentStepIndex: 0,
  hasCompleted: false,
  stepLayouts: {},
};

function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'START_TOUR':
      return { ...state, isActive: true, currentStepIndex: 0 };

    case 'NEXT_STEP': {
      // Caller is responsible for detecting last step and calling COMPLETE_TOUR instead,
      // but guard here too so state never exceeds bounds.
      if (state.currentStepIndex >= LAST_STEP_INDEX) {
        return { ...state, isActive: false, hasCompleted: true };
      }
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };
    }

    case 'PREV_STEP':
      // No-op at the first step.
      if (state.currentStepIndex === 0) return state;
      return { ...state, currentStepIndex: state.currentStepIndex - 1 };

    case 'COMPLETE_TOUR':
      return { ...state, isActive: false, hasCompleted: true };

    case 'SKIP_TOUR':
      return { ...state, isActive: false, hasCompleted: true };

    case 'RESET_TOUR':
      return { ...state, hasCompleted: false, currentStepIndex: 0, isActive: false };

    case 'SET_HAS_COMPLETED':
      return { ...state, hasCompleted: action.payload };

    case 'REGISTER_LAYOUT':
      return {
        ...state,
        stepLayouts: { ...state.stepLayouts, [action.target]: action.layout },
      };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WelcomeTourContext = createContext<WelcomeTourContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WelcomeTourProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tourReducer, initialState);

  // Load persisted completion state on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw !== null) {
          const parsed = JSON.parse(raw) as { hasCompleted: boolean };
          if (typeof parsed.hasCompleted === 'boolean') {
            dispatch({ type: 'SET_HAS_COMPLETED', payload: parsed.hasCompleted });
          }
        }
      })
      .catch(() => {
        // Storage read failure is non-fatal; tour defaults to not completed.
      });
  }, []);

  const persist = useCallback((hasCompleted: boolean) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ hasCompleted })).catch(() => {
      // Persistence failure is non-fatal.
    });
  }, []);

  const startTour = useCallback(() => {
    dispatch({ type: 'START_TOUR' });
  }, []);

  const nextStep = useCallback(() => {
    // Dispatch COMPLETE_TOUR (with persist) when advancing past the last step.
    if (state.currentStepIndex >= LAST_STEP_INDEX) {
      dispatch({ type: 'COMPLETE_TOUR' });
      persist(true);
    } else {
      dispatch({ type: 'NEXT_STEP' });
    }
  }, [state.currentStepIndex, persist]);

  const prevStep = useCallback(() => {
    dispatch({ type: 'PREV_STEP' });
  }, []);

  const skipTour = useCallback(() => {
    dispatch({ type: 'SKIP_TOUR' });
    persist(true);
  }, [persist]);

  const completeTour = useCallback(() => {
    dispatch({ type: 'COMPLETE_TOUR' });
    persist(true);
  }, [persist]);

  const resetTour = useCallback(() => {
    dispatch({ type: 'RESET_TOUR' });
    persist(false);
  }, [persist]);

  const registerLayout = useCallback((target: string, layout: StepLayout) => {
    dispatch({ type: 'REGISTER_LAYOUT', target, layout });
  }, []);

  // Stable computed currentStep — changes only when currentStepIndex changes.
  const currentStep = useMemo(
    () => TOUR_STEPS[state.currentStepIndex] as TourStep,
    [state.currentStepIndex],
  );

  const value = useMemo<WelcomeTourContextValue>(
    () => ({
      ...state,
      currentStep,
      startTour,
      nextStep,
      prevStep,
      skipTour,
      completeTour,
      resetTour,
      registerLayout,
    }),
    [
      state,
      currentStep,
      startTour,
      nextStep,
      prevStep,
      skipTour,
      completeTour,
      resetTour,
      registerLayout,
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