/**
 * useSchedulerHandlers — all state, effects, derived values, and handlers
 * for the Scheduler screen.  Extracted here to keep scheduler.tsx lean.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, ScrollView } from 'react-native';
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
import { addDaysToKey, autoAssignWeekDates, isDateKey, todayKey } from '@/utils/dateKeys';
import { MIN_WORKER_AGE, validateBirthDate } from '@/utils/workerLaborValidation';
import { newUuid } from '@/utils/schedulingValidation';
import { autoAssignSettings } from '@/utils/autoAssignSettings';
import { fetchDaysOffOn } from '@/hooks/useTimeOff';
import { validateDisplayString } from '@/utils/sanitize';
import type { AssignedShift, CoverageShortfall, LaborConstraints } from '@/services/shiftAssigner';
import { resolveShiftLocation } from '@/utils/scheduleLocation';
import { getBusinessTimeZone } from '@/utils/businessTimeZone';
import { useLocations } from '@/hooks/useLocations';
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus';
import { computeStaffingGaps } from '@/utils/staffingGaps';
import {
  findCoveringAvailability,
  localizeValidationErrors,
  validateAvailabilitySubmission,
  validateShiftReadiness,
  type ValidationErrorItem,
} from '@/utils/schedulerValidators';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';
import {
  fetchOnboardingProgress,
  type OnboardingProgress,
  upsertOnboardingProgress,
} from '@/services/onboardingProgress';
import { runAutoAssign } from '@/services/optimizer/autoAssignClient';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { trackEvent } from '@/services/analytics';
import { useT } from '@/contexts/LocaleContext';
import { useIdentity } from '@/contexts/IdentityContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionBanner = { type: 'success' | 'error' | 'info'; message: string } | null;

/** A person to remove with their shifts, counted before and from today (F-11). */
export type WorkerRemoval = { workerId: string; name: string; upcoming: number; past: number };

/** A refusal tied to one roster row. */
export type ShiftRowNotice = { shiftId: string; message: string } | null;

/** The readiness errors in the user's language (the English text when a key is missing). */
const readinessMessage = (
  errors: ValidationErrorItem[],
  t: (key: string, params?: Record<string, string>) => string,
): string => localizeValidationErrors(errors, t).map((m, i) => m || errors[i].message).join(' ');

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

const EMPTY_TEMPLATE_FORM = { name: '', role: '', start: '09:00', end: '17:00', coverage: '1' };

/**
 * The stored row an edit form is editing: its id and its `updatedAt` exactly
 * as read when Edit was pressed. The save sends that `updatedAt`, so a change
 * made elsewhere in between is refused (409), even when the list reloaded
 * meanwhile (CHG-109, D8).
 */
type EditTarget = { id: string; updatedAt?: string };

/** Auto-assign suggestions and the tenant and location they were computed for (D7). */
type AutoAssignRun = {
  accountId: string;
  locationId: string | null;
  suggestions: AssignedShift[];
  /** One client id per suggestion, kept until Apply succeeds: a retry is the same rows. */
  ids: string[];
  /** The date the run was started for: a conflict on Apply runs that week again (F-6). */
  date: string;
};

/** A row the server has stored: it carries the server's `updatedAt` (an optimistic row has none). */
const isServerConfirmed = (row: { updatedAt?: string }) => typeof row.updatedAt === 'string';

/** The run's suggestions while the tenant and location are the ones it ran for, else none. */
export const suggestionsFor = (
  run: AutoAssignRun | null,
  accountId: string,
  locationId: string | null,
): AssignedShift[] | null =>
  run && run.accountId === accountId && run.locationId === locationId ? run.suggestions : null;

/** Says the plan's auto-schedule limit is reached: a banner on web, an alert on native. */
const showAutoAssignLimitReached = (
  showActionBanner: (message: string, kind: 'error') => void,
  t: (key: string) => string,
): void => {
  if (Platform.OS === 'web') {
    showActionBanner(t('upgrade.limitReachedBanner'), 'error');
  } else {
    Alert.alert('Free limit reached', t('upgrade.limitReachedBanner'), [{ text: 'OK' }]);
  }
};

/** The banner after an auto-assign run that found at least one suggestion. */
const autoAssignFoundBanner = (
  assigned: number,
  unassigned: { missing: number }[],
  t: (key: string, params?: Record<string, string>) => string,
): string =>
  unassigned.length > 0
    ? t('scheduler.shifts.partialCoverageBanner', {
        n: String(assigned),
        missing: String(unassigned.reduce((sum, s) => sum + s.missing, 0)),
      })
    : `Auto-assign found ${assigned} suggestion(s). Review and click "Apply".`;

/**
 * What a refused edit leaves in the form: the message, and the `updatedAt` the
 * next save sends. After a 409 that is the version now stored, so saving again
 * replaces it with the form's values (on purpose, after the message said so);
 * before, every later save was refused again with the old `updatedAt`.
 */
export const refusedEditState = (
  result: { error: string; conflictUpdatedAt?: string },
  name: string,
  t: (key: string, params?: Record<string, string>) => string,
): { message: string; updatedAt?: string } =>
  result.conflictUpdatedAt !== undefined
    ? { message: t('scheduler.edit.conflict', { name }), updatedAt: result.conflictUpdatedAt }
    : { message: result.error };

const idOf = (target: { id: string } | null | undefined): string | null => target?.id ?? null;

/** Runs `fn` unless a previous call of it is still running. */
const useSingleFlight = (fn: () => Promise<void> | void) => {
  const busy = useRef(false);
  return useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } finally {
      busy.current = false;
    }
  }, [fn]);
};

