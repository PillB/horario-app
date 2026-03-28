import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Pressable,
} from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import ConfettiBurst from '@/components/ConfettiBurst';
import { useDemandForecast } from '@/hooks/useDemandForecast';
import { useWorkers } from '@/hooks/useWorkers';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';
import { useRoster } from '@/hooks/useRoster';
import { DemandForecast } from '@/services/demandForecast';
import { type DayOfWeek } from '@/services/rosterService';
import { computeUncoveredLoss, Shift, ShiftTemplate } from './schedulerMetrics';
import {
  OnboardingProgress,
  fetchOnboardingProgress,
  upsertOnboardingProgress,
} from '@/services/onboardingProgress';
import { WellnessPrompt } from '@/components/WellnessPrompt';
import { useSessionWellness } from '@/hooks/useSessionWellness';

const AvailabilityLabel = ({ day, from, to }: { day: string; from: string; to: string }) => (
  <View style={styles.badge}>
    <ThemedText style={styles.badgeText}>{day}</ThemedText>
    <ThemedText style={styles.mutedText}>
      {from} - {to}
    </ThemedText>
  </View>
);

const SectionCard = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <ThemedView style={styles.card}>
    <View style={styles.cardHeader}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {subtitle ? <ThemedText style={styles.mutedText}>{subtitle}</ThemedText> : null}
    </View>
    {children}
  </ThemedView>
);

const InputField = ({
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
}) => (
  <View style={styles.inputGroup}>
    <ThemedText style={styles.label}>{label}</ThemedText>
    <TextInput
      value={value}
      placeholder={placeholder}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      style={styles.input}
      placeholderTextColor="#9CA3AF"
    />
  </View>
);

const createChangeHandler = <T extends Record<string, string>>(
  setter: React.Dispatch<React.SetStateAction<T>>,
  onInteraction: () => void
) =>
  (key: keyof T) =>
  (value: string) => {
    onInteraction();
    setter((prev) => ({ ...prev, [key]: value }));
  };

type Availability = {
  day: string;
  from: string;
  to: string;
};

type Worker = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  availability: Availability[];
};

type OnboardingStep = {
  key: 'workers' | 'templates' | 'forecast';
  title: string;
  description: string;
  completed: boolean;
  actionLabel: string;
  onPress: () => void;
};

const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

const normalizeDay = (value: string) => {
  const lookup: Record<string, string> = {
    mon: 'Mon',
    monday: 'Mon',
    tue: 'Tue',
    tues: 'Tue',
    tuesday: 'Tue',
    wed: 'Wed',
    weds: 'Wed',
    wednesday: 'Wed',
    thu: 'Thu',
    thur: 'Thu',
    thurs: 'Thu',
    thursday: 'Thu',
    fri: 'Fri',
    friday: 'Fri',
    sat: 'Sat',
    saturday: 'Sat',
    sun: 'Sun',
    sunday: 'Sun',
  };

  const key = value.trim().toLowerCase();
  return lookup[key];
};

