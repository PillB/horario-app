import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type DemandForecast } from '@/services/demandForecast';
import { type Shift, type ShiftTemplate, computeUncoveredLoss } from '@/utils/schedulerMetrics';
import { formatCurrency } from '@/utils/schedulerUtils';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type Props = {
  baselineTargets: DemandForecast[];
  currentTargets: DemandForecast[];
  roster: Shift[];
  shiftTemplates: ShiftTemplate[];
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    positiveBadge: {
      backgroundColor: colors.success,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    negativeBadge: {
      backgroundColor: colors.errorSurface,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeTextPositive: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '600',
    },
    badgeTextNegative: {
      color: colors.error,
      fontSize: 13,
      fontWeight: '600',
    },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.border,
      overflow: 'hidden',
      marginVertical: 8,
    },
    progressFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: brand.primaryDark,
    },
    mutedText: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    columnRight: {
      alignItems: 'flex-end',
    },
  });

export const LostRevenueSummary = ({
  baselineTargets,
  currentTargets,
  roster,
  shiftTemplates,
}: Props) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const localStyles = makeStyles(colors);

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

  if (!baselineTargets.length && !currentTargets.length) return null;

  const improvementPercent = `${Math.min(100, Math.max(0, metrics.improvement * 100)).toFixed(0)}%`;
  const deltaLabel =
    metrics.delta >= 0
      ? `-${formatCurrency(metrics.delta)}`
      : `+${formatCurrency(Math.abs(metrics.delta))}`;

  const isPositive = metrics.delta >= 0;

  return (
    <ThemedView style={styles.lossSummary}>
      <View style={styles.rowBetween}>
        <ThemedText type="defaultSemiBold">Lost revenue exposure</ThemedText>
        <View style={[styles.badge, isPositive ? localStyles.positiveBadge : localStyles.negativeBadge]}>
          <ThemedText style={isPositive ? localStyles.badgeTextPositive : localStyles.badgeTextNegative}>
            {deltaLabel}
          </ThemedText>
        </View>
      </View>
      <ThemedText style={localStyles.mutedText}>
        Estimated revenue at risk from uncovered roles before vs. after forecasting.
      </ThemedText>
      <View style={localStyles.progressTrack}>
        <View style={[localStyles.progressFill, { width: improvementPercent as `${number}%` }]} />
      </View>
      <View style={styles.rowBetween}>
        <View>
          <ThemedText style={localStyles.mutedText}>Before forecast</ThemedText>
          <ThemedText type="defaultSemiBold">{formatCurrency(metrics.baselineLoss)}</ThemedText>
          <ThemedText style={localStyles.mutedText}>Uncovered: {metrics.baselineGap}</ThemedText>
        </View>
        <View style={localStyles.columnRight}>
          <ThemedText style={localStyles.mutedText}>After forecast</ThemedText>
          <ThemedText type="defaultSemiBold">{formatCurrency(metrics.currentLoss)}</ThemedText>
          <ThemedText style={localStyles.mutedText}>Uncovered: {metrics.currentGap}</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
};