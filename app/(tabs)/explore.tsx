/**
 * AnalyticsScreen — live scheduling-performance dashboard.
 *
 * Data is fetched by useAnalytics which joins roster, workers, templates, and
 * demand targets in a single Promise.all call.  All visuals are built from
 * React Native View primitives — no external chart library required.
 *
 * Visual components:
 *   MetricCard   — a single KPI in a rounded card (value + label)
 *   HoursBar     — horizontal bar proportional to max worker hours
 *   FairnessGauge — color-coded fairness label with a progress bar
 */
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SkeletonCard } from '@/components/SkeletonCard';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAnalytics, type WorkerHoursEntry } from '@/hooks/useAnalytics';
import { formatCurrency } from '@/utils/schedulerUtils';
import { useT } from '@/contexts/LocaleContext';

const ACCOUNT_ID = process.env.EXPO_PUBLIC_ACCOUNT_ID ?? 'demo-account';

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
  testID,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  testID?: string;
}) {
  return (
    <ThemedView
      style={[styles.metricCard, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null]}
    >
      <ThemedText
        type="title"
        testID={testID}
        style={[styles.metricValue, accent ? { color: accent } : null]}
      >
        {value}
      </ThemedText>
      <ThemedText type="defaultSemiBold" style={styles.metricLabel}>
        {label}
      </ThemedText>
      {sub ? <ThemedText style={styles.metricSub}>{sub}</ThemedText> : null}
    </ThemedView>
  );
}

