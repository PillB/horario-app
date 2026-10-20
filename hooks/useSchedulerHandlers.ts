/**
 * useSchedulerHandlers — all state, effects, derived values, and handlers
 * for the Scheduler screen.  Extracted here to keep scheduler.tsx lean.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useDemandForecast } from '@/hooks/useDemandForecast';
import { useWorkers } from '@/hooks/useWorkers';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';
import { useRoster } from '@/hooks/useRoster';
import { useSessionWellness } from '@/hooks/useSessionWellness';
import { type DemandForecast } from '@/services/demandForecast';
import { type DayOfWeek } from '@/services/rosterService';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type OnboardingStep, type Worker } from '@/types/scheduler';
import {
  createChangeHandler,
  getTemplateWindow,
  isValidDate,
  isValidTime,
  isoDate,
  windowsOverlap,
} from '@/utils/schedulerUtils';
import { addDaysToKey, isDateKey, todayKey } from '@/utils/dateKeys';
import { MIN_WORKER_AGE, validateBirthDate } from '@/utils/workerLaborValidation';
import { autoAssignSettings } from '@/utils/autoAssignSettings';
import { resolveShiftLocation } from '@/utils/scheduleLocation';
import { getBusinessTimeZone } from '@/utils/businessTimeZone';
import { useLocations } from '@/hooks/useLocations';
import {
  findCoveringAvailability,
  validateAvailabilitySubmission,
  validateShiftReadiness,
} from '@/utils/schedulerValidators';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';
import {
  fetchOnboardingProgress,
  type OnboardingProgress,
  upsertOnboardingProgress,
} from '@/services/onboardingProgress';
import {
  type AssignedShift,
  type CoverageShortfall,
} from '@/services/shiftAssigner';
import { runAutoAssign } from '@/services/optimizer/autoAssignClient';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { trackEvent } from '@/services/analytics';
import { useT } from '@/contexts/LocaleContext';
import { useIdentity } from '@/contexts/IdentityContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionBanner = { type: 'success' | 'error' | 'info'; message: string } | null;

export type WorkerFormState = {
  name: string;
  role: string;
  skills: string;
  /** 'YYYY-MM-DD' or '' when unknown. */
  birthDate: string;
  nightWorker: boolean;
  weeklyLimitOptOut: boolean;
  noFixedHours: boolean;
};

