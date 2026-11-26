/**
 * InsightsPanel — recommendations, capacity outlook and demand summary on the
 * Analytics screen.
 *
 * Everything comes from stored data: `useLeaderInsights` (capacity gaps,
 * workload and coverage insights from the roster, workers and demand targets)
 * and `useDemandAnalysis` (this week's demand targets against last week's and
 * against the published roster). A section with nothing to say is not shown.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { SkeletonCard } from '@/components/SkeletonCard';
import { Colors, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useCapacityForecast } from '@/hooks/useCapacityForecast';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDemandAnalysis } from '@/hooks/useDemandAnalysis';
import { useLeaderInsights } from '@/hooks/useLeaderInsights';

const MAX_ROWS = 5;

/**
 * `reloadSignal`: each change after mount reloads every source in place; what
 * is shown stays until the new answers (the skeleton is for the first load
 * only). The parent keys the panel by tenant, so a new tenant starts over.
 */
type Props = { accountId: string; reloadSignal?: number };

export function InsightsPanel({ accountId, reloadSignal }: Props) {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  const { tactical, strategic, loading: insightsLoading, error: insightsError } = useLeaderInsights(reloadSignal);
  const { gaps, burnoutRisks, loading: capacityLoading, error: capacityError } = useCapacityForecast(accountId, reloadSignal);
  const { weeklyDemandSummary, demandVsPrior, forecastAccuracy, loading: demandLoading, error: demandError } =
    useDemandAnalysis(undefined, reloadSignal);
  const loadError = insightsError ?? capacityError ?? demandError;
  const anyLoading = insightsLoading || capacityLoading || demandLoading;
  // Set once every source has answered: from then on a reload keeps the panel.
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  useEffect(() => {
    if (!anyLoading) setFirstLoadDone(true);
  }, [anyLoading]);

  if (anyLoading && !firstLoadDone) {
    return (
      <ThemedView style={styles.card} testID="insights-loading">
        <SkeletonCard rows={3} />
      </ThemedView>
    );
  }

  // A failed load is said, not shown as "nothing needs attention" (CHG-109).
  if (loadError) {
    return (
      <ThemedView style={styles.card} testID="insights-error">
        <ThemedText type="subtitle">{t('analytics.insights.actionsTitle')}</ThemedText>
        <ThemedText style={styles.bad} accessibilityRole="alert">
          {t('analytics.insights.loadError', { error: loadError })}
        </ThemedText>
      </ThemedView>
    );
  }

  const openGaps = gaps.filter((gap) => gap.risk !== 'ok').slice(0, MAX_ROWS);
  const workload = burnoutRisks.filter((risk) => risk.risk !== 'low').slice(0, MAX_ROWS);
  const changes = demandVsPrior.filter((row) => row.changePct !== 0).slice(0, MAX_ROWS);
  const accuracy = forecastAccuracy.slice(0, MAX_ROWS);

  return (
    <View style={styles.stack} testID="insights-panel">
      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">{t('analytics.insights.actionsTitle')}</ThemedText>
        {tactical.length === 0 ? (
          <ThemedText style={styles.muted}>{t('analytics.insights.actionsEmpty')}</ThemedText>
        ) : (
          tactical.slice(0, MAX_ROWS).map((rec) => (
            <View key={rec.id} style={styles.row} testID={`insight-${rec.id}`}>
              <ThemedText type="defaultSemiBold">{rec.title}</ThemedText>
              <ThemedText style={styles.muted}>{rec.description}</ThemedText>
              <ThemedText style={styles.action}>{rec.action}</ThemedText>
            </View>
          ))
        )}
      </ThemedView>

      {strategic.length > 0 ? (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">{t('analytics.insights.strategicTitle')}</ThemedText>
          {strategic.slice(0, MAX_ROWS).map((rec) => (
            <View key={rec.id} style={styles.row}>
              <ThemedText type="defaultSemiBold">{rec.title}</ThemedText>
              <ThemedText style={styles.muted}>{rec.insight}</ThemedText>
              <ThemedText style={styles.muted}>{rec.evidence}</ThemedText>
              <ThemedText style={styles.action}>{rec.recommendedAction}</ThemedText>
            </View>
          ))}
        </ThemedView>
      ) : null}

      {openGaps.length > 0 || workload.length > 0 ? (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">{t('analytics.insights.capacityTitle')}</ThemedText>
          {openGaps.map((gap) => (
            <View key={`${gap.date}::${gap.role}`} style={styles.rowBetween}>
              <View style={styles.rowText}>
                <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                <ThemedText style={styles.muted}>{gap.date}</ThemedText>
              </View>
              <ThemedText style={gap.risk === 'critical' ? styles.bad : styles.warn}>
                {t('analytics.insights.gapRow', { available: String(gap.available), required: String(gap.required) })}
              </ThemedText>
            </View>
          ))}
          {workload.map((risk) => (
            <View key={risk.workerId} style={styles.rowBetween}>
              <View style={styles.rowText}>
                <ThemedText type="defaultSemiBold">{risk.workerName}</ThemedText>
                <ThemedText style={styles.muted}>
                  {t('analytics.insights.workloadRow', { hours: String(Math.round(risk.assignedHours)) })}
                </ThemedText>
              </View>
              <ThemedText style={risk.risk === 'high' ? styles.bad : styles.warn}>
                {`${Math.round(risk.utilizationPct)}%`}
              </ThemedText>
            </View>
          ))}
        </ThemedView>
      ) : null}

      {weeklyDemandSummary.length > 0 ? (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">{t('analytics.insights.demandTitle')}</ThemedText>
          {weeklyDemandSummary.slice(0, MAX_ROWS).map((row) => (
            <View key={row.role} style={styles.rowBetween}>
              <View style={styles.rowText}>
                <ThemedText type="defaultSemiBold">{row.role}</ThemedText>
                <ThemedText style={styles.muted}>
                  {t('analytics.insights.demandPeak', { day: row.peakDay, n: String(row.peakRequired) })}
                </ThemedText>
              </View>
              <ThemedText style={styles.value}>
                {t('analytics.insights.demandAvg', { n: String(Math.round(row.avgRequired * 10) / 10) })}
              </ThemedText>
            </View>
          ))}
          {changes.map((row) => (
            <ThemedText key={`${row.date}::${row.role}`} style={styles.muted}>
              {t('analytics.insights.demandChange', {
                role: row.role, date: row.date, pct: `${row.changePct > 0 ? '+' : ''}${Math.round(row.changePct)}`,
              })}
            </ThemedText>
          ))}
          {accuracy.map((row) => (
            <ThemedText key={`acc::${row.date}::${row.role}`} style={styles.muted}>
              {t('analytics.insights.accuracyRow', {
                role: row.role, date: row.date, predicted: String(row.predicted), actual: String(row.actual),
              })}
            </ThemedText>
          ))}
        </ThemedView>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    stack: { gap: 16 },
    card: { gap: 12, padding: 16, borderRadius: 12, backgroundColor: colors.surface },
    row: { gap: 4 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    rowText: { flex: 1, gap: 2 },
    muted: { color: colors.textSecondary, fontSize: 14 },
    action: { color: colors.tintText, fontSize: 14, fontWeight: '600' },
    value: { fontSize: 14, fontWeight: '600', color: colors.text },
    bad: { fontSize: 14, fontWeight: '700', color: colors.error },
    warn: { fontSize: 14, fontWeight: '700', color: colors.warning },
  });
