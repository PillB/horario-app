/**
 * WelcomeTourContext — state of the guided tours.
 *
 * A guide is a list of steps. Each step names the screen it lives on (and the
 * scheduler step, when it is one) and a target: a view wrapped in <TourStep>.
 * <TourSpotlight> takes the user to the screen, scrolls the target into view
 * and measures it in window coordinates when the step becomes current.
 *
 * Targets register a ref, not a layout: `onLayout` reports a position relative
 * to the parent, which is not where the view is on screen once anything
 * scrolls. Refs are kept in a ref map so registering never re-renders the app.
 *
 * No step blocks: "Next" always works. A step whose action the user completes
 * (for example adding a worker) moves on by itself.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TourRoute = '/' | '/scheduler' | '/explore';

export type TourStepMeta = {
  /** Copy key: `tour.<mode>.step<id>.title` / `.desc`. */
  id: number;
  /** Name of the <TourStep> wrapper to highlight. */
  target: string;
  /** Screen the target is on. */
  route: TourRoute;
  /** Scheduler step that must be open for the target to exist. */
  section?: 'workers' | 'templates' | 'forecast' | 'shifts';
};

export type TourMode = 'overview' | 'scheduler' | 'analytics';

export const TOUR_MODES: readonly TourMode[] = ['overview', 'scheduler', 'analytics'];

type TourState = {
  isActive: boolean;
  currentStepIndex: number;
  hasCompleted: boolean;
  /**
   * True only after the user finished a guide in this session (not skipped,
   * not restored from storage), until the scheduler takes the sample-data
   * offer with `takeSampleDataOffer`. Sample rows are real rows in the account.
   */
  sampleDataOffered: boolean;
  /** null while the guide picker is showing. */
  tourMode: TourMode | null;
};

type TourAction =
  | { type: 'START_TOUR' }
  | { type: 'START_TOUR_MODE'; payload: TourMode }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'ADVANCE_FROM'; mode: TourMode; index: number }
  | { type: 'COMPLETE_TOUR' }
  | { type: 'SKIP_TOUR' }
  | { type: 'RESET_TOUR' }
  | { type: 'SET_HAS_COMPLETED'; payload: boolean }
  | { type: 'TAKE_SAMPLE_DATA_OFFER' };

export type TourTargetRef = React.RefObject<View | null>;

type WelcomeTourContextValue = TourState & {
  currentSteps: readonly TourStepMeta[];
  /** The current step, or null when no guide is running. */
  currentStep: TourStepMeta | null;
  totalSteps: number;
  /** Share of the guide reached, 0–100; the last step is 100. */
  progressPercent: number;
  /** Opens the guide picker. */
  startTour: () => void;
  /** Starts one guide at its first step. */
  startTourMode: (mode: TourMode) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  resetTour: () => void;
  /** Called by <TourStep>; pass null on unmount. */
  registerTarget: (target: string, ref: TourTargetRef | null) => void;
  getTarget: (target: string) => TourTargetRef | null;
  /** Returns whether sample data may be seeded now, and clears the offer. */
  takeSampleDataOffer: () => boolean;
  /**
   * Tells the guide the user did what a step asks. If that step is the current
   * one, the guide moves on shortly after.
   */
  recordTourAction: (target: string) => void;
};

// ─── Steps ────────────────────────────────────────────────────────────────────

/** One highlight per part of the app. */
export const OVERVIEW_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header', route: '/' },
  { id: 3, target: 'scheduler-sections', route: '/scheduler', section: 'workers' },
  { id: 4, target: 'demand-section', route: '/scheduler', section: 'forecast' },
  { id: 5, target: 'analytics-kpis', route: '/explore' },
] as const;

/** The scheduler's steps in working order: team, templates, demand, roster. */
export const SCHEDULER_DETAIL_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'workers-section', route: '/scheduler', section: 'workers' },
  { id: 2, target: 'availability-section', route: '/scheduler', section: 'workers' },
  { id: 3, target: 'shift-templates-section', route: '/scheduler', section: 'templates' },
  { id: 5, target: 'demand-section', route: '/scheduler', section: 'forecast' },
  { id: 4, target: 'shift-assign-section', route: '/scheduler', section: 'shifts' },
] as const;

export const ANALYTICS_DETAIL_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'analytics-kpis', route: '/explore' },
  { id: 2, target: 'analytics-revenue', route: '/explore' },
  { id: 3, target: 'analytics-hours', route: '/explore' },
  { id: 4, target: 'analytics-fairness', route: '/explore' },
] as const;

const STORAGE_KEY = 'horario.tour';
const SEEN_KEY = 'horario.tourSeen';
const AUTO_ADVANCE_MS = 600;

