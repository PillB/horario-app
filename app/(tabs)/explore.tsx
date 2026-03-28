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
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <ThemedText style={styles.barValue}>{hours.toFixed(1)}h</ThemedText>
    </View>
  );
}

function getFairnessConfig(score: number): { label: string; color: string; barPct: number } {
  const MAX_SCORE = 16;
  // barPct is inversely proportional to score: perfect equity = 100% fill.
  const barPct = Math.max(4, Math.round((1 - Math.min(score, MAX_SCORE) / MAX_SCORE) * 100));
  if (score < 4) return { label: 'Excellent', color: '#22C55E', barPct };
  if (score < 8) return { label: 'Good', color: '#F59E0B', barPct };
  return { label: 'Needs attention', color: '#EF4444', barPct };
}

function FairnessGauge({ score }: { score: number }) {
  const { label, color, barPct } = getFairnessConfig(score);
  return (
    <View style={styles.fairnessRow}>
      <View style={styles.fairnessBarTrack}>
        <View
          style={[styles.fairnessBarFill, { width: `${barPct}%`, backgroundColor: color }]}
        />
      </View>
      <ThemedText style={[styles.fairnessLabel, { color }]}>{label}</ThemedText>
      <ThemedText style={styles.metricSub}>{score.toFixed(1)}h std dev</ThemedText>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
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
        accessibilityLabel="Analytics screen"
      >
        <ThemedView style={styles.header}>
          <ThemedText type="title">Analytics</ThemedText>
          <ThemedText style={styles.mutedText}>
            Scheduling performance at a glance.
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
              accessibilityLabel="Retry loading analytics"
              accessibilityHint="Attempts to reload scheduling data"
              onPress={refresh}
              style={styles.retryButton}
            >
              <ThemedText style={styles.retryButtonText}>Try again</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <>
            {/* ── KPI row ────────────────────────────────────────────────── */}
            <View style={styles.kpiRow}>
              <MetricCard
                label="Coverage"
                value={`${coverageRate}%`}
                sub="of demand filled"
                accent={
                  coverageRate >= 80
                    ? '#22C55E'
                    : coverageRate >= 50
                      ? '#F59E0B'
                      : '#EF4444'
                }
                testID="analytics-coverage-rate"
              />
              <MetricCard
                label="Drafts pending"
                value={String(draftShifts)}
                sub="awaiting approval"
                accent={draftShifts > 0 ? '#F59E0B' : '#22C55E'}
                testID="analytics-draft-shifts"
              />
            </View>

            {/* ── Revenue at risk ───────────────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">Revenue at risk</ThemedText>
              <ThemedText
                type="title"
                testID="analytics-uncovered-revenue"
                style={[
                  styles.revenueValue,
                  { color: uncoveredRevenue > 0 ? '#EF4444' : '#22C55E' },
                ]}
              >
                {formatCurrency(uncoveredRevenue)}
              </ThemedText>
              <ThemedText style={styles.mutedText}>
                Estimated exposure from uncovered demand targets (
                {publishedShifts} published shifts across all dates).
              </ThemedText>
            </ThemedView>

            {/* ── Worker hours distribution ─────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">Worker hours</ThemedText>
              <ThemedText style={styles.mutedText}>
                Published shifts only · all time
              </ThemedText>
              {workerHours.length === 0 ? (
                <ThemedText style={styles.mutedText}>No published shifts yet.</ThemedText>
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
              <ThemedText type="subtitle">Schedule fairness</ThemedText>
              <ThemedText style={styles.mutedText}>
                Standard deviation of hours per worker — lower is fairer.
              </ThemedText>
              <FairnessGauge score={fairnessScore} />
            </ThemedView>

            {/* ── Quick actions ─────────────────────────────────────────── */}
            <ThemedView style={styles.card}>
              <ThemedText type="subtitle">Quick actions</ThemedText>
              <Link href="/(tabs)/scheduler" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Scheduler"
                  accessibilityHint="Go to the scheduling view to fill coverage gaps"
                  style={styles.primaryButton}
                >
                  <ThemedText style={styles.primaryButtonText}>Open Scheduler</ThemedText>
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
    color: '#9CA3AF',
    fontSize: 12,
  },
  mutedText: {
    color: '#9CA3AF',
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
