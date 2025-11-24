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
import { DemandForecast } from '@/services/demandForecast';

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

type ShiftTemplate = {
  id: string;
  name: string;
  role: string;
  start: string;
  end: string;
  coverage: number;
};

type Shift = {
  id: string;
  date: string;
  workerId: string;
  templateId: string;
  location: string;
  status: 'Draft' | 'Published';
  notified?: boolean;
};

const LOST_REVENUE_PER_UNCOVERED_ROLE = 325;

const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;

const persistShiftStatus = async (shiftId: string, status: Shift['status']) => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log(`Persisted shift ${shiftId} with status ${status}`);
};

const persistShiftNotification = async (shiftId: string) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  console.log(`Logged notification for shift ${shiftId}`);
};

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

const computeUncoveredLoss = (
  targets: DemandForecast[],
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
  lostRevenuePerUncoveredRole = LOST_REVENUE_PER_UNCOVERED_ROLE
) => {
  const coverageByDateRole = roster.reduce<Record<string, number>>((acc, shift) => {
    const template = shiftTemplates.find((candidate) => candidate.id === shift.templateId);
    if (!template) return acc;
    const key = `${shift.date}::${template.role}`;
    acc[key] = (acc[key] ?? 0) + (template.coverage ?? 1);
    return acc;
  }, {});

  return targets.reduce(
    (acc, target) => {
      const scheduled = coverageByDateRole[`${target.date}::${target.role}`] ?? 0;
      const gap = Math.max(0, target.required - scheduled);
      acc.totalGap += gap;
      acc.totalRequired += target.required;
      acc.loss += gap * lostRevenuePerUncoveredRole;
      return acc;
    },
    { loss: 0, totalGap: 0, totalRequired: 0 }
  );
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
  } = useDemandForecast();

  const [workers, setWorkers] = useState<Worker[]>([
    {
      id: 'W-01',
      name: 'Alex Johnson',
      role: 'Front Desk',
      skills: ['Check-in', 'Escalations'],
      availability: [
        { day: 'Mon', from: '08:00', to: '16:00' },
        { day: 'Wed', from: '10:00', to: '18:00' },
      ],
    },
    {
      id: 'W-02',
      name: 'Priya Singh',
      role: 'Support',
      skills: ['Chat', 'Bilingual'],
      availability: [
        { day: 'Tue', from: '09:00', to: '17:00' },
        { day: 'Thu', from: '12:00', to: '20:00' },
      ],
    },
  ]);

  const [shiftTemplates] = useState<ShiftTemplate[]>([
    { id: 'morning', name: 'Morning Coverage', role: 'Front Desk', start: '08:00', end: '14:00', coverage: 2 },
    { id: 'evening', name: 'Evening Coverage', role: 'Support', start: '14:00', end: '22:00', coverage: 3 },
    { id: 'weekend', name: 'Weekend Ops', role: 'Support', start: '09:00', end: '17:00', coverage: 2 },
  ]);

  const [roster, setRoster] = useState<Shift[]>([
    {
      id: 'shift-1',
      date: '2024-12-12',
      workerId: 'W-01',
      templateId: 'morning',
      location: 'HQ',
      status: 'Published',
      notified: false,
    },
    {
      id: 'shift-2',
      date: '2024-12-12',
      workerId: 'W-02',
      templateId: 'evening',
      location: 'HQ',
      status: 'Draft',
      notified: false,
    },
    {
      id: 'shift-3',
      date: '2024-12-13',
      workerId: 'W-02',
      templateId: 'weekend',
      location: 'Remote',
      status: 'Draft',
      notified: false,
    },
  ]);

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
    date: '2024-12-14',
  });

  const [targetForm, setTargetForm] = useState({
    date: '2024-12-15',
    role: 'Support',
    required: '3',
    notes: 'Weekend backlog',
  });

  const [forecastPending, setForecastPending] = useState(false);
  const [forecastEditStarted, setForecastEditStarted] = useState(false);
  const forecastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineTargetsRef = useRef<DemandForecast[] | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const shiftSectionRef = useRef<View>(null);
  const [shiftSectionOffset, setShiftSectionOffset] = useState<number | null>(null);
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const businessTimezoneOffsetMinutes = useMemo(() => defaultTimezoneOffsetMinutes, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotionEnabled);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionEnabled);
    return () => subscription.remove();
  }, []);

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
    setPublishCelebration({ badgeVisible: false, confettiBurst: false });
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

  const handleAvailabilitySubmit = () => {
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
    setAvailabilitySuccessPromptVisible(true);
    setWorkers((prev) =>
      prev.map((worker) =>
        worker.id === trimmedWorkerId
          ? {
              ...worker,
              availability: [...worker.availability, { day: normalizedDay, from: trimmedFrom, to: trimmedTo }],
            }
          : worker
      )
    );
    setAvailabilityForm({ ...availabilityForm, day: '', from: '', to: '' });
  };

  const handleShiftSubmit = () => {
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
    setRoster((prev) => [
      ...prev,
      {
        id: `shift-${prev.length + 1}`,
        date: trimmedDate,
        workerId: trimmedWorkerId,
        templateId: trimmedTemplateId,
        location: 'HQ',
        status: 'Draft',
      },
    ]);
    setShiftForm({ ...shiftForm, date: '' });
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

  const forecastDate = targetForm.date.trim();
  const forecastRole = targetForm.role.trim();
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
    if (forecastPending) return forecastPendingCopy;
    if (forecastLoading || forecasting) return 'Running forecast...';
    return forecastReadyHelperCopy;
  }, [
    forecastLoading,
    forecasting,
    forecastPending,
    forecastReadyHelperCopy,
    invalidForecastCopy,
    isForecastInputValid,
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

  const scrollToShiftSection = useCallback(() => {
    if (shiftSectionOffset == null) return;
    scrollViewRef.current?.scrollTo({ y: Math.max(shiftSectionOffset - 12, 0), animated: true });
  }, [shiftSectionOffset]);

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
    if (section === 'shifts' && shiftSectionOffset != null) {
      scrollToShiftSection();
    }
  }, [scrollToShiftSection, section, shiftSectionOffset]);

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

          setRoster((prev) =>
            prev.map((candidate) =>
              candidate.id === shiftId ? { ...candidate, status: 'Published', notified: false } : candidate
            )
          );
          await persistShiftStatus(shiftId, 'Published');
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

    setRoster((prev) =>
      prev.map((candidate) => (candidate.id === shiftId ? { ...candidate, status: 'Draft', notified: false } : candidate))
    );
    await persistShiftStatus(shiftId, 'Draft');
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

    setRoster((prev) => prev.map((candidate) => (candidate.id === shiftId ? { ...candidate, notified: true } : candidate)));
    await persistShiftNotification(shiftId);
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

        <SectionCard
          title="Availability intake"
          subtitle="Capture recent changes before building rosters."
        >
        <InputField
          label="Worker"
          value={availabilityForm.workerId}
          placeholder="Worker ID"
          onChangeText={(text) => setAvailabilityForm({ ...availabilityForm, workerId: text })}
        />
        <View style={styles.inlineInputs}>
          <InputField
            label="Day"
            value={availabilityForm.day}
            placeholder="Mon"
            onChangeText={(text) => setAvailabilityForm({ ...availabilityForm, day: text })}
          />
          <InputField
            label="From"
            value={availabilityForm.from}
            placeholder="09:00"
            onChangeText={(text) => setAvailabilityForm({ ...availabilityForm, from: text })}
          />
          <InputField
            label="To"
            value={availabilityForm.to}
            placeholder="17:00"
            onChangeText={(text) => setAvailabilityForm({ ...availabilityForm, to: text })}
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
              onChangeText={(text) => setShiftForm({ ...shiftForm, workerId: text })}
            />
            <InputField
              label="Template"
              value={shiftForm.templateId}
              placeholder="morning"
              onChangeText={(text) => setShiftForm({ ...shiftForm, templateId: text })}
            />
          </View>
          <InputField
            label="Date"
            value={shiftForm.date}
            placeholder="2024-12-15"
            onChangeText={(text) => setShiftForm({ ...shiftForm, date: text })}
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

      <SectionCard title="Demand targets" subtitle="Define expected demand and staffing gaps by role.">
        <View style={styles.inlineInputs}>
          <InputField
            label="Date"
            value={targetForm.date}
            placeholder="2024-12-15"
            onChangeText={(text) => {
              setForecastEditStarted(true);
              setTargetForm((prev) => ({ ...prev, date: text }));
            }}
          />
          <InputField
            label="Role"
            value={targetForm.role}
            placeholder="Support"
            onChangeText={(text) => {
              setForecastEditStarted(true);
              setTargetForm((prev) => ({ ...prev, role: text }));
            }}
          />
        </View>
        <View style={styles.inlineInputs}>
          <InputField
            label="Required"
            value={targetForm.required}
            placeholder="3"
            keyboardType="numeric"
            onChangeText={(text) => setTargetForm({ ...targetForm, required: text })}
          />
          <InputField
            label="Notes"
            value={targetForm.notes}
            placeholder="Backlog, promo, etc"
            onChangeText={(text) => setTargetForm({ ...targetForm, notes: text })}
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
