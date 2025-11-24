import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View, Pressable } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useDemandForecast } from '@/hooks/useDemandForecast';
import { DemandForecast } from '@/services/demandForecast';
import {
  AvailabilitySlot,
  Shift,
  Worker,
  loadSchedulerData,
  upsertAvailabilitySlot,
  upsertShift,
} from '@/services/schedulerStorage';

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

type ShiftTemplate = {
  id: string;
  name: string;
  role: string;
  start: string;
  end: string;
  coverage: number;
};

const defaultWorkers: Worker[] = [
  {
    id: 'W-01',
    name: 'Alex Johnson',
    role: 'Front Desk',
    skills: ['Check-in', 'Escalations'],
    availability: [
      { workerId: 'W-01', day: 'Mon', from: '08:00', to: '16:00' },
      { workerId: 'W-01', day: 'Wed', from: '10:00', to: '18:00' },
    ],
  },
  {
    id: 'W-02',
    name: 'Priya Singh',
    role: 'Support',
    skills: ['Chat', 'Bilingual'],
    availability: [
      { workerId: 'W-02', day: 'Tue', from: '09:00', to: '17:00' },
      { workerId: 'W-02', day: 'Thu', from: '12:00', to: '20:00' },
    ],
  },
];

const defaultRoster: Shift[] = [
  { id: 'shift-1', date: '2024-12-12', workerId: 'W-01', templateId: 'morning', location: 'HQ', status: 'Published' },
  { id: 'shift-2', date: '2024-12-12', workerId: 'W-02', templateId: 'evening', location: 'HQ', status: 'Draft' },
  { id: 'shift-3', date: '2024-12-13', workerId: 'W-02', templateId: 'weekend', location: 'Remote', status: 'Draft' },
];

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

