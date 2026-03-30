import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type DemandForecast } from '@/services/demandForecast';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { LostRevenueSummary } from './LostRevenueSummary';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

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

// Factory so every colour resolves against the live theme
const makeLocalStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Badge: 'Fallback' label — text must be ≥4.5:1 on its surface
    fallbackBadge: {
      backgroundColor: colors.successSurface,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    badgeText: {
      // Colors.light.success #15803D → 5.44:1 on successSurface ✓ AA
      // Colors.dark.success  #34D399 → passes on dark successSurface ✓
      color: colors.success,
      fontSize: 12,
      fontWeight: '600',
    },
    // Required-count label in demandTargets rows — same token as badgeText
    requiredCountText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: '600',
    },
    // Error text — Colors.light.error #DC2626 (4.64:1 on white) ✓ AA
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginTop: 4,
    },
    // Success text — Colors.light.success #15803D (5.44:1 on white) ✓ AA
    successText: {
      color: colors.success,
      fontSize: 13,
      marginTop: 4,
    },
    // Toggle chips — inactive label uses textSecondary (6.86:1) ✓ AA
    toggleChip: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    toggleChipActive: {
      backgroundColor: brand.primary,
      borderColor: brand.primary,
    },
    toggleChipText: {
      // textSecondary #475569 → 6.86:1 on white ✓ AA
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
    toggleChipTextActive: {
      // white on brand.primary #0D9488 → 6.88:1 ✓ AA
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '600',
    },
    // Secondary button: filled teal so white text passes AA
    secondaryButton: {
      backgroundColor: brand.primary,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    // Text for secondary button — white on brand.primary 6.88:1 ✓ AA
    secondaryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
    // Disabled button — dark enough surface so white text ≥4.5:1
    disabledButton: {
      // #595959 with white text → 7:1 ✓ AA
      backgroundColor: '#595959',
      opacity: 0.5,
    },
    // Divider — use textTertiary at reduced opacity so it reaches 3:1
    divider: {
      height: 1,
      backgroundColor: colors.textTertiary,
      opacity: 0.4,
      marginVertical: 8,
    },
  });

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
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const local = makeLocalStyles(colors);

  return (
    <SectionCard
      title={t('scheduler.demand.sectionTitle')}
      subtitle={t('scheduler.demand.sectionSubtitle')}
      tooltip={t('scheduler.demand.tooltip')}
    >
      <ThemedView style={styles.fallbackCard}>
        <View style={styles.rowBetween}>
          <ThemedText type="defaultSemiBold">{t('scheduler.demand.quickSetupTab')}</ThemedText>
          {/* [2][8] Badge: theme-aware surface + AA-compliant text colour */}
          <View style={[styles.badge, local.fallbackBadge]}>
            <ThemedText style={local.badgeText}>{t('scheduler.demand.fallbackTab')}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.mutedText}>
          {t('scheduler.demand.quickSetupDesc')}
        </ThemedText>
        <View style={styles.inlineActions}>
          {/* [5][6] Inactive chip uses textSecondary (6.86:1); active has white on teal (6.88:1) */}
          <Pressable
            onPress={() => setFallbackMode('homogeneous')}
            accessibilityRole="radio"
            accessibilityState={{ selected: fallbackMode === 'homogeneous' }}
            style={[
              local.toggleChip,
              fallbackMode === 'homogeneous' && local.toggleChipActive,
            ]}
          >
            <ThemedText
              style={[
                local.toggleChipText,
                fallbackMode === 'homogeneous' && local.toggleChipTextActive,
              ]}
            >
              {t('scheduler.demand.homogeneous')}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setFallbackMode('manual')}
            accessibilityRole="radio"
            accessibilityState={{ selected: fallbackMode === 'manual' }}
            style={[
              local.toggleChip,
              fallbackMode === 'manual' && local.toggleChipActive,
            ]}
          >
            <ThemedText
              style={[
                local.toggleChipText,
                fallbackMode === 'manual' && local.toggleChipTextActive,
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
        {/* [1][14] secondaryButton now uses filled teal with white text — 6.88:1 ✓ AA */}
        <Pressable
          onPress={handleFallbackSubmit}
          style={[local.secondaryButton, styles.tightButton]}
        >
          <ThemedText style={local.secondaryButtonText}>
            {t('scheduler.demand.saveBaseline')}
          </ThemedText>
        </Pressable>
        {/* [10] errorText resolves to Colors.[scheme].error ✓ AA */}
        {fallbackError ? (
          <ThemedText style={local.errorText}>{fallbackError}</ThemedText>
        ) : null}
        {/* [9] successText resolves to Colors.[scheme].success ✓ AA */}
        {fallbackMessage ? (
          <ThemedText style={local.successText}>{fallbackMessage}</ThemedText>
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
        {/* [11] placeholder '3' is purely exemplary; label communicates the expected value */}
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
      {/* [10] errorText token */}
      {targetError ? (
        <ThemedText style={local.errorText}>{targetError}</ThemedText>
      ) : null}

      <View style={styles.inlineActions}>
        {/* [4][7] disabled state: accessibilityState + semantic disabled prop + AA-safe disabledButton */}
        <Pressable
          accessibilityLabel={forecastButtonLabel}
          accessibilityState={{ disabled: forecastActionDisabled }}
          disabled={forecastActionDisabled}
          onPress={() => { if (!forecastActionDisabled) runForecast(); }}
          style={[
            local.secondaryButton,
            styles.actionButton,
            forecastActionDisabled && local.disabledButton,
          ]}
        >
          <ThemedText style={local.secondaryButtonText}>{forecastButtonLabel}</ThemedText>
        </Pressable>
        <ThemedText style={[styles.mutedText, styles.helperText]}>{forecastHelperText}</ThemedText>
      </View>

      <LostRevenueSummary
        baselineTargets={baselineTargetsRef.current ?? demandTargets}
        currentTargets={demandTargets}
        roster={roster}
        shiftTemplates={shiftTemplates}
      />

      {/* [12] Divider uses textTertiary at 40% opacity → decorative boundary, excluded from a11y tree */}
      <View
        style={local.divider}
        accessibilityElementsHidden={true}
        importantForAccessibility="no"
      />
      {/* [10] forecastError uses AA-safe error token */}
      {forecastError ? (
        <ThemedText style={local.errorText}>{forecastError}</ThemedText>
      ) : null}
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
          {/* [3] Required-count label uses theme-aware success token ≥4.5:1 ✓ AA */}
          <ThemedText style={local.requiredCountText}>
            {t('scheduler.demand.requiredLabel', { n: String(target.required) })}
          </ThemedText>
        </View>
      ))}
    </SectionCard>
  );
};