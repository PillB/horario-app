import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type DemandForecast } from '@/services/demandForecast';
import { type Shift, type ShiftTemplate } from '@/app/(tabs)/schedulerMetrics';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { LostRevenueSummary } from './LostRevenueSummary';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type FallbackFormState = {
  role: string;
  startDate: string;
  days: string;
  homogeneousDemand: string;
  shiftsPerDay: string;
  workersPerShift: string;
  notes: string;
};

type TargetFormState = {
  date: string;
  role: string;
  required: string;
  notes: string;
};

type Props = {
  fallbackMode: 'homogeneous' | 'manual';
  setFallbackMode: (mode: 'homogeneous' | 'manual') => void;
  fallbackForm: FallbackFormState;
  updateFallbackField: (key: keyof FallbackFormState) => (value: string) => void;
  handleFallbackSubmit: () => void;
  fallbackError: string | null;
  fallbackMessage: string | null;

  targetForm: TargetFormState;
  updateTargetField: (key: keyof TargetFormState) => (value: string) => void;
  handleTargetSubmit: () => void;
  targetError: string | null;

  forecastButtonLabel: string;
  forecastHelperText: string;
  forecastActionDisabled: boolean;
  runForecast: () => void;

  baselineTargetsRef: React.RefObject<DemandForecast[] | null>;
  demandTargets: DemandForecast[];
  roster: Shift[];
  shiftTemplates: ShiftTemplate[];
  forecastError: string | null;
};

export const DemandSection = ({
  fallbackMode,
  setFallbackMode,
  fallbackForm,
  updateFallbackField,
  handleFallbackSubmit,
  fallbackError,
  fallbackMessage,
  targetForm,
  updateTargetField,
  handleTargetSubmit,
  targetError,
  forecastButtonLabel,
  forecastHelperText,
  forecastActionDisabled,
  runForecast,
  baselineTargetsRef,
  demandTargets,
  roster,
  shiftTemplates,
  forecastError,
}: Props) => (
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
          <ThemedText
            style={[
              styles.toggleChipText,
              fallbackMode === 'homogeneous' && styles.toggleChipTextActive,
            ]}
          >
            Homogeneous demand
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setFallbackMode('manual')}
          style={[styles.toggleChip, fallbackMode === 'manual' && styles.toggleChipActive]}
        >
          <ThemedText
            style={[
              styles.toggleChipText,
              fallbackMode === 'manual' && styles.toggleChipTextActive,
            ]}
          >
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
      {fallbackMessage ? (
        <ThemedText style={styles.successText}>{fallbackMessage}</ThemedText>
      ) : null}
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
        onPress={() => { if (!forecastActionDisabled) runForecast(); }}
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
          {target.notes ? (
            <ThemedText style={styles.mutedText}>{target.notes}</ThemedText>
          ) : null}
          {(target.lowerBound || target.upperBound || target.confidence) ? (
            <ThemedText style={styles.mutedText}>
              CI: {target.lowerBound ?? target.required} -{' '}
              {target.upperBound ?? target.required}
              {target.confidence
                ? ` • ${(target.confidence * 100).toFixed(0)}% confidence`
                : ''}
            </ThemedText>
          ) : null}
          <ThemedText style={styles.mutedText}>Source: {target.source ?? 'model'}</ThemedText>
        </View>
        <ThemedText style={styles.badgeText}>{target.required} needed</ThemedText>
      </View>
    ))}
  </SectionCard>
);