function HoursBar({
  name,
  hours,
  maxHours,
  testID,
}: {
  name: string;
  hours: number;
  maxHours: number;
  testID?: string;
}) {
  const pct = maxHours > 0 ? Math.min(100, (hours / maxHours) * 100) : 0;
  return (
    <View style={styles.barRow} testID={testID}>
      <ThemedText style={styles.barLabel} numberOfLines={1}>
        {name}
      </ThemedText>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` as `${number}%` }]} />
      </View>
      <ThemedText style={styles.barValue}>{hours.toFixed(1)}h</ThemedText>
    </View>
  );
}

function FairnessGauge({ score }: { score: number }) {
  const { t } = useT();
  const MAX_SCORE = 16;
  const barPct = Math.max(4, Math.round((1 - Math.min(score, MAX_SCORE) / MAX_SCORE) * 100));
  let label: string;
  let textColor: string;
  let barColor: string;
  // Text colors are AA-compliant on white (#FFFFFF):
  //   Green 700  #15803D → 5.44:1 ✓ (bar fill keeps bright #22C55E)
  //   Amber 700  #B45309 → 4.82:1 ✓ (bar fill keeps bright #F59E0B)
  //   Red   600  #DC2626 → 4.64:1 ✓ (bar fill keeps bright #EF4444)
  if (score < 4) {
    label = t('analytics.fairnessExcellent'); textColor = '#15803D'; barColor = '#22C55E';
  } else if (score < 8) {
    label = t('analytics.fairnessGood'); textColor = '#B45309'; barColor = '#F59E0B';
  } else {
    label = t('analytics.fairnessNeedsAttention'); textColor = '#DC2626'; barColor = '#EF4444';
  }
  return (
    <View style={styles.fairnessRow}>
      <View style={styles.fairnessBarTrack}>
        <View
          style={[styles.fairnessBarFill, { width: `${barPct}%` as `${number}%`, backgroundColor: barColor }]}
        />
      </View>
      <ThemedText style={[styles.fairnessLabel, { color: textColor }]}>{label}</ThemedText>
      <ThemedText style={styles.metricSub}>
        {t('analytics.fairnessStdDev', { n: score.toFixed(1) })}
      </ThemedText>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const { t } = useT();
  const {
    coverageRate,
    draftShifts,
    publishedShifts,
    workerHours,
    fairnessScore,
    uncoveredRevenue,
    loading,
    error,
    refresh,
  } = useAnalytics(ACCOUNT_ID);

  const maxHours = workerHours.length > 0 ? workerHours[0].hours : 0;

  return (
    <ErrorBoundary onRetry={refresh}>
      <ScrollView
        contentContainerStyle={styles.container}
        accessibilityLabel={t('nav.analytics')}
      >
        <ThemedView style={styles.header}>
          <ThemedText type="title">{t('analytics.title')}</ThemedText>
          <ThemedText style={styles.mutedText}>
            {t('analytics.subtitle')}
          </ThemedText>
        </ThemedView>

        {loading ? (
          <ThemedView style={styles.loadingContainer}>
            <SkeletonCard rows={4} />
          </ThemedView>
        ) : error ? (
          <ThemedView style={styles.loadingContainer}>
            <ThemedText style={styles.errorText} testID="analytics-error">
              {error}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('analytics.retryA11y')}
              accessibilityHint={t('analytics.retryA11yHint')}
              onPress={refresh}
              style={styles.retryButton}
            >
              <ThemedText style={styles.retryButtonText}>{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <>
            {/* ── KPI row ────────────────────────────────────────────────── */}
            <View style={styles.kpiRow}>
              <MetricCard
                label={t('analytics.coverageLabel')}
                value={`${coverageRate}%`}
                sub={t('analytics.coverageSub')}
                accent={
                  // Text-safe AA colors (left-border accent + metric value color):
                  //   Green 700 #15803D 5.44:1 · Amber 700 #B45309 4.82:1 · Red 600 #DC2626 4.64:1
                  coverageRate >= 80
                    ? '#15803D'
                    : coverageRate >= 50
                      ? '#B45309'
                      : '#DC2626'
                }
                testID="analytics-coverage-rate"
              />
              <MetricCard
                label={t('analytics.draftsPending')}
                value={String(draftShifts)}
                sub={t('analytics.draftsAwaiting')}
                accent={draftShifts > 0 ? '#B45309' : '#15803D'}
                testID="analytics-draft-shifts"
              />
            </View>

            {/* ── Revenue at risk ───────────────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">{t('analytics.revenueAtRisk')}</ThemedText>
              <ThemedText
                type="title"
                testID="analytics-uncovered-revenue"
                style={[
                  styles.revenueValue,
                  { color: uncoveredRevenue > 0 ? '#DC2626' : '#15803D' },
                ]}
              >
                {formatCurrency(uncoveredRevenue)}
              </ThemedText>
              <ThemedText style={styles.mutedText}>
                {t('analytics.revenueDesc', { n: String(publishedShifts) })}
              </ThemedText>
            </ThemedView>

            {/* ── Worker hours distribution ─────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">{t('analytics.workerHours')}</ThemedText>
              <ThemedText style={styles.mutedText}>
                {t('analytics.workerHoursSub')}
              </ThemedText>
              {workerHours.length === 0 ? (
                <ThemedText style={styles.mutedText}>{t('analytics.noPublishedShifts')}</ThemedText>
              ) : (
                (workerHours as WorkerHoursEntry[]).map((entry) => (
                  <HoursBar
                    key={entry.workerId}
                    name={entry.workerName}
                    hours={entry.hours}
                    maxHours={maxHours}
                    testID={`hours-bar-${entry.workerId}`}
                  />
                ))
              )}
            </ThemedView>

            {/* ── Fairness score ────────────────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">{t('analytics.fairness')}</ThemedText>
              <ThemedText style={styles.mutedText}>
                {t('analytics.fairnessSub')}
              </ThemedText>
              <FairnessGauge score={fairnessScore} />
            </ThemedView>

            {/* ── Quick actions ─────────────────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">{t('analytics.quickActions')}</ThemedText>
              <Link href="/(tabs)/scheduler" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('analytics.openScheduler')}
                  accessibilityHint={t('analytics.openSchedulerHint')}
                  style={styles.primaryButton}
                >
                  <ThemedText style={styles.primaryButtonText}>{t('analytics.openScheduler')}</ThemedText>
                </Pressable>
              </Link>
            </ThemedView>
          </>
        )}
      </ScrollView>
    </ErrorBoundary>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  header: {
    gap: 6,
    marginBottom: 4,
  },
  loadingContainer: {
    padding: 16,
    gap: 12,
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff11',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff11',
    gap: 4,
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 34,
  },
  metricLabel: {
    fontSize: 13,
  },
  metricSub: {
    color: '#475569', // Slate 600 — 6.86:1 ✓ AA (was #9CA3AF 2.54:1 FAIL)
    fontSize: 12,
  },
  mutedText: {
    color: '#475569', // Slate 600 — 6.86:1 ✓ AA (was #9CA3AF 2.54:1 FAIL)
    fontSize: 14,
  },
  revenueValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  // Worker hours bars
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barLabel: {
    width: 72,
    fontSize: 13,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  barFill: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
  },
  barValue: {
    width: 40,
    textAlign: 'right',
    fontSize: 13,
  },
  // Fairness gauge
  fairnessRow: {
    gap: 8,
  },
  fairnessBarTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  fairnessBarFill: {
    height: 10,
    borderRadius: 5,
  },
  fairnessLabel: {
    fontWeight: '700',
    fontSize: 15,
  },
  // Error / retry
  errorText: {
    color: '#EF4444',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignSelf: 'center',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