const isValidTime = (value: string) => {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const parseTimeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const defaultTimezoneOffsetMinutes = -new Date().getTimezoneOffset();

/** Returns an ISO-8601 date string (YYYY-MM-DD) offset by `days` from today. */
const isoDate = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const getWeekdayFromDate = (value: string, timezoneOffsetMinutes = defaultTimezoneOffsetMinutes) => {
  if (!isValidDate(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;

  const targetOffset = timezoneOffsetMinutes;
  const deviceOffset = -parsed.getTimezoneOffset();
  const offsetDelta = targetOffset - deviceOffset;
  const adjusted = new Date(parsed.getTime() + offsetDelta * 60 * 1000);

  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return labels[adjusted.getDay()];
};

const getTemplateWindow = (template: ShiftTemplate) => ({
  startMinutes: parseTimeToMinutes(template.start),
  endMinutes: parseTimeToMinutes(template.end),
});

const windowsOverlap = (
  first: { startMinutes: number; endMinutes: number },
  second: { startMinutes: number; endMinutes: number }
) => first.startMinutes < second.endMinutes && second.startMinutes < first.endMinutes;

const Checklist = ({ steps, progress }: { steps: OnboardingStep[]; progress: number }) => (
  <ThemedView style={styles.onboardingCard}>
    <View style={styles.rowBetween}>
      <View>
        <ThemedText type="subtitle">Get started fast</ThemedText>
        <ThemedText style={styles.mutedText}>Complete the essentials to unlock forecasting.</ThemedText>
      </View>
      <View style={styles.progressBadge}>
        <ThemedText style={styles.badgeText}>{Math.round(progress * 100)}%</ThemedText>
      </View>
    </View>
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 6)}%` }]} />
    </View>
    {steps.map((step, index) => (
      <Pressable
        key={step.key}
        onPress={step.onPress}
        style={[styles.rowBetween, styles.onboardingStep]}
        accessibilityRole="button"
        accessibilityLabel={`${step.title}${step.completed ? ' completed' : ''}`}
      >
        <View style={[styles.stepIndicator, step.completed && styles.stepIndicatorDone]}>
          <ThemedText style={styles.stepIndicatorText}>
            {step.completed ? '✓' : index + 1}
          </ThemedText>
        </View>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <ThemedText type="defaultSemiBold">{step.title}</ThemedText>
          <ThemedText style={styles.mutedText}>{step.description}</ThemedText>
        </View>
        <ThemedText style={styles.linkText}>{step.completed ? 'Done' : step.actionLabel}</ThemedText>
      </Pressable>
    ))}
  </ThemedView>
);

const validateShiftReadiness = (
  shift: Shift,
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
  workers: Worker[],
  timezoneOffsetMinutes = defaultTimezoneOffsetMinutes
) => {
  const errors: string[] = [];
  const template = shiftTemplates.find((candidate) => candidate.id === shift.templateId);
  const worker = workers.find((candidate) => candidate.id === shift.workerId);
  const weekdayLabel = getWeekdayFromDate(shift.date, timezoneOffsetMinutes);

  if (!template) {
    errors.push('Template is no longer available for this shift.');
  }

  if (!worker) {
    errors.push('Worker is no longer available for this shift.');
  }

  if (template && worker && worker.role !== template.role) {
    errors.push(`Worker role (${worker.role}) must match template role (${template.role}).`);
  }

  if (template && worker && weekdayLabel) {
    const { coveringSlot } = findCoveringAvailability(worker, template, shift.date, timezoneOffsetMinutes);
    if (!coveringSlot) {
      errors.push(
        `Worker availability on ${weekdayLabel} must cover the template window ${template.start} - ${template.end}.`
      );
    }
  }

  if (template && weekdayLabel) {
    const newWindow = getTemplateWindow(template);
    const overlappingShift = roster.find((existingShift) => {
      if (existingShift.id === shift.id) return false;
      if (existingShift.workerId !== shift.workerId || existingShift.date !== shift.date) return false;
      const existingTemplate = shiftTemplates.find((candidate) => candidate.id === existingShift.templateId);
      if (!existingTemplate) return false;
      const existingWindow = getTemplateWindow(existingTemplate);
      return windowsOverlap(existingWindow, newWindow);
    });

    if (overlappingShift) {
      const conflictingTemplate = shiftTemplates.find((candidate) => candidate.id === overlappingShift.templateId);
      errors.push(
        `Worker already has a shift on ${shift.date} from ${conflictingTemplate?.start ?? '??'} to ${
          conflictingTemplate?.end ?? '??'
        }. Adjust the time window to avoid overlaps.`
      );
    }
  }

  return { errors } as const;
};

const validateAvailabilitySubmission = (
  form: { workerId: string; day: string; from: string; to: string },
  workers: Worker[]
) => {
  const trimmedWorkerId = form.workerId.trim();
  const trimmedDay = form.day.trim();
  const trimmedFrom = form.from.trim();
  const trimmedTo = form.to.trim();

  const errors: string[] = [];
  const normalizedDay = normalizeDay(trimmedDay);

  if (!trimmedWorkerId) {
    errors.push('Worker is required.');
  }

  if (!trimmedDay) {
    errors.push('Day is required.');
  }

  if (!trimmedFrom || !trimmedTo) {
    errors.push('From and to times are required.');
  }

  if (trimmedWorkerId && !workers.some((worker) => worker.id === trimmedWorkerId)) {
    errors.push('Worker ID must match an existing worker.');
  }

  if (trimmedDay && !normalizedDay) {
    errors.push('Day must be one of Mon, Tue, Wed, Thu, Fri, Sat, or Sun.');
  }

  if (trimmedFrom && !isValidTime(trimmedFrom)) {
    errors.push('From time must use the 24-hour HH:MM format.');
  }

  if (trimmedTo && !isValidTime(trimmedTo)) {
    errors.push('To time must use the 24-hour HH:MM format.');
  }

  let fromMinutes: number | null = null;
  let toMinutes: number | null = null;

  if (trimmedFrom && trimmedTo && isValidTime(trimmedFrom) && isValidTime(trimmedTo)) {
    fromMinutes = parseTimeToMinutes(trimmedFrom);
    toMinutes = parseTimeToMinutes(trimmedTo);
    if (fromMinutes >= toMinutes) {
      errors.push('From time must be earlier than to time.');
    }
  }

  if (!errors.length) {
    const worker = workers.find((candidate) => candidate.id === trimmedWorkerId);
    const dayKey = normalizedDay ?? trimmedDay;
    let hasOverlap = false;
    if (worker && normalizedDay && fromMinutes !== null && toMinutes !== null) {
      const overlappingSlot = worker.availability.find((slot) => {
        if (slot.day !== normalizedDay) return false;
        const existingWindow = {
          startMinutes: parseTimeToMinutes(slot.from),
          endMinutes: parseTimeToMinutes(slot.to),
        };
        return windowsOverlap(existingWindow, { startMinutes: fromMinutes, endMinutes: toMinutes });
      });

      if (overlappingSlot) {
        hasOverlap = true;
        errors.push(
          `Availability overlaps with an existing interval on ${normalizedDay} from ${overlappingSlot.from} to ${overlappingSlot.to}.`
        );
      }
    }

    if (!hasOverlap && worker?.availability.some((slot) => slot.day === dayKey && slot.from === trimmedFrom && slot.to === trimmedTo)) {
      errors.push('This availability interval already exists for the worker.');
    }
  }

  return { errors, normalizedDay, trimmedWorkerId, trimmedFrom, trimmedTo };
};

const findCoveringAvailability = (
  worker: Worker,
  template: ShiftTemplate,
  date: string,
  timezoneOffsetMinutes = defaultTimezoneOffsetMinutes
) => {
  const weekdayLabel = getWeekdayFromDate(date, timezoneOffsetMinutes);
  if (!weekdayLabel) {
    return { coveringSlot: null, weekdayLabel: null } as const;
  }

  const templateWindow = getTemplateWindow(template);

  const coveringSlot = worker.availability.find((slot) => {
    if (slot.day !== weekdayLabel) return false;
    const availabilityWindow = {
      startMinutes: parseTimeToMinutes(slot.from),
      endMinutes: parseTimeToMinutes(slot.to),
    };
    return (
      availabilityWindow.startMinutes <= templateWindow.startMinutes &&
      availabilityWindow.endMinutes >= templateWindow.endMinutes
    );
  });

  return { coveringSlot, weekdayLabel } as const;
};

const LostRevenueSummary = ({
  baselineTargets,
  currentTargets,
  roster,
  shiftTemplates,
}: {
  baselineTargets: DemandForecast[];
  currentTargets: DemandForecast[];
  roster: Shift[];
  shiftTemplates: ShiftTemplate[];
}) => {
  const metrics = useMemo(() => {
    const baseline = computeUncoveredLoss(baselineTargets, roster, shiftTemplates);
    const current = computeUncoveredLoss(currentTargets, roster, shiftTemplates);
    const delta = baseline.loss - current.loss;
    const improvement = baseline.loss > 0 ? Math.max(0, delta / baseline.loss) : 0;

    return {
      baselineLoss: baseline.loss,
      currentLoss: current.loss,
      baselineGap: baseline.totalGap,
      currentGap: current.totalGap,
      delta,
      improvement,
    };
  }, [baselineTargets, currentTargets, roster, shiftTemplates]);

  if (!baselineTargets.length && !currentTargets.length) {
    return null;
  }

  const improvementPercent = `${Math.min(100, Math.max(0, metrics.improvement * 100)).toFixed(0)}%`;
  const deltaLabel = metrics.delta >= 0 ? `-${formatCurrency(metrics.delta)}` : `+${formatCurrency(Math.abs(metrics.delta))}`;

  return (
    <ThemedView style={styles.lossSummary}>
      <View style={styles.rowBetween}>
        <ThemedText type="defaultSemiBold">Lost revenue exposure</ThemedText>
        <View style={[styles.badge, metrics.delta >= 0 ? styles.positiveBadge : styles.badge]}>
          <ThemedText style={styles.badgeText}>{deltaLabel}</ThemedText>
        </View>
      </View>
      <ThemedText style={styles.mutedText}>
        Estimated revenue at risk from uncovered roles before vs. after forecasting.
      </ThemedText>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: improvementPercent }]} />
      </View>
      <View style={styles.rowBetween}>
        <View>
          <ThemedText style={styles.mutedText}>Before forecast</ThemedText>
          <ThemedText type="defaultSemiBold">{formatCurrency(metrics.baselineLoss)}</ThemedText>
          <ThemedText style={styles.mutedText}>Uncovered: {metrics.baselineGap}</ThemedText>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <ThemedText style={styles.mutedText}>After forecast</ThemedText>
          <ThemedText type="defaultSemiBold">{formatCurrency(metrics.currentLoss)}</ThemedText>
          <ThemedText style={styles.mutedText}>Uncovered: {metrics.currentGap}</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
};

export default function SchedulerScreen() {
  const {
    demandTargets,
    triggerForecast,
    overrideTarget,
    loading: forecastLoading,
    error: forecastError,
    forecasting,
    dataStatus,
    seedBaselineTargets,
  } = useDemandForecast();

  const accountId = process.env.EXPO_PUBLIC_ACCOUNT_ID ?? 'demo-account';
  const userId = process.env.EXPO_PUBLIC_USER_ID ?? 'local-user';

  const { workers, addAvailability } = useWorkers(accountId);
  const { shiftTemplates } = useShiftTemplates(accountId);
  const { roster, addShift, setShiftStatus, notifyShift } = useRoster(accountId);

  const [savedOnboardingProgress, setSavedOnboardingProgress] = useState<OnboardingProgress | null>(null);

  const [shiftError, setShiftError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [availabilitySuccessPromptVisible, setAvailabilitySuccessPromptVisible] = useState(false);
  const [actionBanner, setActionBanner] = useState<
    | {
        type: 'success' | 'error' | 'info';
        message: string;
      }
    | null
  >(null);
  const [publishCelebration, setPublishCelebration] = useState({
    badgeVisible: false,
    confettiBurst: false,
  });
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  const [availabilityForm, setAvailabilityForm] = useState({
    workerId: 'W-01',
    day: 'Fri',
    from: '09:00',
    to: '17:00',
  });

  const [shiftForm, setShiftForm] = useState({
    workerId: 'W-01',
    templateId: 'morning',
    date: isoDate(2),
  });

  const [targetForm, setTargetForm] = useState({
    date: isoDate(3),
    role: 'Support',
    required: '3',
    notes: 'Weekend backlog',
  });

  const [fallbackMode, setFallbackMode] = useState<'homogeneous' | 'manual'>('homogeneous');
  const [fallbackForm, setFallbackForm] = useState({
    role: 'Support',
    startDate: new Date().toISOString().slice(0, 10),
    days: '7',
    homogeneousDemand: '4',
    shiftsPerDay: '2',
    workersPerShift: '2',
    notes: 'Baseline targets without history',
  });
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  const { acknowledgeBreak, dismissPrompt, minutesActive, promptVisible, recordInteraction } =
    useSessionWellness();

  const [forecastPending, setForecastPending] = useState(false);
  const [forecastEditStarted, setForecastEditStarted] = useState(false);
  const forecastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineTargetsRef = useRef<DemandForecast[] | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const shiftSectionRef = useRef<View>(null);
  const workerSectionRef = useRef<View>(null);
  const templateSectionRef = useRef<View>(null);
  const demandSectionRef = useRef<View>(null);
  const [shiftSectionOffset, setShiftSectionOffset] = useState<number | null>(null);
  const [workerSectionOffset, setWorkerSectionOffset] = useState<number | null>(null);
  const [templateSectionOffset, setTemplateSectionOffset] = useState<number | null>(null);
  const [demandSectionOffset, setDemandSectionOffset] = useState<number | null>(null);
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const businessTimezoneOffsetMinutes = useMemo(() => defaultTimezoneOffsetMinutes, []);

  const updateAvailabilityField = useMemo(
    () => createChangeHandler(setAvailabilityForm, recordInteraction),
    [recordInteraction]
  );

  const updateShiftField = useMemo(() => createChangeHandler(setShiftForm, recordInteraction), [recordInteraction]);

  const updateFallbackField = useMemo(
    () => createChangeHandler(setFallbackForm, recordInteraction),
    [recordInteraction]
  );

  const updateTargetField = useCallback(
    (key: keyof typeof targetForm) => (value: string) => {
      recordInteraction();
      setForecastEditStarted(true);
      setTargetForm((prev) => ({ ...prev, [key]: value }));
    },
    [recordInteraction, setForecastEditStarted, setTargetForm]
  );

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotionEnabled);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionEnabled);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadOnboardingProgress = async () => {
      const progress = await fetchOnboardingProgress(accountId, userId);
      if (progress && isMounted) {
        setSavedOnboardingProgress(progress);
      }
    };

    loadOnboardingProgress();

    return () => {
      isMounted = false;
    };
  }, [accountId, userId]);

  const rosterLookup = useMemo(() => {
    const map = new Map<string, boolean>();
    roster.forEach((shift) => map.set(`${shift.workerId}::${shift.date}::${shift.templateId}`, true));
    return map;
  }, [roster]);

  const rosterByDate = useMemo(() => {
    return roster.reduce<Record<string, (Shift & { template?: ShiftTemplate; worker?: Worker })[]>>(
      (acc, shift) => {
        if (!acc[shift.date]) acc[shift.date] = [];
        const template = shiftTemplates.find((t) => t.id === shift.templateId);
        const worker = workers.find((w) => w.id === shift.workerId);
        acc[shift.date].push({ ...shift, template, worker });
        return acc;
      },
      {}
    );
  }, [roster, shiftTemplates, workers]);

  useEffect(() => {
    if (!publishCelebration.confettiBurst) return;
    const timer = setTimeout(() => {
      setPublishCelebration((prev) => ({ ...prev, confettiBurst: false }));
    }, 1600);
    return () => clearTimeout(timer);
  }, [publishCelebration.confettiBurst]);

  useEffect(() => {
    if (reduceMotionEnabled && publishCelebration.confettiBurst) {
      setPublishCelebration((prev) => ({ ...prev, confettiBurst: false }));
    }
  }, [publishCelebration.confettiBurst, reduceMotionEnabled]);

  useEffect(() => {
    if (roster.some((shift) => shift.status === 'Published')) return;
    setPublishCelebration((prev) =>
      prev.badgeVisible || prev.confettiBurst
        ? { badgeVisible: false, confettiBurst: false }
        : prev
    );
  }, [roster]);

  const upcomingShifts = useMemo(() => {
    return [...roster]
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
      .slice(0, 4);
  }, [roster, shiftTemplates, workers]);

  const staffingGaps = useMemo(() => {
    return demandTargets
      .map((target) => {
        const scheduled = roster.reduce((total, shift) => {
          const template = shiftTemplates.find((t) => t.id === shift.templateId);
          if (shift.date === target.date && template?.role === target.role) {
            return total + (template.coverage ?? 1);
          }

          return total;
        }, 0);
        return {
          ...target,
          scheduled,
          gap: target.required - scheduled,
        };
      })
      .filter((target) => target.gap > 0);
  }, [demandTargets, roster, shiftTemplates]);

  const handleAvailabilitySubmit = async () => {
    const { errors, normalizedDay, trimmedFrom, trimmedTo, trimmedWorkerId } = validateAvailabilitySubmission(
      availabilityForm,
      workers
    );

    if (errors.length > 0 || !normalizedDay) {
      setAvailabilityError(errors.join(' '));
      setAvailabilitySuccessPromptVisible(false);
      return;
    }

    setAvailabilityError(null);
    const result = await addAvailability(trimmedWorkerId, normalizedDay as DayOfWeek, trimmedFrom, trimmedTo);
    if (result.success) {
      setAvailabilitySuccessPromptVisible(true);
      setAvailabilityForm({ ...availabilityForm, day: '', from: '', to: '' });
    } else {
      setAvailabilityError(result.error ?? 'Failed to save availability. Please try again.');
    }
  };

  const handleShiftSubmit = async () => {
    const trimmedWorkerId = shiftForm.workerId.trim();
    const trimmedTemplateId = shiftForm.templateId.trim();
    const trimmedDate = shiftForm.date.trim();

    const errors: string[] = [];
    const template = shiftTemplates.find((candidate) => candidate.id === trimmedTemplateId);
    const worker = workers.find((candidate) => candidate.id === trimmedWorkerId);
    const { coveringSlot, weekdayLabel } =
      template && worker
        ? findCoveringAvailability(worker, template, trimmedDate, businessTimezoneOffsetMinutes)
        : { coveringSlot: null, weekdayLabel: getWeekdayFromDate(trimmedDate, businessTimezoneOffsetMinutes) };

    if (!trimmedWorkerId || !trimmedTemplateId || !trimmedDate) {
      errors.push('All fields are required.');
    }

    if (trimmedDate && !isValidDate(trimmedDate)) {
      errors.push('Date must use the YYYY-MM-DD format.');
    }

    if (trimmedWorkerId && !workers.some((worker) => worker.id === trimmedWorkerId)) {
      errors.push('Worker ID must match an existing worker.');
    }

    if (trimmedTemplateId && !shiftTemplates.some((template) => template.id === trimmedTemplateId)) {
      errors.push('Template ID must match an existing template.');
    }

    if (template && worker && worker.role !== template.role) {
      errors.push(
        `Worker role (${worker.role}) must match template role (${template.role}) before scheduling a shift.`
      );
    }

    const shiftKey = `${trimmedWorkerId}::${trimmedDate}::${trimmedTemplateId}`;
    if (rosterLookup.has(shiftKey)) {
      errors.push('This worker, date, and template combination is already scheduled.');
    }

    if (template && worker && weekdayLabel) {
      if (!coveringSlot) {
        errors.push(
          `Worker availability on ${weekdayLabel} must cover the template window ${template.start} - ${template.end}.`
        );
      }
    }

    if (template && weekdayLabel) {
      const newWindow = getTemplateWindow(template);
      const overlappingShift = roster.find((existingShift) => {
        if (existingShift.workerId !== trimmedWorkerId || existingShift.date !== trimmedDate) return false;
        const existingTemplate = shiftTemplates.find((candidate) => candidate.id === existingShift.templateId);
        if (!existingTemplate) return false;
        const existingWindow = getTemplateWindow(existingTemplate);
        return windowsOverlap(existingWindow, newWindow);
      });

      if (overlappingShift) {
        const conflictingTemplate = shiftTemplates.find((candidate) => candidate.id === overlappingShift.templateId);
        errors.push(
          `Worker already has a shift on ${trimmedDate} from ${conflictingTemplate?.start ?? '??'} to ${
            conflictingTemplate?.end ?? '??'
          }. Adjust the time window to avoid overlaps.`
        );
      }
    }

    if (errors.length > 0) {
      setShiftError(errors.join(' '));
      return;
    }

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
      setShiftForm({ ...shiftForm, date: '' });
    } else {
      setShiftError(result.error ?? 'Failed to save shift. Please try again.');
    }
  };

  const handleTargetSubmit = () => {
    const trimmedDate = targetForm.date.trim();
    const trimmedRole = targetForm.role.trim();
    const trimmedNotes = targetForm.notes.trim();
    const errors: string[] = [];

    if (!trimmedDate) {
      errors.push('Date is required.');
    } else if (!isValidDate(trimmedDate)) {
      errors.push('Date must use the YYYY-MM-DD format.');
    }

    if (!trimmedRole) {
      errors.push('Role is required.');
    }

    const requiredInput = targetForm.required.trim();
    const normalizedRequired = Number(requiredInput);
    if (requiredInput.length === 0 || Number.isNaN(normalizedRequired)) {
      errors.push('Required must be a valid number.');
    } else if (normalizedRequired < 0) {
      errors.push('Required must be greater than or equal to 0.');
    } else if (!Number.isInteger(normalizedRequired)) {
      errors.push('Required must be a whole number.');
    }

    if (errors.length > 0) {
      setTargetError(errors.join(' '));
      return;
    }

    setTargetError(null);

    const matchingForecast = demandTargets.find(
      (target) => target.date === trimmedDate && target.role.toLowerCase() === trimmedRole.toLowerCase()
    );

    const payload: DemandForecast = {
      date: trimmedDate,
      role: trimmedRole,
      required: normalizedRequired,
      notes: trimmedNotes,
      confidence: matchingForecast?.confidence,
      lowerBound: matchingForecast?.lowerBound,
      upperBound: matchingForecast?.upperBound,
      source: 'override',
    };

    overrideTarget(payload);
  };

  const buildDateSequence = useCallback((startDate: string, days: number) => {
    const sequence: string[] = [];
    const anchor = new Date(`${startDate}T00:00:00Z`);
    if (!Number.isFinite(anchor.getTime())) return sequence;

    for (let offset = 0; offset < days; offset += 1) {
      const next = new Date(anchor);
      next.setUTCDate(anchor.getUTCDate() + offset);
      sequence.push(next.toISOString().slice(0, 10));
    }

    return sequence;
  }, []);

  const handleFallbackSubmit = useCallback(async () => {
    const trimmedRole = fallbackForm.role.trim();
    const trimmedStart = fallbackForm.startDate.trim();
    const trimmedNotes = fallbackForm.notes.trim();

    setFallbackError(null);
    setFallbackMessage(null);

    if (!trimmedRole) {
      setFallbackError('Role is required to create baseline demand.');
      return;
    }

    if (!isValidDate(trimmedStart)) {
      setFallbackError('Start date must use the YYYY-MM-DD format.');
      return;
    }

    const normalizedDays = Number(fallbackForm.days);
    if (!Number.isFinite(normalizedDays) || normalizedDays <= 0 || !Number.isInteger(normalizedDays)) {
      setFallbackError('Days must be a positive whole number.');
      return;
    }

    const safeDays = Math.min(normalizedDays, 60);
    let required = 0;

    if (fallbackMode === 'homogeneous') {
      const normalized = Number(fallbackForm.homogeneousDemand);
      if (!Number.isFinite(normalized) || normalized <= 0) {
        setFallbackError('Enter a positive homogeneous demand.');
        return;
      }
      required = normalized;
    } else {
      const normalizedShifts = Number(fallbackForm.shiftsPerDay);
      const normalizedWorkers = Number(fallbackForm.workersPerShift);

      if (
        !Number.isFinite(normalizedShifts) ||
        normalizedShifts <= 0 ||
        !Number.isFinite(normalizedWorkers) ||
        normalizedWorkers <= 0
      ) {
        setFallbackError('Provide positive worker and shift counts.');
        return;
      }

      required = normalizedShifts * normalizedWorkers;
    }

    const sequence = buildDateSequence(trimmedStart, safeDays);
    if (!sequence.length) {
      setFallbackError('Unable to build a date range from the provided start date.');
      return;
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
      setFallbackMessage('Baseline demand targets saved. You can now publish coverage or refine forecasts.');
    } else {
      const message = result.error ?? 'Unable to save baseline targets. Please try again.';
      setFallbackMessage(null);
      setFallbackError(message);
      showActionBanner(message, 'error');
    }
  }, [
    buildDateSequence,
    fallbackForm.days,
    fallbackForm.homogeneousDemand,
    fallbackForm.notes,
    fallbackForm.role,
    fallbackForm.shiftsPerDay,
    fallbackForm.startDate,
    fallbackForm.workersPerShift,
    fallbackMode,
    showActionBanner,
    seedBaselineTargets,
  ]);

  const forecastDate = targetForm.date.trim();
  const forecastRole = targetForm.role.trim();
  const needsFallbackSetup = useMemo(
    () => !dataStatus.hasHistorical && !dataStatus.hasExternalSignals && !dataStatus.hasExistingTargets,
    [dataStatus.hasExistingTargets, dataStatus.hasExternalSignals, dataStatus.hasHistorical]
  );
  const isForecastInputValid = useMemo(
    () => isValidDate(forecastDate) && forecastRole.length > 0,
    [forecastDate, forecastRole]
  );
  const invalidForecastCopy = 'Enter a valid YYYY-MM-DD date and role to generate a forecast.';
  const forecastPendingCopy = 'Waiting for input to settle before forecasting…';
  const forecastPendingLabel = 'Waiting for edits…';
  const shiftSubmitLabel = 'Save and notify team';
  const forecastReadyLabel = "Run forecast with today’s signals";
  const forecastReadyHelperCopy = 'Ready to run forecast with today’s signals.';

  const showActionBanner = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      setActionBanner({ message, type });
      if (actionBannerTimerRef.current) {
        clearTimeout(actionBannerTimerRef.current);
      }
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

  const forecastBlockingReason = useMemo(() => {
    if (!isForecastInputValid) return 'Add date & role to forecast';
    if (forecastPending) return forecastPendingLabel;
    return null;
  }, [forecastPending, isForecastInputValid, forecastPendingLabel]);

  const forecastActionDisabled =
    !isForecastInputValid || forecasting || forecastLoading || forecastPending;

  const forecastButtonLabel = useMemo(() => {
    if (forecasting || forecastLoading) return 'Running…';
    return forecastBlockingReason ?? forecastReadyLabel;
  }, [forecastBlockingReason, forecastLoading, forecastReadyLabel, forecasting]);

  const forecastHelperText = useMemo(() => {
    if (!isForecastInputValid) return invalidForecastCopy;
    if (needsFallbackSetup)
      return 'No historical shifts or external signals found. Use quick setup to seed demand targets.';
    if (!dataStatus.apiAvailable)
      return 'Forecast API unavailable. Use quick setup or manual targets to proceed.';
    if (forecastPending) return forecastPendingCopy;
    if (forecastLoading || forecasting) return 'Running forecast...';
    return forecastReadyHelperCopy;
  }, [
    dataStatus.apiAvailable,
    forecastLoading,
    forecasting,
    forecastPending,
    forecastReadyHelperCopy,
    invalidForecastCopy,
    isForecastInputValid,
    needsFallbackSetup,
    forecastPendingCopy,
  ]);

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

  const scrollToSection = useCallback((offset: number | null) => {
    if (offset == null) return;
    scrollViewRef.current?.scrollTo({ y: Math.max(offset - 12, 0), animated: true });
  }, []);

  const scrollToShiftSection = useCallback(() => {
    scrollToSection(shiftSectionOffset);
  }, [scrollToSection, shiftSectionOffset]);

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

  const derivedOnboardingFlags = useMemo(
    () => ({
      workers: workers.length > 0,
      templates: shiftTemplates.length > 0,
      forecast: demandTargets.length > 0 || forecasting || forecastLoading,
    }),
    [demandTargets.length, forecastLoading, forecasting, shiftTemplates.length, workers.length]
  );

  const effectiveOnboardingFlags = useMemo(() => {
    const persisted = savedOnboardingProgress ?? { workers: false, templates: false, forecast: false };
    return {
      workers: persisted.workers || derivedOnboardingFlags.workers,
      templates: persisted.templates || derivedOnboardingFlags.templates,
      forecast: persisted.forecast || derivedOnboardingFlags.forecast,
    };
  }, [derivedOnboardingFlags, savedOnboardingProgress]);

  useEffect(() => {
    const persistProgress = async () => {
      const previous = savedOnboardingProgress ?? { workers: false, templates: false, forecast: false };
      const next: OnboardingProgress = { ...previous };

      (['workers', 'templates', 'forecast'] as const).forEach((key) => {
        if (derivedOnboardingFlags[key] && !previous[key]) {
          next[key] = true;
        }
      });

      const shouldPersist =
        next.workers !== previous.workers ||
        next.templates !== previous.templates ||
        next.forecast !== previous.forecast;

      if (!shouldPersist) return;

      const persisted = await upsertOnboardingProgress(accountId, next, userId);
      if (persisted) {
        setSavedOnboardingProgress(persisted);
      } else {
        setActionBanner({ message: 'Unable to save onboarding progress right now.', type: 'error' });
        if (actionBannerTimerRef.current) {
          clearTimeout(actionBannerTimerRef.current);
        }
        actionBannerTimerRef.current = setTimeout(() => {
          setActionBanner(null);
          actionBannerTimerRef.current = null;
        }, 4500);
      }
    };

    persistProgress();
  }, [accountId, derivedOnboardingFlags, savedOnboardingProgress, userId]);

  const onboardingSteps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'workers',
        title: 'Add workers',
        description: 'Create worker profiles and availability.',
        completed: effectiveOnboardingFlags.workers,
        actionLabel: 'Add workers',
        onPress: () => goToSection('workers'),
      },
      {
        key: 'templates',
        title: 'Save templates',
        description: 'Standardize common shifts with coverage.',
        completed: effectiveOnboardingFlags.templates,
        actionLabel: 'Add template',
        onPress: () => goToSection('templates'),
      },
      {
        key: 'forecast',
        title: 'Run forecast',
        description: 'Generate demand targets to compare coverage.',
        completed: effectiveOnboardingFlags.forecast,
        actionLabel: forecastLoading || forecasting ? 'Running…' : 'Run forecast',
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
    ]
  );

  const onboardingProgress = useMemo(() => {
    if (!onboardingSteps.length) return 0;
    const completed = onboardingSteps.filter((step) => step.completed).length;
    return completed / onboardingSteps.length;
  }, [onboardingSteps]);

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
    const matchingForecast = demandTargets.find(
      (target) => target.date === targetForm.date && target.role.toLowerCase() === targetForm.role.toLowerCase()
    );

    if (matchingForecast && `${matchingForecast.required}` !== targetForm.required) {
      setTargetForm((prev) => ({
        ...prev,
        required: `${matchingForecast.required}`,
        notes: prev.notes || matchingForecast.notes || '',
      }));
    }
  }, [demandTargets, targetForm.date, targetForm.role, targetForm.required, targetForm.notes]);

  useEffect(() => {
    if (!baselineTargetsRef.current && demandTargets.length) {
      baselineTargetsRef.current = demandTargets;
    }
  }, [demandTargets]);

  useEffect(() => {
    if (section === 'workers') {
      scrollToSection(workerSectionOffset);
      return;
    }

    if (section === 'templates') {
      scrollToSection(templateSectionOffset);
      return;
    }

    if (section === 'forecast') {
      scrollToSection(demandSectionOffset);
      return;
    }

    if (section === 'shifts') {
      scrollToShiftSection();
    }
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
      if (actionBannerTimerRef.current) {
        clearTimeout(actionBannerTimerRef.current);
        actionBannerTimerRef.current = null;
      }
    };
  }, []);

  const handlePublishShift = (shiftId: string) => {
    const shift = roster.find((candidate) => candidate.id === shiftId);
    if (!shift) return;

    const { errors } = validateShiftReadiness(
      shift,
      roster,
      shiftTemplates,
      workers,
      businessTimezoneOffsetMinutes
    );

    if (errors.length) {
      showActionBanner(errors.join(' '), 'error');
      return;
    }

    Alert.alert('Publish shift', 'Re-run validation and publish this roster entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Publish',
        onPress: async () => {
          const latestShift = roster.find((candidate) => candidate.id === shiftId);
          if (!latestShift) return;
          const validation = validateShiftReadiness(
            latestShift,
            roster,
            shiftTemplates,
            workers,
            businessTimezoneOffsetMinutes
          );
          if (validation.errors.length) {
            showActionBanner(validation.errors.join(' '), 'error');
            return;
          }

          const publishResult = await setShiftStatus(shiftId, 'Published');
          if (!publishResult.success) {
            showActionBanner(publishResult.error ?? 'Failed to publish shift.', 'error');
            return;
          }
          showActionBanner(
            `Published ${latestShift.workerId} for ${latestShift.date} (${latestShift.templateId}).`,
            'success'
          );
          celebrateRosterPublish();
        },
      },
    ]);
  };

  const handleUnpublishShift = async (shiftId: string) => {
    const shift = roster.find((candidate) => candidate.id === shiftId);
    if (!shift) return;
    if (shift.status === 'Draft') {
      showActionBanner('Shift is already in Draft.', 'info');
      return;
    }

    await setShiftStatus(shiftId, 'Draft');
    showActionBanner(`Unpublished ${shift.workerId} for ${shift.date}.`, 'info');
  };

  const handleNotifyShift = async (shiftId: string) => {
    const shift = roster.find((candidate) => candidate.id === shiftId);
    if (!shift) return;

    if (shift.status !== 'Published') {
      showActionBanner('Publish the shift before notifying workers.', 'info');
      return;
    }

    if (shift.notified) {
      showActionBanner('Notifications already sent for this shift.', 'info');
      return;
    }

    await notifyShift(shiftId);
    showActionBanner(`Sent notifications for ${shift.workerId} on ${shift.date}.`, 'success');
  };

  return (
    <ThemedView style={styles.screenContainer}>
      <ConfettiBurst running={publishCelebration.confettiBurst} disabled={reduceMotionEnabled} />
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
        <ThemedText type="title" style={styles.pageTitle}>
          Scheduler
        </ThemedText>
        <ThemedText style={styles.mutedText}>
          Coordinate coverage across workers, shift templates, and day-by-day staffing plans.
        </ThemedText>
        {actionBanner ? (
          <ThemedView
            style={[
              styles.banner,
              actionBanner.type === 'success' && styles.bannerSuccess,
              actionBanner.type === 'error' && styles.bannerError,
            ]}
          >
            <ThemedText style={styles.bannerText}>{actionBanner.message}</ThemedText>
          </ThemedView>
        ) : null}

        <Checklist steps={onboardingSteps} progress={onboardingProgress} />

        {needsFallbackSetup ? (
          <ThemedView style={[styles.banner, styles.bannerWarning, styles.dismissibleBanner]}>
            <View style={styles.bannerHeader}>
              <ThemedText style={styles.bannerText}>Missing data detected</ThemedText>
              <Pressable onPress={() => goToSection('forecast')}>
                <ThemedText style={styles.linkText}>Open quick setup</ThemedText>
              </Pressable>
            </View>
            <ThemedText style={styles.mutedText}>
              We could not find historical shifts or external signals. Seed homogeneous demand or manual
              worker/shift counts to unlock forecasting.
            </ThemedText>
          </ThemedView>
        ) : null}

        <View
          ref={workerSectionRef}
          onLayout={(event) => setWorkerSectionOffset(event.nativeEvent.layout.y)}
        >
          <SectionCard
            title="Worker management"
            subtitle="Track skills, role fit, and availability to place the right people in the right shifts."
          >
            {workers.map((worker) => (
              <View key={worker.id} style={styles.rowBetween}>
                <View style={styles.rowContent}>
                  <ThemedText type="defaultSemiBold">{worker.name}</ThemedText>
                  <ThemedText style={styles.mutedText}>{worker.role}</ThemedText>
                  <View style={styles.tagRow}>
                    {worker.skills.map((skill) => (
                      <View key={`${worker.id}-${skill}`} style={styles.tag}>
                        <ThemedText style={styles.badgeText}>{skill}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={styles.availabilityList}>
                  {worker.availability.map((slot, index) => (
                    <AvailabilityLabel key={`${worker.id}-${index}`} day={slot.day} from={slot.from} to={slot.to} />
                  ))}
                </View>
              </View>
            ))}
          </SectionCard>
        </View>

        <SectionCard
          title="Availability intake"
          subtitle="Capture recent changes before building rosters."
        >
        <InputField
          label="Worker"
          value={availabilityForm.workerId}
          placeholder="Worker ID"
          onChangeText={updateAvailabilityField('workerId')}
        />
        <View style={styles.inlineInputs}>
          <InputField
            label="Day"
            value={availabilityForm.day}
            placeholder="Mon"
            onChangeText={updateAvailabilityField('day')}
          />
          <InputField
            label="From"
            value={availabilityForm.from}
            placeholder="09:00"
            onChangeText={updateAvailabilityField('from')}
          />
          <InputField
            label="To"
            value={availabilityForm.to}
            placeholder="17:00"
            onChangeText={updateAvailabilityField('to')}
          />
        </View>
        <Pressable onPress={handleAvailabilitySubmit} style={styles.primaryButton}>
          <ThemedText style={styles.primaryButtonText}>Add availability</ThemedText>
        </Pressable>
        {availabilitySuccessPromptVisible ? (
          <ThemedView style={[styles.banner, styles.bannerSuccess, styles.dismissibleBanner]}>
            <View style={styles.bannerHeader}>
              <ThemedText style={styles.bannerText}>Availability saved.</ThemedText>
              <Pressable onPress={() => setAvailabilitySuccessPromptVisible(false)}>
                <ThemedText style={styles.dismissText}>Dismiss</ThemedText>
              </Pressable>
            </View>
            <ThemedText style={styles.mutedText}>Assign to a template now.</ThemedText>
            <Link href={{ pathname: '/(tabs)/scheduler', params: { section: 'shifts' } }} asChild>
              <Pressable
                onPress={() => {
                  scrollToShiftSection();
                  setAvailabilitySuccessPromptVisible(false);
                  router.setParams({ section: 'shifts' });
                }}
                style={[styles.secondaryButton, styles.tightButton]}
              >
                <ThemedText style={styles.primaryButtonText}>Assign to a template now</ThemedText>
              </Pressable>
            </Link>
          </ThemedView>
        ) : null}
        {availabilityError ? <ThemedText style={styles.errorText}>{availabilityError}</ThemedText> : null}
      </SectionCard>

      <View
        ref={templateSectionRef}
        onLayout={(event) => setTemplateSectionOffset(event.nativeEvent.layout.y)}
      >
        <SectionCard
          title="Shift templates"
          subtitle="Standardize start/end times and coverage expectations by role."
        >
          {shiftTemplates.map((template) => (
            <View key={template.id} style={styles.rowBetween}>
              <View>
                <ThemedText type="defaultSemiBold">{template.name}</ThemedText>
                <ThemedText style={styles.mutedText}>
                  {template.role} • {template.start} - {template.end}
                </ThemedText>
              </View>
              <ThemedText style={styles.badgeText}>{template.coverage} needed</ThemedText>
            </View>
          ))}
        </SectionCard>
      </View>

      <View
        ref={shiftSectionRef}
        onLayout={(event) => setShiftSectionOffset(event.nativeEvent.layout.y)}
      >
        <SectionCard title="Shift creation" subtitle="Assign workers into templates for specific dates.">
          <View style={styles.inlineInputs}>
            <InputField
              label="Worker"
              value={shiftForm.workerId}
              placeholder="W-01"
              onChangeText={updateShiftField('workerId')}
            />
            <InputField
              label="Template"
              value={shiftForm.templateId}
              placeholder="morning"
              onChangeText={updateShiftField('templateId')}
            />
          </View>
          <InputField
            label="Date"
            value={shiftForm.date}
            placeholder="2024-12-15"
            onChangeText={updateShiftField('date')}
          />
          <Pressable
            accessibilityLabel={shiftSubmitLabel}
            onPress={handleShiftSubmit}
            style={styles.primaryButton}
          >
            <ThemedText style={styles.primaryButtonText}>{shiftSubmitLabel}</ThemedText>
          </Pressable>
          {shiftError ? <ThemedText style={styles.errorText}>{shiftError}</ThemedText> : null}
        </SectionCard>
      </View>

      <View
        ref={demandSectionRef}
        onLayout={(event) => setDemandSectionOffset(event.nativeEvent.layout.y)}
      >
        <SectionCard title="Demand targets" subtitle="Define expected demand and staffing gaps by role.">
        <ThemedView style={styles.fallbackCard}>
          <View style={styles.rowBetween}>
            <ThemedText type="defaultSemiBold">Quick setup</ThemedText>
            <View style={[styles.badge, styles.fallbackBadge]}>
              <ThemedText style={styles.badgeText}>Fallback</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.mutedText}>
            Seed baseline demand when historical shifts or external signals are unavailable.
          </ThemedText>
          <View style={styles.inlineActions}>
            <Pressable
              onPress={() => setFallbackMode('homogeneous')}
              style={[styles.toggleChip, fallbackMode === 'homogeneous' && styles.toggleChipActive]}
            >
              <ThemedText style={[styles.toggleChipText, fallbackMode === 'homogeneous' && styles.toggleChipTextActive]}>
                Homogeneous demand
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setFallbackMode('manual')}
              style={[styles.toggleChip, fallbackMode === 'manual' && styles.toggleChipActive]}
            >
              <ThemedText style={[styles.toggleChipText, fallbackMode === 'manual' && styles.toggleChipTextActive]}>
                Manual worker/shift counts
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.inlineInputs}>
            <InputField
              label="Role"
              value={fallbackForm.role}
              placeholder="Support"
              onChangeText={updateFallbackField('role')}
            />
            <InputField
              label="Start date"
              value={fallbackForm.startDate}
              placeholder="2024-12-15"
              onChangeText={updateFallbackField('startDate')}
            />
          </View>
          <View style={styles.inlineInputs}>
            <InputField
              label="Days"
              value={fallbackForm.days}
              placeholder="7"
              keyboardType="numeric"
              onChangeText={updateFallbackField('days')}
            />
            {fallbackMode === 'homogeneous' ? (
              <InputField
                label="Daily demand"
                value={fallbackForm.homogeneousDemand}
                placeholder="4"
                keyboardType="numeric"
                onChangeText={updateFallbackField('homogeneousDemand')}
              />
            ) : (
              <View style={styles.inlineInputs}>
                <InputField
                  label="Shifts per day"
                  value={fallbackForm.shiftsPerDay}
                  placeholder="2"
                  keyboardType="numeric"
                  onChangeText={updateFallbackField('shiftsPerDay')}
                />
                <InputField
                  label="Workers per shift"
                  value={fallbackForm.workersPerShift}
                  placeholder="2"
                  keyboardType="numeric"
                  onChangeText={updateFallbackField('workersPerShift')}
                />
              </View>
            )}
          </View>
          <InputField
            label="Notes"
            value={fallbackForm.notes}
            placeholder="Baseline while we collect history"
            onChangeText={updateFallbackField('notes')}
          />
          <Pressable onPress={handleFallbackSubmit} style={[styles.secondaryButton, styles.tightButton]}>
            <ThemedText style={styles.primaryButtonText}>Save baseline targets</ThemedText>
          </Pressable>
          {fallbackError ? <ThemedText style={styles.errorText}>{fallbackError}</ThemedText> : null}
          {fallbackMessage ? <ThemedText style={styles.successText}>{fallbackMessage}</ThemedText> : null}
        </ThemedView>
        <View style={styles.inlineInputs}>
          <InputField
            label="Date"
            value={targetForm.date}
            placeholder="2024-12-15"
            onChangeText={updateTargetField('date')}
          />
          <InputField
            label="Role"
            value={targetForm.role}
            placeholder="Support"
            onChangeText={updateTargetField('role')}
          />
        </View>
        <View style={styles.inlineInputs}>
          <InputField
            label="Required"
            value={targetForm.required}
            placeholder="3"
            keyboardType="numeric"
            onChangeText={updateTargetField('required')}
          />
          <InputField
            label="Notes"
            value={targetForm.notes}
            placeholder="Backlog, promo, etc"
            onChangeText={updateTargetField('notes')}
          />
        </View>
        <Pressable onPress={handleTargetSubmit} style={styles.primaryButton}>
          <ThemedText style={styles.primaryButtonText}>Save target</ThemedText>
        </Pressable>
        {targetError ? <ThemedText style={styles.errorText}>{targetError}</ThemedText> : null}
        <View style={styles.inlineActions}>
          <Pressable
            accessibilityLabel={forecastButtonLabel}
            onPress={() => {
              if (forecastActionDisabled) return;
              runForecast();
            }}
            style={[
              styles.secondaryButton,
              styles.actionButton,
              forecastActionDisabled && styles.disabledButton,
            ]}
          >
            <ThemedText style={styles.primaryButtonText}>{forecastButtonLabel}</ThemedText>
          </Pressable>
          <ThemedText style={[styles.mutedText, styles.helperText]}>{forecastHelperText}</ThemedText>
        </View>
        <LostRevenueSummary
          baselineTargets={baselineTargetsRef.current ?? demandTargets}
          currentTargets={demandTargets}
          roster={roster}
          shiftTemplates={shiftTemplates}
        />
        <View style={styles.divider} />
        {forecastError ? <ThemedText style={styles.errorText}>{forecastError}</ThemedText> : null}
        {demandTargets.map((target) => (
          <View key={`${target.date}-${target.role}`} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">{target.role}</ThemedText>
              <ThemedText style={styles.mutedText}>{target.date}</ThemedText>
              {target.notes ? <ThemedText style={styles.mutedText}>{target.notes}</ThemedText> : null}
              {(target.lowerBound || target.upperBound || target.confidence) && (
                <ThemedText style={styles.mutedText}>
                  CI: {target.lowerBound ?? target.required} - {target.upperBound ?? target.required}
                  {target.confidence ? ` • ${(target.confidence * 100).toFixed(0)}% confidence` : ''}
                </ThemedText>
              )}
              <ThemedText style={styles.mutedText}>Source: {target.source ?? 'model'}</ThemedText>
            </View>
            <ThemedText style={styles.badgeText}>{target.required} needed</ThemedText>
          </View>
        ))}
        </SectionCard>
      </View>

      <SectionCard
        title="Calendar & roster"
        subtitle="Review what is published and where you have coverage gaps."
      >
        {publishCelebration.badgeVisible ? (
          <View style={[styles.badge, styles.positiveBadge, styles.securedBadge]}>
            <View style={styles.securedDot} />
            <ThemedText style={styles.badgeText}>Next 7 days secured.</ThemedText>
          </View>
        ) : null}
        {Object.entries(rosterByDate).map(([date, shifts]) => (
          <View key={date} style={styles.rosterDay}>
            <ThemedText type="defaultSemiBold">{date}</ThemedText>
            {shifts.map((shift) => (
              <View key={shift.id} style={styles.rosterRow}>
                <View style={styles.rowBetween}>
                  <ThemedText style={styles.badgeText}>{shift.template?.name ?? shift.templateId}</ThemedText>
                  <ThemedText
                    style={[
                      styles.status,
                      shift.status === 'Draft' ? styles.draftStatus : styles.publishedStatus,
                    ]}
                  >
                    {shift.status}
                  </ThemedText>
                </View>
                <ThemedText>
                  {shift.worker?.name ?? shift.workerId} • {shift.template?.start} - {shift.template?.end}
                </ThemedText>
                <View style={styles.rosterActions}>
                  <Pressable
                    onPress={() => handlePublishShift(shift.id)}
                    disabled={shift.status === 'Published'}
                    style={[
                      styles.actionChip,
                      shift.status === 'Published' && styles.disabledButton,
                      styles.actionChipPrimary,
                    ]}
                  >
                    <ThemedText style={styles.actionChipText}>Publish</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleUnpublishShift(shift.id)}
                    disabled={shift.status === 'Draft'}
                    style={[styles.actionChip, shift.status === 'Draft' && styles.disabledButton]}
                  >
                    <ThemedText style={styles.actionChipText}>Unpublish</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleNotifyShift(shift.id)}
                    disabled={shift.notified}
                    style={[styles.actionChip, shift.notified && styles.disabledButton]}
                  >
                    <ThemedText style={styles.actionChipText}>
                      {shift.notified ? 'Notified' : 'Notify'}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Upcoming shifts" subtitle="Stay ahead of the next roster window.">
        {upcomingShifts.map((shift) => (
          <View key={shift.id} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">{shift.worker?.name ?? shift.workerId}</ThemedText>
              <ThemedText style={styles.mutedText}>
                {shift.template?.name ?? shift.templateId} • {shift.template?.start} - {shift.template?.end}
              </ThemedText>
            </View>
            <View style={styles.statusPill}>
              <ThemedText style={styles.badgeText}>{shift.status}</ThemedText>
              <ThemedText style={styles.mutedText}>{shift.date}</ThemedText>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Staffing gaps" subtitle="Highlight under-covered roles across the horizon.">
        {staffingGaps.length === 0 ? (
          <ThemedText>Coverage meets current demand targets.</ThemedText>
        ) : (
          staffingGaps.map((gap) => (
            <View key={`${gap.date}-${gap.role}`} style={styles.rowBetween}>
              <View>
                <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
              </View>
              <View style={styles.statusPill}>
                <ThemedText style={styles.badgeText}>{gap.scheduled} scheduled</ThemedText>
                <ThemedText style={styles.mutedText}>Shortfall: {gap.gap}</ThemedText>
              </View>
            </View>
          ))
        )}
      </SectionCard>
      <WellnessPrompt
        visible={promptVisible}
        minutesActive={minutesActive}
        onDismiss={dismissPrompt}
        onTakeBreak={acknowledgeBreak}
      />
    </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    position: 'relative',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  pageTitle: {
    marginBottom: 4,
  },
  onboardingCard: {
    borderRadius: 12,
    padding: 14,
    gap: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  onboardingStep: {
    paddingVertical: 6,
  },
  stepIndicator: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  stepIndicatorDone: {
    backgroundColor: '#DCFCE7',
    borderColor: '#22C55E',
  },
  stepIndicatorText: {
    fontWeight: '700',
    color: '#0F172A',
  },
  progressBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  card: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#ffffff11',
    gap: 12,
  },
  cardHeader: {
    gap: 2,
  },
  mutedText: {
    color: '#9CA3AF',
  },
  banner: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  dismissibleBanner: {
    gap: 8,
  },
  bannerSuccess: {
    backgroundColor: '#ECFDF3',
    borderColor: '#BBF7D0',
  },
  bannerError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  bannerWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  bannerText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  bannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dismissText: {
    color: '#4B5563',
    fontWeight: '600',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowContent: {
    gap: 4,
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: '#eef2ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#e0f2fe',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  positiveBadge: {
    backgroundColor: '#dcfce7',
  },
  badgeText: {
    fontWeight: '700',
  },
  successText: {
    color: '#15803D',
  },
  linkText: {
    color: '#2563EB',
    fontWeight: '600',
  },
  securedBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securedDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#16a34a',
  },
  availabilityList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  inputGroup: {
    flex: 1,
    gap: 6,
  },
  label: {
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    color: '#111827',
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  fallbackCard: {
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#F8FAFC',
  },
  fallbackBadge: {
    backgroundColor: '#f3f4f6',
  },
  toggleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  toggleChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  toggleChipText: {
    color: '#111827',
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: '#ffffff',
  },
  actionButton: {
    flex: 1,
  },
  helperText: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  tightButton: {
    paddingVertical: 10,
  },
  disabledButton: {
    opacity: 0.6,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  lossSummary: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0b1224',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
  errorText: {
    color: '#DC2626',
  },
  rosterDay: {
    gap: 8,
  },
  rosterRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  status: {
    color: '#065f46',
    fontWeight: '600',
  },
  draftStatus: {
    color: '#92400e',
  },
  publishedStatus: {
    color: '#15803d',
  },
  rosterActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  actionChipPrimary: {
    backgroundColor: '#2563EB',
  },
  actionChipText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statusPill: {
    alignItems: 'flex-end',
    gap: 4,
  },
});

export { defaultTimezoneOffsetMinutes, findCoveringAvailability, getWeekdayFromDate };
export type { Availability, ShiftTemplate, Worker };
