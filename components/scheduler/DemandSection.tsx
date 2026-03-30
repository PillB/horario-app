import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type DemandForecast } from '@/services/demandForecast';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { LostRevenueSummary } from './LostRevenueSummary';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';

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
}: Props) => {
  const { t } = useT();
  return (
    <SectionCard
      title={t('scheduler.demand.sectionTitle')}
      subtitle={t('scheduler.demand.sectionSubtitle')}
      tooltip={t('scheduler.demand.tooltip')}
    >
      <ThemedView style={styles.fallbackCard}>
        <View style={styles.rowBetween}>
          <ThemedText type="defaultSemiBold">{t('scheduler.demand.quickSetupTab')}</ThemedText>
          <View style={[styles.badge, styles.fallbackBadge]}>
            <ThemedText style={styles.badgeText}>{t('scheduler.demand.fallbackTab')}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.mutedText}>
          {t('scheduler.demand.quickSetupDesc')}
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
              {t('scheduler.demand.homogeneous')}
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
              {t('scheduler.demand.manualCounts')}
            </ThemedText>
          </Pressable>
        </View>
        <View style={styles.inlineInputs}>
          <InputField
            label={t('scheduler.demand.roleLabel')}
            value={fallbackForm.role}
            placeholder={t('scheduler.demand.rolePlaceholder')}
            onChangeText={updateFallbackField('role')}
          />
          <InputField
            label={t('scheduler.demand.startDateLabel')}
            value={fallbackForm.startDate}
            placeholder={t('scheduler.demand.startDatePlaceholder')}
            onChangeText={updateFallbackField('startDate')}
          />
        </View>
        <View style={styles.inlineInputs}>
          <InputField
            label={t('scheduler.demand.daysLabel')}
            value={fallbackForm.days}
            placeholder={t('scheduler.demand.daysCoverage')}
            keyboardType="numeric"
            onChangeText={updateFallbackField('days')}
          />
          {fallbackMode === 'homogeneous' ? (
            <InputField
              label={t('scheduler.demand.dailyDemandLabel')}
              value={fallbackForm.homogeneousDemand}
              placeholder="4"
              keyboardType="numeric"
              onChangeText={updateFallbackField('homogeneousDemand')}
            />
          ) : (
            <View style={styles.inlineInputs}>
              <InputField
                label={t('scheduler.demand.shiftsPerDayLabel')}
                value={fallbackForm.shiftsPerDay}
                placeholder="2"
                keyboardType="numeric"
                onChangeText={updateFallbackField('shiftsPerDay')}
              />
              <InputField
                label={t('scheduler.demand.workersPerShiftLabel')}
                value={fallbackForm.workersPerShift}
                placeholder="2"
                keyboardType="numeric"
                onChangeText={updateFallbackField('workersPerShift')}
              />
            </View>
          )}
        </View>
        <InputField
          label={t('scheduler.demand.notesLabel')}
          value={fallbackForm.notes}
          placeholder={t('scheduler.demand.notesPlaceholder')}
          onChangeText={updateFallbackField('notes')}
        />
        <Pressable onPress={handleFallbackSubmit} style={[styles.secondaryButton, styles.tightButton]}>
          <ThemedText style={styles.primaryButtonText}>{t('scheduler.demand.saveBaseline')}</ThemedText>
        </Pressable>
        {fallbackError ? <ThemedText style={styles.errorText}>{fallbackError}</ThemedText> : null}
        {fallbackMessage ? (
          <ThemedText style={styles.successText}>{fallbackMessage}</ThemedText>
        ) : null}
      </ThemedView>

      <View style={styles.inlineInputs}>
        <InputField
          label={t('scheduler.demand.dateLabel')}
          value={targetForm.date}
          placeholder={t('scheduler.demand.datePlaceholder')}
          onChangeText={updateTargetField('date')}
        />
        <InputField
          label={t('scheduler.demand.roleLabel')}
          value={targetForm.role}
          placeholder={t('scheduler.demand.rolePlaceholder')}
          onChangeText={updateTargetField('role')}
        />
      </View>
      <View style={styles.inlineInputs}>
        <InputField
          label={t('common.required')}
          value={targetForm.required}
          placeholder="3"
          keyboardType="numeric"
          onChangeText={updateTargetField('required')}
        />
        <InputField
          label={t('scheduler.demand.notesLabel')}
          value={targetForm.notes}
          placeholder={t('scheduler.demand.targetNotesPlaceholder')}
          onChangeText={updateTargetField('notes')}
        />
      </View>
      <Pressable onPress={handleTargetSubmit} style={styles.primaryButton}>
        <ThemedText style={styles.primaryButtonText}>{t('scheduler.demand.saveTarget')}</ThemedText>
      </Pressable>
      {targetError ? <ThemedText style={styles.errorText}>{targetError}</ThemedText> : null}
      {!targetError && forecastError ? <ThemedText style={styles.errorText}>{forecastError}</ThemedText> : null}

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
                {t('scheduler.demand.ci', {
                  low: String(target.lowerBound ?? target.required),
                  high: String(target.upperBound ?? target.required),
                })}
                {target.confidence
                  ? ` • ${t('scheduler.demand.confidence', { pct: (target.confidence * 100).toFixed(0) })}`
                  : ''}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.mutedText}>
              {t('scheduler.demand.source', { src: target.source ?? 'model' })}
            </ThemedText>
          </View>
          <ThemedText style={styles.badgeText}>
            {t('scheduler.demand.requiredLabel', { n: String(target.required) })}
          </ThemedText>
        </View>
      ))}
    </SectionCard>
  );
};
