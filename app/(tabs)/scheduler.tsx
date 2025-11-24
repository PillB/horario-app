import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View, Pressable } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
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
};

export default function SchedulerScreen() {
  const { demandTargets, triggerForecast, overrideTarget, loading: forecastLoading, error: forecastError } =
    useDemandForecast();

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
    { id: 'shift-1', date: '2024-12-12', workerId: 'W-01', templateId: 'morning', location: 'HQ', status: 'Published' },
    { id: 'shift-2', date: '2024-12-12', workerId: 'W-02', templateId: 'evening', location: 'HQ', status: 'Draft' },
    { id: 'shift-3', date: '2024-12-13', workerId: 'W-02', templateId: 'weekend', location: 'Remote', status: 'Draft' },
  ]);

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

  const [allowForecastPrefill, setAllowForecastPrefill] = useState(true);

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
        const scheduled = roster.filter((shift) => {
          const template = shiftTemplates.find((t) => t.id === shift.templateId);
          return shift.date === target.date && template?.role === target.role;
        }).length;
        return {
          ...target,
          scheduled,
          gap: target.required - scheduled,
        };
      })
      .filter((target) => target.gap > 0);
  }, [demandTargets, roster, shiftTemplates]);

  const handleAvailabilitySubmit = () => {
    if (!availabilityForm.workerId || !availabilityForm.day) return;
    setWorkers((prev) =>
      prev.map((worker) =>
        worker.id === availabilityForm.workerId
          ? {
              ...worker,
              availability: [
                ...worker.availability,
                { day: availabilityForm.day, from: availabilityForm.from, to: availabilityForm.to },
              ],
            }
          : worker
      )
    );
    setAvailabilityForm({ ...availabilityForm, day: '', from: '', to: '' });
  };

  const handleShiftSubmit = () => {
    if (!shiftForm.workerId || !shiftForm.templateId || !shiftForm.date) return;
    setRoster((prev) => [
      ...prev,
      {
        id: `shift-${prev.length + 1}`,
        date: shiftForm.date,
        workerId: shiftForm.workerId,
        templateId: shiftForm.templateId,
        location: 'HQ',
        status: 'Draft',
      },
    ]);
    setShiftForm({ ...shiftForm, date: '' });
  };

  const handleTargetSubmit = () => {
    if (!targetForm.date || !targetForm.role) return;
    const normalizedRequired = Number(targetForm.required) || 0;
    const matchingForecast = demandTargets.find(
      (target) => target.date === targetForm.date && target.role.toLowerCase() === targetForm.role.toLowerCase()
    );

    const payload: DemandForecast = {
      date: targetForm.date,
      role: targetForm.role,
      required: normalizedRequired,
      notes: targetForm.notes,
      confidence: matchingForecast?.confidence,
      lowerBound: matchingForecast?.lowerBound,
      upperBound: matchingForecast?.upperBound,
      source: 'override',
    };

    overrideTarget(payload);
  };

  useEffect(() => {
    if (!targetForm.date || !targetForm.role) return;
    triggerForecast({ date: targetForm.date, role: targetForm.role });
  }, [targetForm.date, targetForm.role, triggerForecast]);

  useEffect(() => {
    if (!targetForm.date || !targetForm.role || !allowForecastPrefill) return;
    const matchingForecast = demandTargets.find(
      (target) => target.date === targetForm.date && target.role.toLowerCase() === targetForm.role.toLowerCase()
    );

    if (matchingForecast) {
      setTargetForm((prev) => {
        const nextRequired = `${matchingForecast.required}`;
        const nextNotes = prev.notes || matchingForecast.notes || '';

        if (prev.required === nextRequired && prev.notes === nextNotes) return prev;
        return {
          ...prev,
          required: nextRequired,
          notes: nextNotes,
        };
      });
    }
  }, [allowForecastPrefill, demandTargets, targetForm.date, targetForm.role]);

  useEffect(() => {
    setAllowForecastPrefill(true);
  }, [targetForm.date, targetForm.role]);

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
      </SectionCard>

      <SectionCard title="Demand targets" subtitle="Define expected demand and staffing gaps by role.">
        <View style={styles.inlineInputs}>
          <InputField
            label="Date"
            value={targetForm.date}
            placeholder="2024-12-15"
            onChangeText={(text) => setTargetForm({ ...targetForm, date: text })}
          />
          <InputField
            label="Role"
            value={targetForm.role}
            placeholder="Support"
            onChangeText={(text) => setTargetForm({ ...targetForm, role: text })}
          />
        </View>
        <View style={styles.inlineInputs}>
          <InputField
            label="Required"
            value={targetForm.required}
            placeholder="3"
            keyboardType="numeric"
            onChangeText={(text) => {
              setAllowForecastPrefill(false);
              setTargetForm({ ...targetForm, required: text });
            }}
          />
          <InputField
            label="Notes"
            value={targetForm.notes}
            placeholder="Backlog, promo, etc"
            onChangeText={(text) => {
              setAllowForecastPrefill(false);
              setTargetForm({ ...targetForm, notes: text });
            }}
          />
        </View>
        <Pressable onPress={handleTargetSubmit} style={styles.primaryButton}>
          <ThemedText style={styles.primaryButtonText}>Save target</ThemedText>
        </Pressable>
        <View style={styles.divider} />
        {forecastError ? <ThemedText style={styles.errorText}>{forecastError}</ThemedText> : null}
        {forecastLoading ? <ThemedText>Running forecast...</ThemedText> : null}
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
              <ThemedText style={styles.badgeText}>{gap.gap} open</ThemedText>
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
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
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
  statusPill: {
    alignItems: 'flex-end',
    gap: 4,
  },
});