const EMPTY_WORKER_FORM: WorkerFormState = {
  name: '',
  role: '',
  skills: '',
  birthDate: '',
  nightWorker: false,
  weeklyLimitOptOut: false,
  noFixedHours: false,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSchedulerHandlers() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const router = useRouter();
  const { t } = useT();
  const { accountId, userId } = useIdentity();
  const { recordTourAction } = useWelcomeTour();

  // ── DB-backed data hooks ──────────────────────────────────────────────────
  const { locations, loaded: locationsLoaded } = useLocations(accountId);
  // "Today" and the forecast horizon are business-local dates (the account's
  // only location's zone, else the device zone).
  const forecastTimeZone = useMemo(() => getBusinessTimeZone(resolveShiftLocation(locations)), [locations]);
  const {
    demandTargets,
    triggerForecast,
    overrideTarget,
    loading: forecastLoading,
    error: forecastError,
    forecasting,
    dataStatus,
    seedBaselineTargets,
    forecastModels,
    forecastNotices,
  } = useDemandForecast(undefined, { timeZone: forecastTimeZone });

  const { workers, addWorker, addAvailability } = useWorkers(accountId);
  const { shiftTemplates, addShiftTemplate } = useShiftTemplates(accountId);
  const { roster, addShift, setShiftStatus, notifyShift } = useRoster(accountId);
  const { canAutoAssign, count: usageCount, increment: incrementUsage } = useUsageLimit(userId, accountId);
  const { acknowledgeBreak, dismissPrompt, minutesActive, promptVisible, recordInteraction } =
    useSessionWellness();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [savedOnboardingProgress, setSavedOnboardingProgress] =
    useState<OnboardingProgress | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [workerSuccessMessage, setWorkerSuccessMessage] = useState<string | null>(null);
  const [templateSuccessMessage, setTemplateSuccessMessage] = useState<string | null>(null);
  const workerSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const templateSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [availabilitySuccessPromptVisible, setAvailabilitySuccessPromptVisible] = useState(false);
  const [actionBanner, setActionBanner] = useState<ActionBanner>(null);
  const [publishCelebration, setPublishCelebration] = useState({
    badgeVisible: false,
    confettiBurst: false,
  });
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  // ── Form state ────────────────────────────────────────────────────────────
  // Default dates are relative to the viewer's "today". They start empty and
  // are filled in after mount: the web HTML is rendered at build time, and a
  // date computed then would not match the client's first render (QA U3,
  // React hydration error #418).
  const [availabilityForm, setAvailabilityForm] = useState({
    workerId: 'W-01',
    day: 'Fri',
    from: '09:00',
    to: '17:00',
  });
  const [shiftForm, setShiftForm] = useState({
    workerId: 'W-01',
    templateId: 'morning',
    date: '',
  });
  const [targetForm, setTargetForm] = useState({
    date: '',
    role: 'Support',
    required: '3',
    notes: 'Weekend backlog',
  });
  const [workerForm, setWorkerForm] = useState<WorkerFormState>(EMPTY_WORKER_FORM);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    role: '',
    start: '09:00',
    end: '17:00',
    coverage: '1',
  });
  const [fallbackMode, setFallbackMode] = useState<'homogeneous' | 'manual' | 'pos'>('homogeneous');
  const [fallbackForm, setFallbackForm] = useState({
    role: 'Support',
    startDate: '',
    days: '7',
    homogeneousDemand: '4',
    shiftsPerDay: '2',
    workersPerShift: '2',
    notes: 'Baseline targets without history',
  });
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [forecastPending, setForecastPending] = useState(false);
  const [forecastEditStarted, setForecastEditStarted] = useState(false);
  const [autoAssignSuggestions, setAutoAssignSuggestions] = useState<AssignedShift[] | null>(null);
  /** Templates the last auto-assign run could not fully cover (null = no run / cleared). */
  const [autoAssignShortfalls, setAutoAssignShortfalls] = useState<CoverageShortfall[] | null>(null);
  const [autoAssignApplying, setAutoAssignApplying] = useState(false);

  // ── Section layout offsets (for scroll-to-section) ────────────────────────
  const [shiftSectionOffset, setShiftSectionOffset] = useState<number | null>(null);
  const [workerSectionOffset, setWorkerSectionOffset] = useState<number | null>(null);
  const [templateSectionOffset, setTemplateSectionOffset] = useState<number | null>(null);
  const [demandSectionOffset, setDemandSectionOffset] = useState<number | null>(null);

  useEffect(() => {
    setShiftForm((prev) => (prev.date ? prev : { ...prev, date: isoDate(2) }));
    setTargetForm((prev) => (prev.date ? prev : { ...prev, date: isoDate(3) }));
    setFallbackForm((prev) => (prev.startDate ? prev : { ...prev, startDate: isoDate(0) }));
  }, []);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const forecastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineTargetsRef = useRef<DemandForecast[] | null>(null);
  const prevOnboardingFlagsRef = useRef({ workers: false, templates: false, forecast: false });
  const scrollViewRef = useRef<ScrollView>(null);
  const shiftSectionRef = useRef<View>(null);
  const workerSectionRef = useRef<View>(null);
  const templateSectionRef = useRef<View>(null);
  const demandSectionRef = useRef<View>(null);
  /** The running auto-assign: a newer run or unmount cancels it. */
  const autoAssignRunRef = useRef<AbortController | null>(null);

  useEffect(() => () => autoAssignRunRef.current?.abort(), []);

  // ── Derived / memoised values ─────────────────────────────────────────────
  // Auto-assign has no location picker yet, so it uses the account's only
  // location; with none (or several) no jurisdiction is applied.
  const autoAssignLocation = useMemo(() => resolveShiftLocation(locations), [locations]);
  const scheduleLocations = useMemo(
    () => ({ locations, loaded: locationsLoaded }),
    [locations, locationsLoaded]
  );

  const updateWorkerField = useCallback(
    <K extends keyof WorkerFormState>(key: K) =>
      (value: WorkerFormState[K]) => {
        recordInteraction();
        setWorkerForm((prev) => ({ ...prev, [key]: value }));
      },
    [recordInteraction]
  );
  const updateTemplateField = useMemo(
    () => createChangeHandler(setTemplateForm, recordInteraction),
    [recordInteraction]
  );
  const updateAvailabilityField = useMemo(
    () => createChangeHandler(setAvailabilityForm, recordInteraction),
    [recordInteraction]
  );
  const updateShiftField = useMemo(
    () => createChangeHandler(setShiftForm, recordInteraction),
    [recordInteraction]
  );
  const updateFallbackField = useMemo(
    () => createChangeHandler(setFallbackForm, recordInteraction),
    [recordInteraction]
  );
  const updateTargetField = useCallback(
    (key: keyof typeof targetForm) =>
      (value: string) => {
        recordInteraction();
        setForecastEditStarted(true);
        setTargetForm((prev) => ({ ...prev, [key]: value }));
      },
    [recordInteraction]
  );

  const rosterLookup = useMemo(() => {
    const map = new Map<string, boolean>();
    roster.forEach((shift) =>
      map.set(`${shift.workerId}::${shift.date}::${shift.templateId}`, true)
    );
    return map;
  }, [roster]);

  const rosterByDate = useMemo(
    () =>
      roster.reduce<Record<string, (Shift & { template?: ShiftTemplate; worker?: Worker })[]>>(
        (acc, shift) => {
          if (!acc[shift.date]) acc[shift.date] = [];
          const template = shiftTemplates.find((t) => t.id === shift.templateId);
          const worker = workers.find((w) => w.id === shift.workerId);
          acc[shift.date].push({ ...shift, template, worker });
          return acc;
        },
        {}
      ),
    [roster, shiftTemplates, workers]
  );

  const upcomingShifts = useMemo(
    () =>
      [...roster]
        .map((shift) => ({
          ...shift,
          template: shiftTemplates.find((t) => t.id === shift.templateId),
          worker: workers.find((w) => w.id === shift.workerId),
        }))
        .sort((a, b) => {
          const aDate = new Date(`${a.date}T${a.template?.start ?? '00:00'}:00`).getTime();
          const bDate = new Date(`${b.date}T${b.template?.start ?? '00:00'}:00`).getTime();
          return aDate - bDate;
        })
        .slice(0, 4),
    [roster, shiftTemplates, workers]
  );

  const staffingGaps = useMemo(
    () =>
      demandTargets
        .map((target) => {
          const scheduled = roster.reduce((total, shift) => {
            const template = shiftTemplates.find((t) => t.id === shift.templateId);
            if (shift.date === target.date && template?.role === target.role) {
              return total + (template.coverage ?? 1);
            }
            return total;
          }, 0);
          return { ...target, scheduled, gap: target.required - scheduled };
        })
        .filter((t) => t.gap > 0),
    [demandTargets, roster, shiftTemplates]
  );

  const forecastDate = targetForm.date.trim();
  const forecastRole = targetForm.role.trim();

  const needsFallbackSetup = useMemo(
    () =>
      !dataStatus.hasHistorical && !dataStatus.hasExternalSignals && !dataStatus.hasExistingTargets,
    [dataStatus.hasExistingTargets, dataStatus.hasExternalSignals, dataStatus.hasHistorical]
  );

  const isForecastInputValid = useMemo(
    () => isValidDate(forecastDate) && forecastRole.length > 0,
    [forecastDate, forecastRole]
  );

  const forecastBlockingReason = useMemo(() => {
    if (!isForecastInputValid) return t('scheduler.demand.forecastNeedInput');
    if (forecastPending) return t('scheduler.demand.forecastWaiting');
    return null;
  }, [forecastPending, isForecastInputValid, t]);

  const forecastActionDisabled =
    !isForecastInputValid || forecasting || forecastLoading || forecastPending;

  const forecastButtonLabel = useMemo(() => {
    if (forecasting || forecastLoading) return t('scheduler.demand.forecastRunning');
    return forecastBlockingReason ?? t('scheduler.demand.runForecast');
  }, [forecastBlockingReason, forecastLoading, forecasting, t]);

  const forecastHelperText = useMemo(() => {
    if (!isForecastInputValid) return t('scheduler.demand.forecastHelperInvalid');
    if (needsFallbackSetup) return t('scheduler.demand.forecastHelperNoData');
    if (forecastPending) return t('scheduler.demand.forecastHelperPending');
    if (forecastLoading || forecasting) return t('scheduler.demand.forecastHelperRunning');
    return t('scheduler.demand.forecastHelperReady');
  }, [
    forecastLoading,
    forecasting,
    forecastPending,
    isForecastInputValid,
    needsFallbackSetup,
    t,
  ]);

  const derivedOnboardingFlags = useMemo(
    () => ({
      workers: workers.length > 0,
      templates: shiftTemplates.length > 0,
      forecast: demandTargets.length > 0 || forecasting || forecastLoading,
    }),
    [demandTargets.length, forecastLoading, forecasting, shiftTemplates.length, workers.length]
  );

  const effectiveOnboardingFlags = useMemo(() => {
    const persisted = savedOnboardingProgress ?? {
      workers: false,
      templates: false,
      forecast: false,
    };
    return {
      workers: persisted.workers || derivedOnboardingFlags.workers,
      templates: persisted.templates || derivedOnboardingFlags.templates,
      forecast: persisted.forecast || derivedOnboardingFlags.forecast,
    };
  }, [derivedOnboardingFlags, savedOnboardingProgress]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const showActionBanner = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      setActionBanner({ message, type });
      if (actionBannerTimerRef.current) clearTimeout(actionBannerTimerRef.current);
      actionBannerTimerRef.current = setTimeout(() => {
        setActionBanner(null);
        actionBannerTimerRef.current = null;
      }, 4500);
    },
    []
  );

  const celebrateRosterPublish = useCallback(() => {
    setPublishCelebration((prev) => ({
      badgeVisible: true,
      confettiBurst: prev.badgeVisible || reduceMotionEnabled ? false : true,
    }));
  }, [reduceMotionEnabled]);

  const scrollToSection = useCallback((offset: number | null) => {
    if (offset == null) return;
    scrollViewRef.current?.scrollTo({ y: Math.max(offset - 12, 0), animated: true });
  }, []);

  const scrollToShiftSection = useCallback(
    () => scrollToSection(shiftSectionOffset),
    [scrollToSection, shiftSectionOffset]
  );

  const goToSection = useCallback(
    (target: OnboardingStep['key']) => {
      const offsetLookup: Record<OnboardingStep['key'], number | null> = {
        workers: workerSectionOffset,
        templates: templateSectionOffset,
        forecast: demandSectionOffset,
      };
      scrollToSection(offsetLookup[target]);
      router.setParams({ section: target });
    },
    [demandSectionOffset, router, scrollToSection, templateSectionOffset, workerSectionOffset]
  );

  const runForecast = useCallback(() => {
    if (!isForecastInputValid || forecasting || forecastLoading) return;
    setForecastPending(false);
    if (!baselineTargetsRef.current && demandTargets.length) {
      baselineTargetsRef.current = demandTargets;
    }
    triggerForecast({ date: forecastDate, role: forecastRole });
  }, [
    baselineTargetsRef,
    demandTargets,
    forecastDate,
    forecastRole,
    forecasting,
    forecastLoading,
    isForecastInputValid,
    triggerForecast,
  ]);

  const buildDateSequence = useCallback((startDate: string, days: number) => {
    const sequence: string[] = [];
    if (!isDateKey(startDate)) return sequence;
    for (let offset = 0; offset < days; offset += 1) {
      sequence.push(addDaysToKey(startDate, offset));
    }
    return sequence;
  }, []);

  const onboardingSteps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'workers',
        title: t('scheduler.onboarding.addWorkers'),
        description: t('scheduler.onboarding.addWorkersDesc'),
        completed: effectiveOnboardingFlags.workers,
        actionLabel: t('scheduler.onboarding.addWorkersAction'),
        onPress: () => goToSection('workers'),
      },
      {
        key: 'templates',
        title: t('scheduler.onboarding.saveTemplates'),
        description: t('scheduler.onboarding.saveTemplatesDesc'),
        completed: effectiveOnboardingFlags.templates,
        actionLabel: t('scheduler.onboarding.saveTemplatesAction'),
        onPress: () => goToSection('templates'),
      },
      {
        key: 'forecast',
        title: t('scheduler.onboarding.runForecast'),
        description: t('scheduler.onboarding.runForecastDesc'),
        completed: effectiveOnboardingFlags.forecast,
        actionLabel: forecastLoading || forecasting ? t('scheduler.demand.forecastRunning') : t('scheduler.onboarding.runForecastAction'),
        onPress: () => goToSection('forecast'),
      },
    ],
    [
      effectiveOnboardingFlags.forecast,
      effectiveOnboardingFlags.templates,
      effectiveOnboardingFlags.workers,
      forecastLoading,
      forecasting,
      goToSection,
      t,
    ]
  );

  const onboardingProgress = useMemo(() => {
    if (!onboardingSteps.length) return 0;
    return onboardingSteps.filter((s) => s.completed).length / onboardingSteps.length;
  }, [onboardingSteps]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotionEnabled);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionEnabled);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchOnboardingProgress(accountId, userId).then((progress) => {
      if (progress && isMounted) setSavedOnboardingProgress(progress);
    });
    return () => { isMounted = false; };
  }, [accountId, userId]);

  useEffect(() => {
    if (!publishCelebration.confettiBurst) return;
    const timer = setTimeout(
      () => setPublishCelebration((prev) => ({ ...prev, confettiBurst: false })),
      1600
    );
    return () => clearTimeout(timer);
  }, [publishCelebration.confettiBurst]);

  useEffect(() => {
    if (reduceMotionEnabled && publishCelebration.confettiBurst) {
      setPublishCelebration((prev) => ({ ...prev, confettiBurst: false }));
    }
  }, [publishCelebration.confettiBurst, reduceMotionEnabled]);

  useEffect(() => {
    if (roster.some((s) => s.status === 'Published')) return;
    setPublishCelebration((prev) =>
      prev.badgeVisible || prev.confettiBurst
        ? { badgeVisible: false, confettiBurst: false }
        : prev
    );
  }, [roster]);

  useEffect(() => {
    const persistProgress = async () => {
      const previous = savedOnboardingProgress ?? {
        workers: false,
        templates: false,
        forecast: false,
      };
      const next: OnboardingProgress = { ...previous };
      (['workers', 'templates', 'forecast'] as const).forEach((key) => {
        if (derivedOnboardingFlags[key] && !previous[key]) next[key] = true;
      });
      const shouldPersist =
        next.workers !== previous.workers ||
        next.templates !== previous.templates ||
        next.forecast !== previous.forecast;
      if (!shouldPersist) return;
      const persisted = await upsertOnboardingProgress(accountId, next, userId);
      if (persisted) {
        setSavedOnboardingProgress(persisted);
      }
      // Silently ignore onboarding persistence failures — this is non-critical
      // and showing an error banner every load is noisy when DB isn't configured.
    };
    persistProgress();
  }, [accountId, derivedOnboardingFlags, savedOnboardingProgress, userId]);

  // Track onboarding step completion events exactly once per step transition
  useEffect(() => {
    const prev = prevOnboardingFlagsRef.current;
    const curr = derivedOnboardingFlags;
    if (!prev.workers && curr.workers) void trackEvent('onboarding_step_completed', { step: 'workers' });
    if (!prev.templates && curr.templates) void trackEvent('onboarding_step_completed', { step: 'templates' });
    if (!prev.forecast && curr.forecast) void trackEvent('onboarding_step_completed', { step: 'forecast' });
    prevOnboardingFlagsRef.current = curr;
  }, [derivedOnboardingFlags]);

  useEffect(() => {
    if (forecastTimerRef.current) {
      clearTimeout(forecastTimerRef.current);
      forecastTimerRef.current = null;
    }
    if (!forecastEditStarted || !isForecastInputValid || forecastLoading || forecasting) {
      setForecastPending(false);
      return;
    }
    setForecastPending(true);
    forecastTimerRef.current = setTimeout(() => {
      runForecast();
      forecastTimerRef.current = null;
    }, 600);
    return () => {
      if (forecastTimerRef.current) {
        clearTimeout(forecastTimerRef.current);
        forecastTimerRef.current = null;
      }
    };
  }, [
    forecastDate,
    forecastRole,
    forecastEditStarted,
    forecastLoading,
    forecasting,
    isForecastInputValid,
    runForecast,
  ]);

  useEffect(() => {
    if (!targetForm.date || !targetForm.role) return;
    const match = demandTargets.find(
      (t) =>
        t.date === targetForm.date && t.role.toLowerCase() === targetForm.role.toLowerCase()
    );
    if (match && `${match.required}` !== targetForm.required) {
      setTargetForm((prev) => ({
        ...prev,
        required: `${match.required}`,
        notes: prev.notes || match.notes || '',
      }));
    }
  }, [demandTargets, targetForm.date, targetForm.role, targetForm.required, targetForm.notes]);

  useEffect(() => {
    if (!baselineTargetsRef.current && demandTargets.length) {
      baselineTargetsRef.current = demandTargets;
    }
  }, [demandTargets]);

  useEffect(() => {
    if (section === 'workers') { scrollToSection(workerSectionOffset); return; }
    if (section === 'templates') { scrollToSection(templateSectionOffset); return; }
    if (section === 'forecast') { scrollToSection(demandSectionOffset); return; }
    if (section === 'shifts') { scrollToShiftSection(); }
  }, [
    demandSectionOffset,
    scrollToSection,
    scrollToShiftSection,
    section,
    shiftSectionOffset,
    templateSectionOffset,
    workerSectionOffset,
  ]);

  useEffect(() => {
    return () => {
      if (actionBannerTimerRef.current) clearTimeout(actionBannerTimerRef.current);
      if (workerSuccessTimerRef.current) clearTimeout(workerSuccessTimerRef.current);
      if (templateSuccessTimerRef.current) clearTimeout(templateSuccessTimerRef.current);
    };
  }, []);

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleAddWorker = useCallback(async () => {
    const trimmedName = workerForm.name.trim();
    const trimmedRole = workerForm.role.trim();
    const trimmedSkills = workerForm.skills.trim();
    if (!trimmedName) { setWorkerError('Worker name is required.'); return; }
    if (trimmedName.length > 100) { setWorkerError('Name must be 100 characters or fewer.'); return; }
    if (!trimmedRole) { setWorkerError('Role is required.'); return; }
    if (trimmedRole.length > 80) { setWorkerError('Role must be 80 characters or fewer.'); return; }
    if (trimmedSkills.length > 200) { setWorkerError('Skills must be 200 characters or fewer.'); return; }
    const birthDate = workerForm.birthDate.trim();
    const birthDateError = birthDate ? validateBirthDate(birthDate, todayKey()) : null;
    if (birthDateError) {
      setWorkerError(t(`workerLabor.errors.${birthDateError}`, { n: String(MIN_WORKER_AGE) }));
      return;
    }
    setWorkerError(null);
    const skills = workerForm.skills.split(',').map((s) => s.trim()).filter(Boolean);
    const result = await addWorker(trimmedName, trimmedRole, skills, {
      birthDate: birthDate || null,
      nightWorker: workerForm.nightWorker,
      weeklyLimitOptOut: workerForm.weeklyLimitOptOut,
      noFixedHours: workerForm.noFixedHours,
    });
    if (result.success) {
      setWorkerForm(EMPTY_WORKER_FORM);
      // Auto-populate availability and shift forms with the new worker's ID
      setAvailabilityForm((prev) => ({ ...prev, workerId: result.worker.id }));
      setShiftForm((prev) => ({ ...prev, workerId: result.worker.id }));
      const isFirst = workers.length === 0;
      void trackEvent('worker_added', { isFirst });
      recordTourAction('workers-section');
      if (workerSuccessTimerRef.current) clearTimeout(workerSuccessTimerRef.current);
      setWorkerSuccessMessage(
        `${trimmedName} added! Now set their availability to enable accurate scheduling.`
      );
      workerSuccessTimerRef.current = setTimeout(() => {
        setWorkerSuccessMessage(null);
        workerSuccessTimerRef.current = null;
      }, 5000);
    } else {
      setWorkerError(result.error ?? 'Failed to add worker. Please try again.');
    }
  }, [addWorker, recordTourAction, t, workerForm, workers.length]);

  const handleAddTemplate = useCallback(async () => {
    const trimmedName = templateForm.name.trim();
    const trimmedRole = templateForm.role.trim();
    const trimmedStart = templateForm.start.trim();
    const trimmedEnd = templateForm.end.trim();
    const coverageNum = parseInt(templateForm.coverage, 10);
    if (!trimmedName) { setTemplateError('Template name is required.'); return; }
    if (trimmedName.length > 100) { setTemplateError('Name must be 100 characters or fewer.'); return; }
    if (!trimmedRole) { setTemplateError('Role is required.'); return; }
    if (trimmedRole.length > 80) { setTemplateError('Role must be 80 characters or fewer.'); return; }
    if (!isValidTime(trimmedStart)) { setTemplateError('Start time must use the 24-hour HH:MM format (e.g. 09:00).'); return; }
    if (!isValidTime(trimmedEnd)) { setTemplateError('End time must use the 24-hour HH:MM format (e.g. 17:00).'); return; }
    if (isNaN(coverageNum) || coverageNum < 1) { setTemplateError('Coverage must be at least 1.'); return; }
    setTemplateError(null);
    const result = await addShiftTemplate(trimmedName, trimmedRole, trimmedStart, trimmedEnd, coverageNum);
    if (result.success) {
      setTemplateForm({ name: '', role: '', start: '09:00', end: '17:00', coverage: '1' });
      // Auto-populate shift form with the new template's ID
      setShiftForm((prev) => ({ ...prev, templateId: result.template.id }));
      void trackEvent('template_added', { isFirst: shiftTemplates.length === 0 });
      recordTourAction('shift-templates-section');
      if (templateSuccessTimerRef.current) clearTimeout(templateSuccessTimerRef.current);
      setTemplateSuccessMessage(
        `"${trimmedName}" template saved! You can now auto-assign workers to this shift.`
      );
      templateSuccessTimerRef.current = setTimeout(() => {
        setTemplateSuccessMessage(null);
        templateSuccessTimerRef.current = null;
      }, 5000);
    } else {
      setTemplateError(result.error ?? 'Failed to add template. Please try again.');
    }
  }, [addShiftTemplate, recordTourAction, shiftTemplates.length, templateForm]);

  const handleAvailabilitySubmit = useCallback(async () => {
    const { errors, normalizedDay, trimmedFrom, trimmedTo, trimmedWorkerId } =
      validateAvailabilitySubmission(availabilityForm, workers);

    if (errors.length > 0 || !normalizedDay) {
      setAvailabilityError(errors.map((e) => e.message).join(' '));
      setAvailabilitySuccessPromptVisible(false);
      return;
    }

    setAvailabilityError(null);
    const result = await addAvailability(
      trimmedWorkerId,
      normalizedDay as DayOfWeek,
      trimmedFrom,
      trimmedTo
    );
    if (result.success) {
      setAvailabilitySuccessPromptVisible(true);
      setAvailabilityForm((prev) => ({ ...prev, day: '', from: '', to: '' }));
      recordTourAction('availability-section');
    } else {
      setAvailabilityError(result.error ?? 'Failed to save availability. Please try again.');
    }
  }, [addAvailability, availabilityForm, recordTourAction, workers]);

  const handleShiftSubmit = useCallback(async () => {
    const trimmedWorkerId = shiftForm.workerId.trim();
    const trimmedTemplateId = shiftForm.templateId.trim();
    const trimmedDate = shiftForm.date.trim();
    const errors: string[] = [];

    const template = shiftTemplates.find((t) => t.id === trimmedTemplateId);
    const worker = workers.find((w) => w.id === trimmedWorkerId);
    const { coveringSlot, weekdayLabel } =
      template && worker
        ? findCoveringAvailability(worker, template, trimmedDate)
        : {
            coveringSlot: undefined,
            weekdayLabel: null,
          };

    if (!trimmedWorkerId || !trimmedTemplateId || !trimmedDate)
      errors.push('All fields are required.');
    if (trimmedDate && !isValidDate(trimmedDate))
      errors.push('Date must use the YYYY-MM-DD format.');
    if (trimmedWorkerId && !workers.some((w) => w.id === trimmedWorkerId))
      errors.push('Worker ID must match an existing worker.');
    if (trimmedTemplateId && !shiftTemplates.some((t) => t.id === trimmedTemplateId))
      errors.push('Template ID must match an existing template.');
    if (template && worker && worker.role !== template.role)
      errors.push(
        `Worker role (${worker.role}) must match template role (${template.role}) before scheduling a shift.`
      );

    const shiftKey = `${trimmedWorkerId}::${trimmedDate}::${trimmedTemplateId}`;
    if (rosterLookup.has(shiftKey))
      errors.push('This worker, date, and template combination is already scheduled.');

    if (template && worker && weekdayLabel && !coveringSlot)
      errors.push(
        `Worker availability on ${weekdayLabel} must cover the template window ${template.start} - ${template.end}.`
      );

    if (template && weekdayLabel) {
      const newWindow = getTemplateWindow(template);
      const overlappingShift = roster.find((existing) => {
        if (existing.workerId !== trimmedWorkerId || existing.date !== trimmedDate) return false;
        const existingTemplate = shiftTemplates.find((t) => t.id === existing.templateId);
        if (!existingTemplate) return false;
        return windowsOverlap(getTemplateWindow(existingTemplate), newWindow);
      });
      if (overlappingShift) {
        const conflictingTemplate = shiftTemplates.find(
          (t) => t.id === overlappingShift.templateId
        );
        errors.push(
          `Worker already has a shift on ${trimmedDate} from ${conflictingTemplate?.start ?? '??'} to ${conflictingTemplate?.end ?? '??'}. Adjust the time window to avoid overlaps.`
        );
      }
    }

    if (errors.length > 0) { setShiftError(errors.join(' ')); return; }
    setShiftError(null);

    const result = await addShift({
      date: trimmedDate,
      workerId: trimmedWorkerId,
      templateId: trimmedTemplateId,
      location: 'HQ',
      status: 'Draft',
      notified: false,
    });
    if (result.success) {
      setShiftForm((prev) => ({ ...prev, date: '' }));
      void trackEvent('shift_assigned');
      recordTourAction('roster-section');
    } else {
      setShiftError(result.error ?? 'Failed to save shift. Please try again.');
    }
  }, [
    addShift,
    recordTourAction,
    roster,
    rosterLookup,
    shiftForm,
    shiftTemplates,
    workers,
  ]);

  const handleTargetSubmit = useCallback(() => {
    const trimmedDate = targetForm.date.trim();
    const trimmedRole = targetForm.role.trim();
    const trimmedNotes = targetForm.notes.trim();
    const errors: string[] = [];

    if (!trimmedDate) errors.push('Date is required.');
    else if (!isValidDate(trimmedDate)) errors.push('Date must use the YYYY-MM-DD format.');
    if (!trimmedRole) errors.push('Role is required.');
    else if (trimmedRole.length > 80) errors.push('Role must be 80 characters or fewer.');
    if (trimmedNotes.length > 500) errors.push('Notes must be 500 characters or fewer.');

    const requiredInput = targetForm.required.trim();
    const normalizedRequired = Number(requiredInput);
    if (requiredInput.length === 0 || Number.isNaN(normalizedRequired))
      errors.push('Required must be a valid number.');
    else if (normalizedRequired < 0) errors.push('Required must be greater than or equal to 0.');
    else if (!Number.isInteger(normalizedRequired)) errors.push('Required must be a whole number.');

    if (errors.length > 0) { setTargetError(errors.join(' ')); return; }
    setTargetError(null);

    const matchingForecast = demandTargets.find(
      (t) => t.date === trimmedDate && t.role.toLowerCase() === trimmedRole.toLowerCase()
    );
    overrideTarget({
      date: trimmedDate,
      role: trimmedRole,
      required: normalizedRequired,
      notes: trimmedNotes,
      confidence: matchingForecast?.confidence,
      lowerBound: matchingForecast?.lowerBound,
      upperBound: matchingForecast?.upperBound,
      source: 'override',
    });
  }, [demandTargets, overrideTarget, targetForm]);

  const handleFallbackSubmit = useCallback(async () => {
    const trimmedRole = fallbackForm.role.trim();
    const trimmedStart = fallbackForm.startDate.trim();
    const trimmedNotes = fallbackForm.notes.trim();
    setFallbackError(null);
    setFallbackMessage(null);

    // POS targets are generated and saved via handlePosTargetsGenerated in DemandSection
    if (fallbackMode === 'pos') { return; }

    if (!trimmedRole) { setFallbackError('Role is required to create baseline demand.'); return; }
    if (!isValidDate(trimmedStart)) {
      setFallbackError('Start date must use the YYYY-MM-DD format.'); return;
    }
    const normalizedDays = Number(fallbackForm.days);
    if (!Number.isFinite(normalizedDays) || normalizedDays <= 0 || !Number.isInteger(normalizedDays)) {
      setFallbackError('Days must be a positive whole number.'); return;
    }

    const safeDays = Math.min(normalizedDays, 60);
    let required = 0;

    if (fallbackMode === 'homogeneous') {
      const normalized = Number(fallbackForm.homogeneousDemand);
      if (!Number.isFinite(normalized) || normalized <= 0) {
        setFallbackError('Enter a positive homogeneous demand.'); return;
      }
      required = normalized;
    } else {
      const normalizedShifts = Number(fallbackForm.shiftsPerDay);
      const normalizedWorkers = Number(fallbackForm.workersPerShift);
      if (
        !Number.isFinite(normalizedShifts) || normalizedShifts <= 0 ||
        !Number.isFinite(normalizedWorkers) || normalizedWorkers <= 0
      ) {
        setFallbackError('Provide positive worker and shift counts.'); return;
      }
      required = normalizedShifts * normalizedWorkers;
    }

    const sequence = buildDateSequence(trimmedStart, safeDays);
    if (!sequence.length) {
      setFallbackError('Unable to build a date range from the provided start date.'); return;
    }

    const generatedTargets: DemandForecast[] = sequence.map((date) => ({
      date,
      role: trimmedRole,
      required,
      notes:
        trimmedNotes ||
        (fallbackMode === 'homogeneous'
          ? 'Homogeneous demand fallback'
          : 'Manual worker/shift fallback'),
      source: 'override',
    }));

    const result = await seedBaselineTargets(generatedTargets);
    if (result.success) {
      setFallbackError(null);
      setFallbackMessage(
        'Baseline demand targets saved. You can now publish coverage or refine forecasts.'
      );
    } else {
      const message = result.error ?? 'Unable to save baseline targets. Please try again.';
      setFallbackMessage(null);
      setFallbackError(message);
    }
  }, [
    buildDateSequence,
    fallbackForm,
    fallbackMode,
    seedBaselineTargets,
  ]);

  const handlePublishShift = useCallback(
    (shiftId: string) => {
      const shift = roster.find((s) => s.id === shiftId);
      if (!shift) return;

      const { errors } = validateShiftReadiness(
        shift, roster, shiftTemplates, workers
      );
      if (errors.length) { showActionBanner(errors.map((e) => e.message).join(' '), 'error'); return; }

      // Alert.alert is a no-op on web — skip confirmation and publish directly.
      const doPublish = async () => {
        const latestShift = roster.find((s) => s.id === shiftId);
        if (!latestShift) return;
        const validation = validateShiftReadiness(
          latestShift, roster, shiftTemplates, workers
        );
        if (validation.errors.length) {
          showActionBanner(validation.errors.map((e) => e.message).join(' '), 'error'); return;
        }
        const publishResult = await setShiftStatus(shiftId, 'Published');
        if (!publishResult.success) {
          showActionBanner(publishResult.error ?? 'Failed to publish shift.', 'error'); return;
        }
        const workerName = workers.find((w) => w.id === latestShift.workerId)?.name ?? latestShift.workerId;
        showActionBanner(
          `${workerName} scheduled for ${latestShift.date}. Tap "Notify" to send their shift via Horario.`,
          'success'
        );
        void trackEvent('schedule_published');
        celebrateRosterPublish();
      };

      if (Platform.OS === 'web') {
        void doPublish();
      } else {
        Alert.alert('Publish shift', 'Re-run validation and publish this roster entry?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Publish', onPress: doPublish },
        ]);
      }
    },
    [
      celebrateRosterPublish,
      roster,
      setShiftStatus,
      shiftTemplates,
      showActionBanner,
      workers,
    ]
  );

  const handleUnpublishShift = useCallback(
    async (shiftId: string) => {
      const shift = roster.find((s) => s.id === shiftId);
      if (!shift) return;
      if (shift.status === 'Draft') { showActionBanner('Shift is already in Draft.', 'info'); return; }
      await setShiftStatus(shiftId, 'Draft');
      const workerName = workers.find((w) => w.id === shift.workerId)?.name ?? shift.workerId;
      showActionBanner(`Unpublished ${workerName} for ${shift.date}.`, 'info');
    },
    [roster, setShiftStatus, showActionBanner, workers]
  );

  const handleNotifyShift = useCallback(
    async (shiftId: string) => {
      const shift = roster.find((s) => s.id === shiftId);
      if (!shift) return;
      if (shift.status !== 'Published') {
        showActionBanner('Publish the shift before notifying workers.', 'info'); return;
      }
      if (shift.notified) {
        showActionBanner('Notifications already sent for this shift.', 'info'); return;
      }
      await notifyShift(shiftId);
      const workerName = workers.find((w) => w.id === shift.workerId)?.name ?? shift.workerId;
      showActionBanner(`Sent notifications for ${workerName} on ${shift.date}.`, 'success');
    },
    [notifyShift, roster, showActionBanner, workers]
  );

  // ── Auto-assign ───────────────────────────────────────────────────────────

  /** Runs auto-assign (ILP in a Web Worker on web, greedy on native) for shiftForm.date
   *  and stores suggestions. The user must call applyAutoAssign to commit them. */
  const handleAutoAssign = useCallback(async () => {
    if (!canAutoAssign) {
      if (Platform.OS === 'web') {
        showActionBanner('Free limit reached. Upgrade to Pro for unlimited auto-assign.', 'error');
      } else {
        Alert.alert(
          'Free limit reached',
          'You have used your 1 free auto-assign. Upgrade to Pro for unlimited optimizations.',
          [{ text: 'OK' }]
        );
      }
      return;
    }
    const date = shiftForm.date.trim();
    if (!isValidDate(date)) {
      showActionBanner('Enter a valid date in the Shift creation form before auto-assigning.', 'error');
      return;
    }
    // No business-level limits are configured in this screen yet; the law's apply.
    const settings = autoAssignSettings(date, autoAssignLocation);
    autoAssignRunRef.current?.abort();
    const run = new AbortController();
    autoAssignRunRef.current = run;
    let result;
    try {
      result = await runAutoAssign(
        {
          date,
          templates: shiftTemplates,
          workers,
          existingRoster: roster,
          constraints: settings.constraints,
          timeZone: settings.timeZone,
        },
        { signal: run.signal },
      );
    } catch (err) {
      if (run.signal.aborted) return; // superseded by a newer run, or unmounted
      showActionBanner(`Auto-assign failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return;
    } finally {
      if (autoAssignRunRef.current === run) autoAssignRunRef.current = null;
    }
    // Every under-covered template (partial or none) is surfaced, not only empty ones.
    setAutoAssignShortfalls(result.unassigned.length > 0 ? result.unassigned : null);
    if (result.assignments.length === 0) {
      setAutoAssignSuggestions(null);
      showActionBanner(
        result.unassigned.length > 0
          ? `Auto-assign: no valid assignments found. ${result.unassigned[0].reason}`
          : 'Auto-assign: no templates configured yet.',
        'info'
      );
      return;
    }
    setAutoAssignSuggestions(result.assignments);
    showActionBanner(
      result.unassigned.length > 0
        ? t('scheduler.shifts.partialCoverageBanner', {
            n: String(result.assignments.length),
            missing: String(result.unassigned.reduce((sum, s) => sum + s.missing, 0)),
          })
        : `Auto-assign found ${result.assignments.length} suggestion(s). Review and click "Apply".`,
      'info'
    );
  }, [autoAssignLocation, canAutoAssign, roster, shiftForm.date, shiftTemplates, showActionBanner, t, workers]);

  /** Persists all pending auto-assign suggestions to the roster. */
  const applyAutoAssign = useCallback(async () => {
    if (!autoAssignSuggestions?.length) return;
    setAutoAssignApplying(true);
    let successCount = 0;
    for (const suggestion of autoAssignSuggestions) {
      const result = await addShift({
        date: suggestion.date,
        workerId: suggestion.workerId,
        templateId: suggestion.templateId,
        location: autoAssignLocation?.id ?? 'HQ',
        status: 'Draft',
        notified: false,
      });
      if (result.success) successCount += 1;
    }
    setAutoAssignSuggestions(null);
    setAutoAssignShortfalls(null);
    setAutoAssignApplying(false);
    if (successCount > 0) {
      // Record freemium usage after at least one shift was successfully applied
      await incrementUsage();
      void trackEvent('auto_assign_used', { successCount });
    }
    showActionBanner(
      `Applied ${successCount} of ${autoAssignSuggestions.length} auto-assign suggestion(s).`,
      successCount === autoAssignSuggestions.length ? 'success' : 'info'
    );
  }, [addShift, autoAssignLocation, autoAssignSuggestions, incrementUsage, showActionBanner]);

  const handlePosTargetsGenerated = useCallback(async (targets: {date: string; role: string; required: number; source: string; notes: string; lowerBound?: number; upperBound?: number; confidence?: number}[]) => {
    let savedCount = 0;
    for (const target of targets) {
      try {
        await overrideTarget({
          date: target.date,
          role: target.role,
          required: target.required,
          source: 'override',
          notes: target.notes,
          lowerBound: target.lowerBound,
          upperBound: target.upperBound,
          confidence: target.confidence,
        });
        savedCount++;
      } catch {
        // Skip individual failures silently; report saved count at end.
      }
    }
    const distinctRoles = new Set(targets.map((tgt) => tgt.role)).size;
    const msg =
      distinctRoles > 1
        ? t('scheduler.demand.posTargetsSavedMulti', { n: String(savedCount), roles: String(distinctRoles) })
        : t('scheduler.demand.posTargetsSaved', { n: String(savedCount) });
    showActionBanner(msg, 'success');
  }, [overrideTarget, showActionBanner, t]);

  /**
   * Seeds the app with realistic sample data after tour completion.
   * Idempotent: only runs if no workers exist yet.
   * Creates 3 workers, 2 templates, and 4 shifts across the current + next week.
   */
  const seedTourData = useCallback(async () => {
    if (workers.length > 0) return; // already has data

    // Helper: YYYY-MM-DD for today + offset days
    const dateOffset = (days: number): string => isoDate(days);

    // Step 1 — add sample workers
    const [w1, w2] = await Promise.all([
      addWorker('Alex Johnson', 'Server', ['Tables', 'POS']),
      addWorker('Maria Garcia', 'Barista', ['Espresso', 'Cold Brew']),
    ]);
    // Third worker added serially to avoid race on optimistic state
    await addWorker('James Williams', 'Server', ['Tables', 'Bar']);

    // Step 2 — add sample templates
    const [tmpl1, tmpl2] = await Promise.all([
      addShiftTemplate('Morning Server', 'Server', '08:00', '14:00', 2),
      addShiftTemplate('Evening Barista', 'Barista', '16:00', '22:00', 1),
    ]);

    // Step 3 — build roster shifts using IDs from the result objects
    const w1Id = w1.worker?.id;
    const w2Id = w2.worker?.id;
    const t1Id = tmpl1.template?.id;
    const t2Id = tmpl2.template?.id;

    const shiftPromises: ReturnType<typeof addShift>[] = [];
    if (w1Id && t1Id) {
      shiftPromises.push(
        addShift({ date: dateOffset(1), workerId: w1Id, templateId: t1Id, location: 'Main Floor', status: 'Draft', notified: false }),
        addShift({ date: dateOffset(3), workerId: w1Id, templateId: t1Id, location: 'Main Floor', status: 'Published', notified: true }),
      );
    }
    if (w2Id && t2Id) {
      shiftPromises.push(
        addShift({ date: dateOffset(2), workerId: w2Id, templateId: t2Id, location: 'Bar', status: 'Draft', notified: false }),
        addShift({ date: dateOffset(5), workerId: w2Id, templateId: t2Id, location: 'Bar', status: 'Published', notified: true }),
      );
    }
    if (shiftPromises.length > 0) await Promise.all(shiftPromises);

    // Celebrate with confetti + banner
    if (!reduceMotionEnabled) {
      setPublishCelebration({ badgeVisible: false, confettiBurst: true });
    }
    showActionBanner(t('tour.completed.seedConfirmation'), 'success');
  }, [workers.length, addWorker, addShiftTemplate, addShift, reduceMotionEnabled, setPublishCelebration, showActionBanner, t]);

  // ── Return all state and handlers for the screen ──────────────────────────
  return {
    // Data
    workers,
    shiftTemplates,
    roster,
    demandTargets,
    forecastError,
    forecastModels,
    forecastNotices,
    forecastLoading,
    forecasting,
    needsFallbackSetup,

    // Wellness
    acknowledgeBreak,
    dismissPrompt,
    minutesActive,
    promptVisible,

    // Refs (attached to JSX elements)
    scrollViewRef,
    workerSectionRef,
    shiftSectionRef,
    templateSectionRef,
    demandSectionRef,
    baselineTargetsRef,

    // Layout offsets (set by onLayout)
    setWorkerSectionOffset,
    setShiftSectionOffset,
    setTemplateSectionOffset,
    setDemandSectionOffset,

    // UI state
    actionBanner,
    publishCelebration,
    reduceMotionEnabled,
    availabilitySuccessPromptVisible,
    setAvailabilitySuccessPromptVisible,
    availabilityError,
    shiftError,
    targetError,
    fallbackError,
    fallbackMessage,
    workerError,
    templateError,
    workerSuccessMessage,
    templateSuccessMessage,

    // Form state
    availabilityForm,
    shiftForm,
    targetForm,
    fallbackForm,
    fallbackMode,
    setFallbackMode,
    workerForm,
    templateForm,

    // Form change handlers
    updateAvailabilityField,
    updateShiftField,
    updateTargetField,
    updateFallbackField,
    updateWorkerField,
    updateTemplateField,

    // Derived / computed
    rosterByDate,
    scheduleLocations,
    upcomingShifts,
    staffingGaps,
    onboardingSteps,
    onboardingProgress,

    // Forecast UI
    forecastButtonLabel,
    forecastHelperText,
    forecastActionDisabled,

    // Navigation
    scrollToShiftSection,
    router,

    // Handlers
    handleAddWorker,
    handleAddTemplate,
    handleAvailabilitySubmit,
    handleShiftSubmit,
    handleTargetSubmit,
    handleFallbackSubmit,
    handlePublishShift,
    handleUnpublishShift,
    handleNotifyShift,
    runForecast,
    handleAutoAssign,
    applyAutoAssign,
    handlePosTargetsGenerated,

    // Auto-assign state
    autoAssignSuggestions,
    autoAssignShortfalls,
    autoAssignApplying,

    // Usage / freemium
    canAutoAssign,
    usageCount,

    // Tour
    seedTourData,
  } as const;
}