export function stepsForMode(mode: TourMode | null): readonly TourStepMeta[] {
  switch (mode) {
    case 'overview':
      return OVERVIEW_STEPS;
    case 'scheduler':
      return SCHEDULER_DETAIL_STEPS;
    case 'analytics':
      return ANALYTICS_DETAIL_STEPS;
    default:
      return [];
  }
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initialState: TourState = {
  isActive: false,
  currentStepIndex: 0,
  hasCompleted: false,
  sampleDataOffered: false,
  tourMode: null,
};

const finished = (state: TourState): TourState => ({
  ...state,
  isActive: false,
  hasCompleted: true,
  sampleDataOffered: true,
});

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'START_TOUR':
      // Always the picker: a guide that ran before must not restart by itself.
      return { ...state, isActive: true, currentStepIndex: 0, tourMode: null };

    case 'START_TOUR_MODE':
      return { ...state, isActive: true, currentStepIndex: 0, tourMode: action.payload };

    case 'NEXT_STEP': {
      if (!state.isActive || state.tourMode === null) return state;
      const last = stepsForMode(state.tourMode).length - 1;
      if (state.currentStepIndex >= last) return finished(state);
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };
    }

    case 'ADVANCE_FROM':
      // A delayed auto-advance: only if the user is still on that step.
      if (!state.isActive || state.tourMode !== action.mode || state.currentStepIndex !== action.index) {
        return state;
      }
      return tourReducer(state, { type: 'NEXT_STEP' });

    case 'PREV_STEP':
      if (state.currentStepIndex === 0) return state;
      return { ...state, currentStepIndex: state.currentStepIndex - 1 };

    case 'COMPLETE_TOUR':
      return finished(state);

    case 'SKIP_TOUR':
      return { ...state, isActive: false, hasCompleted: true, sampleDataOffered: false };

    case 'TAKE_SAMPLE_DATA_OFFER':
      return state.sampleDataOffered ? { ...state, sampleDataOffered: false } : state;

    case 'RESET_TOUR':
      return { ...initialState };

    case 'SET_HAS_COMPLETED':
      return { ...state, hasCompleted: action.payload };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WelcomeTourContext = createContext<WelcomeTourContextValue | null>(null);

export function WelcomeTourProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tourReducer, initialState);

  const currentSteps = useMemo(() => stepsForMode(state.tourMode), [state.tourMode]);
  const totalSteps = currentSteps.length;
  const currentStep: TourStepMeta | null = state.isActive
    ? currentSteps[state.currentStepIndex] ?? null
    : null;
  const progressPercent = totalSteps > 0 ? ((state.currentStepIndex + 1) / totalSteps) * 100 : 0;

  // ── First launch: open the picker once ───────────────────────────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tourRaw, seenRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SEEN_KEY),
        ]);
        if (cancelled) return;
        let hasCompleted = false;
        if (tourRaw !== null) {
          try {
            const parsed = JSON.parse(tourRaw) as { hasCompleted?: unknown };
            hasCompleted = parsed.hasCompleted === true;
          } catch {
            // Malformed JSON — treat as not completed.
          }
        }
        if (hasCompleted) dispatch({ type: 'SET_HAS_COMPLETED', payload: true });
        if (!hasCompleted && seenRaw === null) {
          dispatch({ type: 'START_TOUR' });
          AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
        }
      } catch {
        // Storage read failure is non-fatal; the tour stays closed.
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Persist completion whenever it changes (after the stored value loaded) ─
  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ hasCompleted: state.hasCompleted })).catch(
      () => undefined,
    );
  }, [state.hasCompleted]);

  // ── Targets ──────────────────────────────────────────────────────────────
  const targetsRef = useRef(new Map<string, TourTargetRef>());
  const registerTarget = useCallback((target: string, ref: TourTargetRef | null) => {
    if (ref) targetsRef.current.set(target, ref);
    else targetsRef.current.delete(target);
  }, []);
  const getTarget = useCallback((target: string) => targetsRef.current.get(target) ?? null, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const startTour = useCallback(() => dispatch({ type: 'START_TOUR' }), []);
  const startTourMode = useCallback(
    (mode: TourMode) => dispatch({ type: 'START_TOUR_MODE', payload: mode }),
    [],
  );
  const nextStep = useCallback(() => dispatch({ type: 'NEXT_STEP' }), []);
  const prevStep = useCallback(() => dispatch({ type: 'PREV_STEP' }), []);
  const skipTour = useCallback(() => dispatch({ type: 'SKIP_TOUR' }), []);
  const completeTour = useCallback(() => dispatch({ type: 'COMPLETE_TOUR' }), []);
  const resetTour = useCallback(() => dispatch({ type: 'RESET_TOUR' }), []);

  const sampleOfferRef = useRef(state.sampleDataOffered);
  sampleOfferRef.current = state.sampleDataOffered;
  const takeSampleDataOffer = useCallback(() => {
    if (!sampleOfferRef.current) return false;
    sampleOfferRef.current = false;
    dispatch({ type: 'TAKE_SAMPLE_DATA_OFFER' });
    return true;
  }, []);

  // The latest position, read when an action is recorded (no stale closure).
  const positionRef = useRef({ mode: state.tourMode, index: state.currentStepIndex, step: currentStep });
  positionRef.current = { mode: state.tourMode, index: state.currentStepIndex, step: currentStep };
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    },
    [],
  );
  const recordTourAction = useCallback((target: string) => {
    const { mode, index, step } = positionRef.current;
    if (!mode || !step || step.target !== target) return;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      dispatch({ type: 'ADVANCE_FROM', mode, index });
    }, AUTO_ADVANCE_MS);
  }, []);

  const value = useMemo<WelcomeTourContextValue>(
    () => ({
      ...state,
      currentSteps,
      currentStep,
      totalSteps,
      progressPercent,
      startTour,
      startTourMode,
      nextStep,
      prevStep,
      skipTour,
      completeTour,
      resetTour,
      registerTarget,
      getTarget,
      takeSampleDataOffer,
      recordTourAction,
    }),
    [
      state,
      currentSteps,
      currentStep,
      totalSteps,
      progressPercent,
      startTour,
      startTourMode,
      nextStep,
      prevStep,
      skipTour,
      completeTour,
      resetTour,
      registerTarget,
      getTarget,
      takeSampleDataOffer,
      recordTourAction,
    ],
  );

  return <WelcomeTourContext.Provider value={value}>{children}</WelcomeTourContext.Provider>;
}

export function useWelcomeTour(): WelcomeTourContextValue {
  const ctx = useContext(WelcomeTourContext);
  if (!ctx) {
    throw new Error('useWelcomeTour must be used within a WelcomeTourProvider');
  }
  return ctx;
}
