import React, { useMemo } from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type DemandForecast } from '@/services/demandForecast';
import { type Shift, type ShiftTemplate, computeUncoveredLoss } from '@/app/(tabs)/schedulerMetrics';
import { formatCurrency } from '@/utils/schedulerUtils';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type Props = {
  baselineTargets: DemandForecast[];
  currentTargets: DemandForecast[];
  roster: Shift[];
  shiftTemplates: ShiftTemplate[];
};

export const LostRevenueSummary = ({
  baselineTargets,
  currentTargets,
  roster,
  shiftTemplates,
}: Props) => {
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
        <View style={[styles.progressFill, { width: improvementPercent as `${number}%` }]} />
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