/** The steps of the scheduler page, in working order. `shifts` is the roster. */
export const SCHEDULER_SECTIONS = ['workers', 'templates', 'forecast', 'shifts'] as const;
export type SchedulerSection = (typeof SCHEDULER_SECTIONS)[number];

export function isSchedulerSection(value: unknown): value is SchedulerSection {
  return typeof value === 'string' && (SCHEDULER_SECTIONS as readonly string[]).includes(value);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSchedulerHandlers() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const router = useRouter();
  const { t } = useT();
  const { accountId, userId } = useIdentity();
  const { recordTourAction } = useWelcomeTour();

  // ── DB-backed data hooks ──────────────────────────────────────────────────
  const { locations, loaded: locationsLoaded, refresh: refreshLocations } = useLocations(accountId);
  // "Today" and the forecast horizon are business-local dates (the account's
  // only location's zone, else the device zone).
  const forecastTimeZone = useMemo(() => getBusinessTimeZone(resolveShiftLocation(locations)), [locations]);
  const {
    demandTargets,
    triggerForecast,
    overrideTarget,
    removeOverride,
    loading: forecastLoading,
    error: forecastError,
    forecasting,
    dataStatus,
    seedBaselineTargets,
    forecastModels,
    forecastNotices,
    targetsError,
    refresh: refreshDemandTargets,
    forecastRan,
  } = useDemandForecast(accountId, undefined, { timeZone: forecastTimeZone });

  const {
    workers,
    addWorker,
    updateWorker,
    addAvailabilityDays,
    removeWorker,
    removeAvailability,
    loading: workersLoading,
    loaded: workersLoaded,
    error: workersError,
    truncated: workersTruncated,
    refresh: refreshWorkers,
  } = useWorkers(accountId);
  const {
    shiftTemplates,
    addShiftTemplate,
    updateShiftTemplate,
    removeShiftTemplate,
    loading: templatesLoading,
    loaded: templatesLoaded,
    error: templatesError,
    truncated: templatesTruncated,
    refresh: refreshTemplates,
  } = useShiftTemplates(accountId);
  const {
    roster,
    addShift,
    addShifts,
    setShiftStatus,
    notifyShift,
    removeShift,
    loading: rosterLoading,
    loaded: rosterLoaded,
    error: rosterError,
    truncated: rosterTruncated,
    refresh: refreshRoster,
    getRoster,
  } = useRoster(accountId);
  const { canAutoAssign, count: usageCount, refresh: refreshUsage } = useUsageLimit(userId, accountId);
  const { acknowledgeBreak, dismissPrompt, minutesActive, promptVisible, recordInteraction } =
    useSessionWellness();

  // Tabs stay mounted: a location added on Profile, a plan or the month's
  // auto-fill count changed elsewhere shows when the user comes back (D5).
  // The plan banner reloads on `focusReloads`.
  const [focusReloads, setFocusReloads] = useState(0);
  useRefreshOnFocus(() => {
    void refreshLocations();
    void refreshUsage();
    setFocusReloads((n) => n + 1);
  });

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
  /** Why the last Publish of a shift was refused, shown next to that shift's buttons (F-9). */
  const [shiftRowNotice, setShiftRowNotice] = useState<ShiftRowNotice>(null);
  /** A person with shifts the manager asked to remove: waiting for the confirm (F-11). */
  const [workerRemoval, setWorkerRemoval] = useState<WorkerRemoval | null>(null);
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
  // Worker / template start empty: a made-up id ('W-01') shows a "not found"
  // warning on every account that has no such row.
  const [availabilityForm, setAvailabilityForm] = useState({
    workerId: '',
    day: '',
    from: '09:00',
    to: '17:00',
  });
  const [shiftForm, setShiftForm] = useState({
    workerId: '',
    templateId: '',
    date: '',
  });
  const [targetForm, setTargetForm] = useState({
    date: '',
    role: 'Support',
    required: '3',
    notes: 'Weekend backlog',
  });
  const [workerForm, setWorkerForm] = useState<WorkerFormState>(EMPTY_WORKER_FORM);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);
  /** The stored worker / template the form is editing; null = the form adds a new one. */
  const [editingWorker, setEditingWorker] = useState<EditTarget | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<EditTarget | null>(null);
  const editingWorkerId = idOf(editingWorker);
  const editingTemplateId = idOf(editingTemplate);
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
  const [autoAssignRun, setAutoAssignRun] = useState<AutoAssignRun | null>(null);
  /** Templates the last auto-assign run could not fully cover (null = no run / cleared). */
  const [autoAssignShortfalls, setAutoAssignShortfalls] = useState<CoverageShortfall[] | null>(null);
  const [autoAssignApplying, setAutoAssignApplying] = useState(false);

  // ── Active section (one step of the page is shown at a time) ──────────────
  // null = the user has not picked one and the URL names none: the default
  // below applies once the roster has loaded.
  const [sectionChoice, setSectionChoice] = useState<SchedulerSection | null>(null);

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
  /** The running auto-assign: a newer run or unmount cancels it. */
  const autoAssignRunRef = useRef<AbortController | null>(null);

  useEffect(() => () => autoAssignRunRef.current?.abort(), []);

  // ── Derived / memoised values ─────────────────────────────────────────────
  // New shifts and auto-assign use the location picked in the roster step,
  // else the account's only location; with none no jurisdiction is applied.
  const [pickedLocationId, setPickedLocationId] = useState<string | null>(null);
  const autoAssignLocation = useMemo(
    () => locations.find((l) => l.id === pickedLocationId) ?? resolveShiftLocation(locations),
    [locations, pickedLocationId]
  );
  const autoAssignLocationId = idOf(autoAssignLocation);
  // Suggestions belong to the tenant and location they were computed for: a
  // different pick (or tenant) shows none, so Apply never saves them under
  // another location's rules (D7).
  const autoAssignSuggestions = suggestionsFor(autoAssignRun, accountId, autoAssignLocationId);
  useEffect(() => {
    // A run still computing was for the old tenant or location: its result is dropped.
    autoAssignRunRef.current?.abort();
    autoAssignRunRef.current = null;
    setAutoAssignRun((run) =>
      run && (run.accountId !== accountId || run.locationId !== autoAssignLocationId) ? null : run,
    );
    setAutoAssignShortfalls(null);
  }, [accountId, autoAssignLocationId]);
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

  // Upcoming = from today on (business-local date); before CHG-088 the list
  // started at the oldest stored shift.
  const upcomingShifts = useMemo(
    () =>
      roster
        .filter((shift) => shift.date >= todayKey(forecastTimeZone))
        .map((shift) => ({
          ...shift,
          template: shiftTemplates.find((t) => t.id === shift.templateId),
          worker: workers.find((w) => w.id === shift.workerId),
        }))
        .sort((a, b) => {
          const aDate = new Date(`${a.date}T${a.template?.start ?? '00:00'}:00`).getTime();
          const bDate = new Date(`${b.date}T${b.template?.start ?? '00:00'}:00`).getTime();
          return aDate - bDate;
        }),
    [forecastTimeZone, roster, shiftTemplates, workers]
  );

  /** Load state of the stored lists, for SyncNotice. */
  const syncStatus = useMemo(
    () => ({
      loading:
        (workersLoading && !workersLoaded) ||
        (templatesLoading && !templatesLoaded) ||
        (rosterLoading && !rosterLoaded),
      errors: [workersError, templatesError, rosterError, targetsError].filter((e): e is string => Boolean(e)),
      truncated: workersTruncated || templatesTruncated || rosterTruncated,
    }),
    [
      rosterError, rosterLoaded, rosterLoading, rosterTruncated, targetsError,
      templatesError, templatesLoaded, templatesLoading, templatesTruncated,
      workersError, workersLoaded, workersLoading, workersTruncated,
    ]
  );

  /** When the stored lists last finished loading without an error (SyncStatusBar). */
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const listsSettled = workersLoaded && templatesLoaded && rosterLoaded
    && !workersLoading && !templatesLoading && !rosterLoading;
  const listsFailed = syncStatus.errors.length > 0;
  useEffect(() => {
    if (listsSettled && !listsFailed) setLastSyncedAt(Date.now());
  }, [listsSettled, listsFailed]);

  /**
   * Business limits from the advanced controls. They apply to auto-assign only
   * after the manager changes one: the panel's defaults are not silent rules.
   */
  const [businessConstraints, setBusinessConstraints] = useState<LaborConstraints | undefined>(undefined);
  const constraintEmissionsRef = useRef(0);
  const handleConstraintsChange = useCallback((c: { minRestHours: number; maxWeeklyHours: number }) => {
    constraintEmissionsRef.current += 1;
    if (constraintEmissionsRef.current === 1) return; // the panel reports its defaults on mount
    setBusinessConstraints({
      ...(c.minRestHours > 0 ? { minRestHoursBetweenShifts: c.minRestHours } : {}),
      ...(c.maxWeeklyHours > 0 ? { maxWeeklyHours: c.maxWeeklyHours } : {}),
    });
  }, []);

  const retrySync = useCallback(() => {
    void refreshWorkers();
    void refreshTemplates();
    void refreshRoster();
    void refreshDemandTargets();
  }, [refreshDemandTargets, refreshRoster, refreshTemplates, refreshWorkers]);

  // The same rule as Home and Analytics (utils/staffingGaps.ts): stored
  // overrides only (a model forecast still in memory is not demand yet),
  // Published rows only, one row = one person (D1).
  const staffingGaps = useMemo(
    () => computeStaffingGaps(demandTargets, roster, shiftTemplates),
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

  // The server keeps a step done forever, so only rows the server confirmed
  // count: an optimistic row may still be refused. "Run forecast" is done by
  // a run that produced forecasts for this tenant (not a refused or empty
  // one), or by a stored override.
  const derivedOnboardingFlags = useMemo(
    () => ({
      workers: workers.some(isServerConfirmed),
      templates: shiftTemplates.some(isServerConfirmed),
      forecast: forecastRan || demandTargets.some((target) => target.source === 'override'),
    }),
    [demandTargets, forecastRan, shiftTemplates, workers]
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

  const goToSection = useCallback(
    (target: SchedulerSection) => {
      setSectionChoice(target);
      // Keep the URL in step so a reload or a shared link opens the same step.
      router.setParams({ section: target });
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    },
    [router]
  );

  const scrollToShiftSection = useCallback(() => goToSection('shifts'), [goToSection]);

  // A returning account opens on its roster, a new one on the first step.
  // Until the roster has loaded (or failed to) there is no default yet.
  const activeSection: SchedulerSection | null =
    sectionChoice ??
    (roster.length > 0 ? 'shifts' : rosterLoaded || rosterError ? 'workers' : null);

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

  // A link such as /scheduler?section=forecast opens that step.
  useEffect(() => {
    if (isSchedulerSection(section)) setSectionChoice(section);
  }, [section]);

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
    const workerTextError = validateDisplayString(trimmedName, 'Name') ?? validateDisplayString(trimmedRole, 'Role');
    if (workerTextError) { setWorkerError(workerTextError); return; }
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
    const labor = {
      birthDate: birthDate || null,
      nightWorker: workerForm.nightWorker,
      weeklyLimitOptOut: workerForm.weeklyLimitOptOut,
      noFixedHours: workerForm.noFixedHours,
    };
    if (editingWorker) {
      const updated = await updateWorker(
        editingWorker.id,
        { name: trimmedName, role: trimmedRole, skills, ...labor },
        editingWorker.updatedAt,
      );
      if (updated.success) {
        setWorkerForm(EMPTY_WORKER_FORM);
        setEditingWorker(null);
        showActionBanner(t('scheduler.edit.saved', { name: trimmedName }), 'success');
      } else {
        const refused = refusedEditState(updated, trimmedName, t);
        if (refused.updatedAt) setEditingWorker({ id: editingWorker.id, updatedAt: refused.updatedAt });
        setWorkerError(refused.message);
      }
      return;
    }
    const result = await addWorker(trimmedName, trimmedRole, skills, labor);
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
  }, [addWorker, editingWorker, recordTourAction, showActionBanner, t, updateWorker, workerForm, workers.length]);

  const handleAddTemplate = useCallback(async () => {
    const trimmedName = templateForm.name.trim();
    const trimmedRole = templateForm.role.trim();
    const trimmedStart = templateForm.start.trim();
    const trimmedEnd = templateForm.end.trim();
    const coverageNum = parseInt(templateForm.coverage, 10);
    if (!trimmedName) { setTemplateError('Template name is required.'); return; }
    if (trimmedName.length > 100) { setTemplateError('Name must be 100 characters or fewer.'); return; }
    if (!trimmedRole) { setTemplateError('Role is required.'); return; }
    const templateTextError = validateDisplayString(trimmedName, 'Template name') ?? validateDisplayString(trimmedRole, 'Role');
    if (templateTextError) { setTemplateError(templateTextError); return; }
    if (trimmedRole.length > 80) { setTemplateError('Role must be 80 characters or fewer.'); return; }
    if (!isValidTime(trimmedStart)) { setTemplateError('Start time must use the 24-hour HH:MM format (e.g. 09:00).'); return; }
    if (!isValidTime(trimmedEnd)) { setTemplateError('End time must use the 24-hour HH:MM format (e.g. 17:00).'); return; }
    if (isNaN(coverageNum) || coverageNum < 1) { setTemplateError('Coverage must be at least 1.'); return; }
    setTemplateError(null);
    if (editingTemplate) {
      const updated = await updateShiftTemplate(editingTemplate.id, {
        name: trimmedName, role: trimmedRole, startTime: trimmedStart, endTime: trimmedEnd, coverage: coverageNum,
      }, editingTemplate.updatedAt);
      if (updated.success) {
        setTemplateForm(EMPTY_TEMPLATE_FORM);
        setEditingTemplate(null);
        showActionBanner(t('scheduler.edit.saved', { name: trimmedName }), 'success');
      } else {
        const refused = refusedEditState(updated, trimmedName, t);
        if (refused.updatedAt) setEditingTemplate({ id: editingTemplate.id, updatedAt: refused.updatedAt });
        setTemplateError(refused.message);
      }
      return;
    }
    const result = await addShiftTemplate(trimmedName, trimmedRole, trimmedStart, trimmedEnd, coverageNum);
    if (result.success) {
      setTemplateForm(EMPTY_TEMPLATE_FORM);
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
  }, [addShiftTemplate, editingTemplate, recordTourAction, shiftTemplates.length, showActionBanner, t, templateForm, updateShiftTemplate]);

  /** Saves one template from a playbook. A template already saved under that name, role and hours is skipped. */
  const handleImportPlaybookTemplate = useCallback(
    async (tpl: { name: string; role: string; start: string; end: string; coverage: number }) => {
      const exists = shiftTemplates.some(
        (existing) => existing.name === tpl.name && existing.role === tpl.role
          && existing.start === tpl.start && existing.end === tpl.end,
      );
      if (exists) {
        showActionBanner(`"${tpl.name}" is already in your templates.`, 'info');
        return;
      }
      const result = await addShiftTemplate(tpl.name, tpl.role, tpl.start, tpl.end, tpl.coverage);
      if (result.success) {
        void trackEvent('template_added', { isFirst: shiftTemplates.length === 0 });
        showActionBanner(`"${tpl.name}" template saved.`, 'success');
      } else {
        showActionBanner(t('scheduler.sync.saveFailed', { error: result.error ?? '' }), 'error');
      }
    },
    [addShiftTemplate, shiftTemplates, showActionBanner, t],
  );

  const handleAvailabilitySubmit = useCallback(async () => {
    // `day` holds one day or several, comma-separated (the day chips).
    const days = availabilityForm.day.split(',').map((d) => d.trim()).filter(Boolean);
    const checks = (days.length > 0 ? days : ['']).map((day) =>
      validateAvailabilitySubmission({ ...availabilityForm, day }, workers),
    );
    const messages = [...new Set(checks.flatMap((c) => c.errors.map((e) => e.message)))];
    if (messages.length > 0 || checks.some((c) => !c.normalizedDay)) {
      setAvailabilityError(messages.join(' '));
      setAvailabilitySuccessPromptVisible(false);
      return;
    }

    setAvailabilityError(null);
    // Every picked day in one request: all are saved or none (F-5, CHG-109).
    const submitted = availabilityForm;
    const result = await addAvailabilityDays(
      checks[0].trimmedWorkerId,
      checks.map((check) => check.normalizedDay as DayOfWeek),
      checks[0].trimmedFrom,
      checks[0].trimmedTo,
    );
    if (!result.success) {
      // The days stay selected to fix and save again.
      setAvailabilityError(result.error ?? 'Failed to save availability. Please try again.');
      return;
    }
    setAvailabilitySuccessPromptVisible(true);
    recordTourAction('availability-section');
    // Keep the worker and the hours for the next entry; clear the saved days, but only
    // while the form still shows this entry: a manager who already picked the next
    // person and their days keeps them (F-5: the answer used to clear them).
    setAvailabilityForm((prev) =>
      prev.workerId === submitted.workerId && prev.day === submitted.day ? { ...prev, day: '' } : prev,
    );
  }, [addAvailabilityDays, availabilityForm, recordTourAction, workers]);

  const handleShiftSubmit = useCallback(async () => {
    const workerInput = shiftForm.workerId.trim();
    const trimmedTemplateId = shiftForm.templateId.trim();
    const trimmedDate = shiftForm.date.trim();
    const errors: string[] = [];

    const template = shiftTemplates.find((t) => t.id === trimmedTemplateId);
    // The picker fills the short id ("W-1"); a pasted UUID works too.
    const worker = workers.find((w) => w.displayId === workerInput) ?? workers.find((w) => w.id === workerInput);
    const trimmedWorkerId = worker?.id ?? workerInput;
    // The assigner's own availability rule, in the zone of the shift's location (F-9).
    const { covered, weekdayLabel } =
      template && worker
        ? findCoveringAvailability(worker, template, trimmedDate, getBusinessTimeZone(autoAssignLocation))
        : { covered: false, weekdayLabel: null };

    if (!trimmedWorkerId || !trimmedTemplateId || !trimmedDate)
      errors.push('All fields are required.');
    if (trimmedDate && !isValidDate(trimmedDate))
      errors.push('Date must use the YYYY-MM-DD format.');
    if (trimmedWorkerId && !worker)
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

    if (template && worker && weekdayLabel && !covered)
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
      // The account's only location (as auto-assign does); with several, no
      // picker yet, so the entry names none and compliance says so.
      location: autoAssignLocation?.id ?? '',
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
    autoAssignLocation,
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
      setShiftRowNotice(null);
      // The publish check uses the assigner's availability rule in the zone of the
      // shift's location, so what auto-assign made can be published (F-9).
      const readiness = (s: Shift) =>
        validateShiftReadiness(s, roster, shiftTemplates, workers, getBusinessTimeZone(resolveShiftLocation(locations, s.location)));
      // A refusal is said next to the shift's buttons as well as in the banner at the
      // top, which may be scrolled out of view and hides after a few seconds (F-9).
      const refuse = (message: string) => {
        setShiftRowNotice({ shiftId, message });
        showActionBanner(message, 'error');
      };

      const { errors } = readiness(shift);
      if (errors.length) { refuse(readinessMessage(errors, t)); return; }

      // Alert.alert is a no-op on web — skip confirmation and publish directly.
      const doPublish = async () => {
        const latestShift = roster.find((s) => s.id === shiftId);
        if (!latestShift) return;
        const validation = readiness(latestShift);
        if (validation.errors.length) { refuse(readinessMessage(validation.errors, t)); return; }
        const publishResult = await setShiftStatus(shiftId, 'Published');
        if (!publishResult.success) { refuse(publishResult.error ?? 'Failed to publish shift.'); return; }
        const workerName = workers.find((w) => w.id === latestShift.workerId)?.name ?? latestShift.workerId;
        showActionBanner(
          `${workerName} scheduled for ${latestShift.date}. Tell them, then mark the shift as told.`,
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
      locations,
      roster,
      setShiftStatus,
      shiftTemplates,
      showActionBanner,
      t,
      workers,
    ]
  );

  const handleUnpublishShift = useCallback(
    async (shiftId: string) => {
      const shift = roster.find((s) => s.id === shiftId);
      if (!shift) return;
      if (shift.status === 'Draft') { showActionBanner('Shift is already in Draft.', 'info'); return; }
      const result = await setShiftStatus(shiftId, 'Draft');
      if (!result.success) {
        showActionBanner(t('scheduler.sync.saveFailed', { error: result.error }), 'error');
        return;
      }
      const workerName = workers.find((w) => w.id === shift.workerId)?.name ?? shift.workerId;
      showActionBanner(`Unpublished ${workerName} for ${shift.date}.`, 'info');
    },
    [roster, setShiftStatus, showActionBanner, t, workers]
  );

  const handleNotifyShift = useCallback(
    async (shiftId: string) => {
      const shift = roster.find((s) => s.id === shiftId);
      if (!shift) return;
      if (shift.status !== 'Published') {
        showActionBanner('Publish the shift before marking it as told.', 'info'); return;
      }
      if (shift.notified) {
        showActionBanner('This shift is already marked as told.', 'info'); return;
      }
      const result = await notifyShift(shiftId);
      if (!result.success) {
        showActionBanner(t('scheduler.sync.saveFailed', { error: result.error }), 'error');
        return;
      }
      const workerName = workers.find((w) => w.id === shift.workerId)?.name ?? shift.workerId;
      showActionBanner(`Marked ${workerName} as told about ${shift.date}. No message was sent.`, 'success');
    },
    [notifyShift, roster, showActionBanner, t, workers]
  );

  // ── Deletes (optimistic; a refused delete puts the row back and says why) ──

  const reportRemoval = useCallback(
    (result: { success: boolean; error?: string }, name: string) =>
      showActionBanner(
        result.success
          ? t('scheduler.remove.removed', { name })
          : t('scheduler.sync.saveFailed', { error: result.error ?? '' }),
        result.success ? 'success' : 'error'
      ),
    [showActionBanner, t]
  );

  /** Loads a stored worker into the form; saving then updates it instead of adding. */
  const handleEditWorker = useCallback(
    (workerId: string) => {
      const worker = workers.find((w) => w.id === workerId);
      if (!worker) return;
      setWorkerError(null);
      setEditingWorker({ id: workerId, updatedAt: worker.updatedAt });
      setWorkerForm({
        name: worker.name,
        role: worker.role,
        skills: worker.skills.join(', '),
        birthDate: worker.birthDate ?? '',
        nightWorker: worker.nightWorker ?? false,
        weeklyLimitOptOut: worker.weeklyLimitOptOut ?? false,
        noFixedHours: worker.noFixedHours ?? false,
      });
    },
    [workers]
  );

  const cancelWorkerEdit = useCallback(() => {
    setEditingWorker(null);
    setWorkerError(null);
    setWorkerForm(EMPTY_WORKER_FORM);
  }, []);

  const handleEditTemplate = useCallback(
    (templateId: string) => {
      const template = shiftTemplates.find((tmpl) => tmpl.id === templateId);
      if (!template) return;
      setTemplateError(null);
      setEditingTemplate({ id: templateId, updatedAt: template.updatedAt });
      setTemplateForm({
        name: template.name,
        role: template.role,
        start: template.start,
        end: template.end,
        coverage: String(template.coverage),
      });
    },
    [shiftTemplates]
  );

  const cancelTemplateEdit = useCallback(() => {
    setEditingTemplate(null);
    setTemplateError(null);
    setTemplateForm(EMPTY_TEMPLATE_FORM);
  }, []);

  /** The person's roster shifts, split at today in the business zone, for the confirm step. */
  const removalOf = useCallback(
    (workerId: string, name: string): WorkerRemoval | null => {
      const shifts = getRoster().filter((s) => s.workerId === workerId);
      if (shifts.length === 0) return null;
      const today = todayKey(forecastTimeZone);
      const past = shifts.filter((s) => s.date < today).length;
      return { workerId, name, upcoming: shifts.length - past, past };
    },
    [forecastTimeZone, getRoster]
  );

  /**
   * Removes a person. One with shifts on the roster is not removed at once: the
   * screen asks first (F-11), because their shifts go with them. A plain delete
   * the server refuses because a shift was added elsewhere meanwhile asks too.
   */
  const handleRemoveWorker = useCallback(
    async (workerId: string) => {
      const name = workers.find((w) => w.id === workerId)?.name ?? workerId;
      if (workerId === editingWorkerId) cancelWorkerEdit();
      const known = removalOf(workerId, name);
      if (known) { setWorkerRemoval(known); return; }
      const result = await removeWorker(workerId);
      if (!result.success && result.status === 409 && (await refreshRoster())) {
        const found = removalOf(workerId, name);
        if (found) { setWorkerRemoval(found); return; }
      }
      reportRemoval(result, name);
    },
    [cancelWorkerEdit, editingWorkerId, refreshRoster, removalOf, removeWorker, reportRemoval, workers]
  );

  /** The manager confirmed: the person and all their shifts go, in one transaction. */
  const confirmWorkerRemoval = useCallback(async () => {
    const pending = workerRemoval;
    if (!pending) return;
    setWorkerRemoval(null);
    const result = await removeWorker(pending.workerId, { withShifts: true });
    // Their shifts left the roster on the server: show that here too.
    if (result.success) void refreshRoster();
    reportRemoval(result, pending.name);
  }, [refreshRoster, removeWorker, reportRemoval, workerRemoval]);

  const cancelWorkerRemoval = useCallback(() => setWorkerRemoval(null), []);

  const handleRemoveAvailability = useCallback(
    async (workerId: string, slotId: string) => {
      const slot = workers.find((w) => w.id === workerId)?.availability.find((s) => s.id === slotId);
      reportRemoval(await removeAvailability(workerId, slotId), slot ? `${slot.day} ${slot.from}–${slot.to}` : slotId);
    },
    [removeAvailability, reportRemoval, workers]
  );

  const handleRemoveTemplate = useCallback(
    async (templateId: string) => {
      const name = shiftTemplates.find((tmpl) => tmpl.id === templateId)?.name ?? templateId;
      if (templateId === editingTemplateId) cancelTemplateEdit();
      reportRemoval(await removeShiftTemplate(templateId), name);
    },
    [cancelTemplateEdit, editingTemplateId, removeShiftTemplate, reportRemoval, shiftTemplates]
  );

  const handleRemoveOverride = useCallback(
    async (target: { date: string; role: string }) => {
      const result = await removeOverride(target);
      reportRemoval({ success: result.success, error: result.error ?? undefined }, `${target.role} · ${target.date}`);
    },
    [removeOverride, reportRemoval]
  );

  const handleRemoveShift = useCallback(
    async (shiftId: string) => {
      const shift = roster.find((s) => s.id === shiftId);
      const workerName = workers.find((w) => w.id === shift?.workerId)?.name ?? shift?.workerId ?? shiftId;
      reportRemoval(await removeShift(shiftId), shift ? `${workerName} · ${shift.date}` : workerName);
    },
    [removeShift, reportRemoval, roster, workers]
  );

  // ── Auto-assign ───────────────────────────────────────────────────────────

  /**
   * Computes suggestions for the Monday-to-Sunday week of `date` against the roster
   * as it is now. The previous suggestions go first: while the new ones compute, Apply
   * cannot save the old ones (F-6: they were applied again after a refusal). The
   * roster is read when the run starts (`getRoster`), not from this render, so a run
   * started right after a reload (the re-run after a 409) sees the reloaded rows.
   */
  const runAutoAssignFor = useCallback(async (date: string, lead = '') => {
    setAutoAssignRun(null);
    setAutoAssignShortfalls(null);
    // The law's limits, merged with the manager's own (advanced controls); stricter wins.
    const settings = autoAssignSettings(date, autoAssignLocation, businessConstraints);
    // One run fills the date's Monday-to-Sunday week, from today on (CHG-108).
    const week = autoAssignWeekDates(date, todayKey(settings.timeZone));
    // A newer run, Dismiss, a tenant or location change or unmount aborts this
    // one: from then on its outcome is dropped, whatever the engine returns.
    autoAssignRunRef.current?.abort();
    const run = new AbortController();
    autoAssignRunRef.current = run;
    // A person with a day off (team step) is not suggested on that day.
    // Unknown days off stop the run: a guess could suggest someone who is away.
    const off = await fetchDaysOffOn(week);
    if (run.signal.aborted) return;
    if (!off.ok) {
      showActionBanner(t('teamTools.daysOffLoadError', { error: off.error }), 'error');
      return;
    }
    let result;
    try {
      result = await runAutoAssign(
        {
          date: week[0],
          dates: week,
          templates: shiftTemplates,
          workers,
          daysOff: off.daysOff,
          existingRoster: getRoster(),
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
    if (run.signal.aborted) return;
    // Every under-covered template (partial or none) is surfaced, not only empty ones.
    setAutoAssignShortfalls(result.unassigned.length > 0 ? result.unassigned : null);
    if (result.assignments.length === 0) {
      showActionBanner(
        lead + (result.unassigned.length > 0
          ? `Auto-assign: no valid assignments found. ${result.unassigned[0].reason}`
          : 'Auto-assign: no templates configured yet.'),
        'info'
      );
      return;
    }
    setAutoAssignRun({
      accountId,
      locationId: autoAssignLocationId,
      suggestions: result.assignments,
      ids: result.assignments.map(() => newUuid()),
      date,
    });
    // `lead` says why the run happened (a refused Apply); it stays in front of the result.
    showActionBanner(`${lead}${autoAssignFoundBanner(result.assignments.length, result.unassigned, t)}`, 'info');
  }, [accountId, autoAssignLocation, autoAssignLocationId, businessConstraints, getRoster, shiftTemplates, showActionBanner, t, workers]);

  /** Runs auto-assign (ILP in a Web Worker on web, greedy on native) for the whole week
   *  (Monday to Sunday) that contains shiftForm.date, and stores suggestions. One run is one
   *  auto-schedule of the plan (CHG-108). The user must call applyAutoAssign to commit them. */
  const handleAutoAssign = useCallback(async () => {
    // While Apply is saving, a new run would replace what is being saved.
    if (autoAssignApplying) return;
    if (!canAutoAssign) {
      showAutoAssignLimitReached(showActionBanner, t);
      return;
    }
    const date = shiftForm.date.trim();
    if (!isValidDate(date)) {
      showActionBanner('Enter a valid date in the Shift creation form before auto-assigning.', 'error');
      return;
    }
    await runAutoAssignFor(date);
  }, [autoAssignApplying, canAutoAssign, runAutoAssignFor, shiftForm.date, showActionBanner, t]);

  /**
   * Persists all pending auto-assign suggestions to the roster, under the
   * location they were computed for (the run's, not whatever is picked now).
   */
  const applyAutoAssign = useCallback(async () => {
    const run = autoAssignRun;
    if (!run || autoAssignSuggestions !== run.suggestions || !run.suggestions.length || autoAssignApplying) return;
    setAutoAssignApplying(true);
    // The run is counted in the same request that saves it (and in the same database
    // transaction): a save that is refused costs no run, and a run over the limit saves nothing.
    // One request: every suggestion is stored or none is, never half a schedule.
    const result = await addShifts(run.suggestions.map((suggestion, index) => ({
      id: run.ids[index],
      date: suggestion.date,
      workerId: suggestion.workerId,
      templateId: suggestion.templateId,
      location: run.locationId ?? '',
      status: 'Draft' as const,
      notified: false,
    })), { countAutoAssign: true });
    void refreshUsage();
    setAutoAssignApplying(false);
    if (!result.success) {
      if (result.status === 409) {
        // Some suggested slot was taken meanwhile (another tab, another manager). addShifts
        // has reloaded the roster; these suggestions can never be saved as they are, so they
        // are made again from the reloaded roster (a run is counted only when applied) (F-6).
        showActionBanner(t('scheduler.shifts.autoAssignConflictRerun'), 'error');
        void runAutoAssignFor(run.date, `${t('scheduler.shifts.autoAssignConflictRerun')} `);
        return;
      }
      // No clear answer or another refusal: the suggestions stay with their ids, so the
      // manager can apply again and a lost answer is replayed, not saved twice.
      showActionBanner(t('scheduler.sync.saveFailed', { error: result.error }), 'error');
      return;
    }
    const successCount = run.suggestions.length;
    setAutoAssignRun((current) => (current === run ? null : current));
    setAutoAssignShortfalls(null);
    if (result.alreadyStored) {
      // The first Apply saved them and only its answer was lost.
      showActionBanner(t('scheduler.shifts.autoAssignAlreadySaved', { n: String(successCount) }), 'success');
      return;
    }
    void trackEvent('auto_assign_used', { successCount });
    showActionBanner(`Applied ${successCount} of ${successCount} auto-assign suggestion(s).`, 'success');
  }, [addShifts, autoAssignApplying, autoAssignRun, autoAssignSuggestions, refreshUsage, runAutoAssignFor, showActionBanner, t]);

  /** Drops the suggestions without saving any. */
  const dismissAutoAssign = useCallback(() => {
    // A run still computing would bring the suggestions back when it finishes.
    autoAssignRunRef.current?.abort();
    autoAssignRunRef.current = null;
    setAutoAssignRun(null);
    setAutoAssignShortfalls(null);
  }, []);

  const handlePosTargetsGenerated = useCallback(async (targets: {date: string; role: string; required: number; source: string; notes: string; lowerBound?: number; upperBound?: number; confidence?: number}[]) => {
    // One batch, and its real outcome: before, each row was its own request and
    // a row the server refused was still counted as saved.
    const result = await seedBaselineTargets(targets.map((target) => ({
      date: target.date,
      role: target.role,
      required: target.required,
      source: 'override' as const,
      notes: target.notes,
      lowerBound: target.lowerBound,
      upperBound: target.upperBound,
      confidence: target.confidence,
    })));
    if (!result.success) {
      showActionBanner(t('scheduler.sync.saveFailed', { error: result.error }), 'error');
      return;
    }
    const distinctRoles = new Set(targets.map((tgt) => tgt.role)).size;
    const msg =
      distinctRoles > 1
        ? t('scheduler.demand.posTargetsSavedMulti', { n: String(targets.length), roles: String(distinctRoles) })
        : t('scheduler.demand.posTargetsSaved', { n: String(targets.length) });
    showActionBanner(msg, 'success');
  }, [seedBaselineTargets, showActionBanner, t]);

  /**
   * Seeds the app with realistic sample data after tour completion.
   * Idempotent: only runs if no workers exist yet.
   * Creates 3 workers, 2 templates, and 4 shifts across the current + next week.
   */
  const seedTourData = useCallback(async () => {
    // Only into an account whose stored workers loaded and are empty: with a
    // failed or unfinished load, "no workers" is unknown (CHG-088).
    // A truncated list is not known to be empty either.
    if (!workersLoaded || workersError || workersTruncated || workers.length > 0) return;

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
        addShift({ date: dateOffset(1), workerId: w1Id, templateId: t1Id, location: '', status: 'Draft', notified: false }),
        addShift({ date: dateOffset(3), workerId: w1Id, templateId: t1Id, location: '', status: 'Published', notified: true }),
      );
    }
    if (w2Id && t2Id) {
      shiftPromises.push(
        addShift({ date: dateOffset(2), workerId: w2Id, templateId: t2Id, location: '', status: 'Draft', notified: false }),
        addShift({ date: dateOffset(5), workerId: w2Id, templateId: t2Id, location: '', status: 'Published', notified: true }),
      );
    }
    if (shiftPromises.length > 0) await Promise.all(shiftPromises);

    // Celebrate with confetti + banner
    if (!reduceMotionEnabled) {
      setPublishCelebration({ badgeVisible: false, confettiBurst: true });
    }
    showActionBanner(t('tour.completed.seedConfirmation'), 'success');
  }, [workersLoaded, workersError, workersTruncated, workers.length, addWorker, addShiftTemplate, addShift, reduceMotionEnabled, setPublishCelebration, showActionBanner, t]);

  // ── Return all state and handlers for the screen ──────────────────────────
  // A second tap while a save is still on its way would add the row twice
  // (each save mints a new id).
  const handleAddWorkerOnce = useSingleFlight(handleAddWorker);
  const handleAddTemplateOnce = useSingleFlight(handleAddTemplate);
  const handleAvailabilitySubmitOnce = useSingleFlight(handleAvailabilitySubmit);

  return {
    // Data
    workers,
    shiftTemplates,
    roster,
    demandTargets,
    workersLoaded,
    templatesLoaded,
    rosterLoaded,
    syncStatus,
    retrySync,
    lastSyncedAt,
    businessConstraints,
    handleConstraintsChange,
    handleImportPlaybookTemplate,
    accountId,
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
    baselineTargetsRef,

    // Active step of the page
    activeSection,
    goToSection,

    // UI state
    actionBanner,
    shiftRowNotice,
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
    handleAddWorker: handleAddWorkerOnce,
    handleAddTemplate: handleAddTemplateOnce,
    handleAvailabilitySubmit: handleAvailabilitySubmitOnce,
    handleShiftSubmit,
    handleTargetSubmit,
    handleFallbackSubmit,
    handlePublishShift,
    handleUnpublishShift,
    handleNotifyShift,
    handleRemoveWorker,
    workerRemoval,
    confirmWorkerRemoval,
    cancelWorkerRemoval,
    editingWorkerId,
    handleEditWorker,
    cancelWorkerEdit,
    editingTemplateId,
    handleEditTemplate,
    cancelTemplateEdit,
    handleRemoveAvailability,
    locations,
    selectedLocationId: autoAssignLocationId,
    selectLocation: setPickedLocationId,
    handleRemoveOverride,
    handleRemoveTemplate,
    handleRemoveShift,
    runForecast,
    handleAutoAssign,
    applyAutoAssign,
    dismissAutoAssign,
    handlePosTargetsGenerated,

    // Auto-assign state
    autoAssignSuggestions,
    autoAssignShortfalls,
    autoAssignApplying,

    // Usage / freemium
    canAutoAssign,
    usageCount,
    /** Bumped when the screen regains focus (not on mount): the plan banner reloads. */
    focusReloads,

    // Tour
    seedTourData,
  } as const;
}