export default function SchedulerScreen() {
  const {
    demandTargets,
    triggerForecast,
    overrideTarget,
    loading: forecastLoading,
    error: forecastError,
    forecasting,
  } = useDemandForecast();

  const [workers, setWorkers] = useState<Worker[]>([]);

  const [shiftTemplates] = useState<ShiftTemplate[]>([
    { id: 'morning', name: 'Morning Coverage', role: 'Front Desk', start: '08:00', end: '14:00', coverage: 2 },
    { id: 'evening', name: 'Evening Coverage', role: 'Support', start: '14:00', end: '22:00', coverage: 3 },
    { id: 'weekend', name: 'Weekend Ops', role: 'Support', start: '09:00', end: '17:00', coverage: 2 },
  ]);

  const [roster, setRoster] = useState<Shift[]>([]);

  const [shiftError, setShiftError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [hydrationStatus, setHydrationStatus] = useState<string | null>(null);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<string | null>(null);
  const [shiftStatus, setShiftStatus] = useState<string | null>(null);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);

  const [availabilityForm, setAvailabilityForm] = useState({
    workerId: '',
    day: '',
    from: '',
    to: '',
  });

  const [shiftForm, setShiftForm] = useState({
    workerId: '',
    templateId: 'morning',
    date: '',
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
  const businessTimezoneOffsetMinutes = useMemo(() => defaultTimezoneOffsetMinutes, []);

  const hydrateScheduler = useCallback(async () => {
    setHydrating(true);
    setHydrationStatus('Loading schedule…');
    try {
      const { workers: storedWorkers, shifts } = await loadSchedulerData();
      const hydratedWorkers = storedWorkers.length ? storedWorkers : defaultWorkers;
      const hydratedRoster = shifts.length ? shifts : storedWorkers.length ? [] : defaultRoster;

      setWorkers(hydratedWorkers);
      setRoster(hydratedRoster);
      setHydrationError(null);
      setHydrationStatus(
        storedWorkers.length ? 'Loaded from Supabase' : 'Using local defaults (no Supabase rows found).'
      );
    } catch (error) {
      console.warn('Unable to hydrate scheduler', error);
      setWorkers(defaultWorkers);
      setRoster(defaultRoster);
      setHydrationError('Unable to load scheduler data. Using local defaults.');
      setHydrationStatus(null);
    } finally {
      setHydrating(false);
    }
  }, []);

  useEffect(() => {
    hydrateScheduler();
  }, [hydrateScheduler]);

  useEffect(() => {
    if (workers.length && !availabilityForm.workerId) {
      setAvailabilityForm((prev) => ({ ...prev, workerId: prev.workerId || workers[0].id }));
    }

    if (workers.length && !shiftForm.workerId) {
      setShiftForm((prev) => ({ ...prev, workerId: prev.workerId || workers[0].id }));
    }
  }, [availabilityForm.workerId, shiftForm.workerId, workers]);

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
      setAvailabilityStatus(null);
      setAvailabilityError(errors.join(' '));
      return;
    }

    setAvailabilityStatus('Saving availability…');
    setAvailabilityError(null);
    const previousWorkers = workers;
    const updatedWorkers = workers.map((worker) =>
      worker.id === trimmedWorkerId
        ? {
            ...worker,
            availability: [
              ...worker.availability,
              { workerId: trimmedWorkerId, day: normalizedDay, from: trimmedFrom, to: trimmedTo },
            ],
          }
        : worker
    );
    setWorkers(updatedWorkers);
    setAvailabilityForm({ ...availabilityForm, day: '', from: '', to: '' });

    const result = await upsertAvailabilitySlot({
      workerId: trimmedWorkerId,
      day: normalizedDay,
      from: trimmedFrom,
      to: trimmedTo,
    });

    if (!result.success) {
      setWorkers(previousWorkers);
      setAvailabilityError(result.message ?? 'Unable to save availability.');
      setAvailabilityStatus(null);
      return;
    }

    setAvailabilityStatus(result.message ?? 'Availability saved');
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
      setShiftStatus(null);
      setShiftError(errors.join(' '));
      return;
    }

    setShiftStatus('Saving shift…');
    setShiftError(null);

    const newShift: Shift = {
      id: `shift-${roster.length + 1}`,
      date: trimmedDate,
      workerId: trimmedWorkerId,
      templateId: trimmedTemplateId,
      location: 'HQ',
      status: 'Draft',
    };

    const previousRoster = roster;
    setRoster([...roster, newShift]);
    setShiftForm({ ...shiftForm, date: '' });

    const result = await upsertShift(newShift);
    if (!result.success) {
      setRoster(previousRoster);
      setShiftError(result.message ?? 'Unable to save shift.');
      setShiftStatus(null);
      return;
    }

    setShiftStatus(result.message ?? 'Shift saved');
  };

  const handleTargetSubmit = async () => {
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
      setTargetStatus(null);
      setTargetError(errors.join(' '));
      return;
    }

    setTargetError(null);
    setTargetStatus('Saving target…');

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

    await overrideTarget(payload);
    setTargetStatus('Saved demand target');
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

  const forecastBlockingReason = useMemo(() => {
    if (!isForecastInputValid) return 'Add date & role to forecast';
    if (forecastPending) return forecastPendingLabel;
    return null;
  }, [forecastPending, isForecastInputValid, forecastPendingLabel]);

  const forecastActionDisabled =
    !isForecastInputValid || forecasting || forecastLoading || forecastPending;

  const forecastButtonLabel = useMemo(() => {
    if (forecasting || forecastLoading) return 'Running…';
    return forecastBlockingReason ?? 'Run forecast';
  }, [forecastBlockingReason, forecastLoading, forecasting]);

  const forecastHelperText = useMemo(() => {
    if (!isForecastInputValid) return invalidForecastCopy;
    if (forecastPending) return forecastPendingCopy;
    if (forecastLoading || forecasting) return 'Running forecast...';
    return 'Ready to run forecast.';
  }, [forecastLoading, forecasting, forecastPending, invalidForecastCopy, isForecastInputValid, forecastPendingCopy]);

  const runForecast = useCallback(() => {
    if (!isForecastInputValid || forecasting || forecastLoading) return;
    setForecastPending(false);
    triggerForecast({ date: forecastDate, role: forecastRole });
  }, [forecastDate, forecastRole, forecasting, forecastLoading, isForecastInputValid, triggerForecast]);

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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title" style={styles.pageTitle}>
        Scheduler
      </ThemedText>
      <ThemedText style={styles.mutedText}>
        Coordinate coverage across workers, shift templates, and day-by-day staffing plans.
      </ThemedText>

      <SectionCard
        title="Worker management"
        subtitle="Track skills, role fit, and availability to place the right people in the right shifts."
      >
        {hydrating ? <ThemedText style={styles.mutedText}>Loading from Supabase…</ThemedText> : null}
        {hydrationStatus ? <ThemedText style={styles.statusText}>{hydrationStatus}</ThemedText> : null}
        {hydrationError ? <ThemedText style={styles.errorText}>{hydrationError}</ThemedText> : null}
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
        {availabilityStatus ? <ThemedText style={styles.successText}>{availabilityStatus}</ThemedText> : null}
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
        <Pressable onPress={handleShiftSubmit} style={styles.primaryButton}>
          <ThemedText style={styles.primaryButtonText}>Schedule shift</ThemedText>
        </Pressable>
        {shiftStatus ? <ThemedText style={styles.successText}>{shiftStatus}</ThemedText> : null}
        {shiftError ? <ThemedText style={styles.errorText}>{shiftError}</ThemedText> : null}
      </SectionCard>

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
        {targetStatus ? <ThemedText style={styles.successText}>{targetStatus}</ThemedText> : null}
        {targetError ? <ThemedText style={styles.errorText}>{targetError}</ThemedText> : null}
        <View style={styles.inlineActions}>
          <Pressable
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
        {Object.entries(rosterByDate).map(([date, shifts]) => (
          <View key={date} style={styles.rosterDay}>
            <ThemedText type="defaultSemiBold">{date}</ThemedText>
            {shifts.map((shift) => (
              <View key={shift.id} style={styles.rosterRow}>
                <ThemedText style={styles.badgeText}>{shift.template?.name ?? shift.templateId}</ThemedText>
                <ThemedText>
                  {shift.worker?.name ?? shift.workerId} • {shift.template?.start} - {shift.template?.end}
                </ThemedText>
                <ThemedText style={styles.status}>{shift.status}</ThemedText>
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
  );
}

const styles = StyleSheet.create({
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
  badgeText: {
    fontWeight: '700',
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
  disabledButton: {
    opacity: 0.6,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  errorText: {
    color: '#DC2626',
  },
  successText: {
    color: '#059669',
  },
  statusText: {
    color: '#6B7280',
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
  statusPill: {
    alignItems: 'flex-end',
    gap: 4,
  },
});

export { defaultTimezoneOffsetMinutes, findCoveringAvailability, getWeekdayFromDate };
export type { AvailabilitySlot as Availability, ShiftTemplate, Worker };
