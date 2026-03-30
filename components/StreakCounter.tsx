import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';

type StreakCounterProps = {
  label: string;
  streakCount: number;
  longestStreak: number;
  progress: number;
  isFresh?: boolean;
  rewardTitle?: string;
  rewardMessage?: string;
  onRecordToday?: () => void;
};

export function StreakCounter({
  label,
  streakCount,
  longestStreak,
  progress,
  isFresh = false,
  rewardTitle,
  rewardMessage,
  onRecordToday,
}: StreakCounterProps) {
  const normalizedProgress = Math.min(Math.max(progress, 0), 1);
  const progressPercentage = Math.round(normalizedProgress * 100);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="subtitle">{label}</ThemedText>
        <ThemedView style={styles.badge}>
          <ThemedText style={styles.badgeText}>{streakCount} day streak</ThemedText>
        </ThemedView>
      </View>
      <ThemedText style={styles.helperText}>
        Longest streak: {longestStreak} days. {isFresh ? 'Today is already counted.' : 'Log an action to extend it.'}
      </ThemedText>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityLabel={`${label} streak progress`}
        accessibilityValue={{ now: progressPercentage, min: 0, max: 100 }}
      >
        <View style={[styles.progressFill, { width: `${Math.max(progressPercentage, 6)}%` }]} />
      </View>
      {rewardTitle && rewardMessage ? (
        <ThemedView style={styles.rewardCard}>
          <ThemedText type="defaultSemiBold">{rewardTitle}</ThemedText>
          <ThemedText style={styles.helperText}>{rewardMessage}</ThemedText>
        </ThemedView>
      ) : null}
      {onRecordToday ? (
        <Pressable style={[styles.logButton, isFresh && styles.logButtonDisabled]} onPress={onRecordToday} disabled={isFresh}>
          <ThemedText style={styles.logButtonText}>{isFresh ? 'Logged for today' : 'Log today’s progress'}</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff11',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  helperText: {
    color: '#475569', // Slate 600 — 6.86:1 ✓ AA (was #9CA3AF 2.54:1 FAIL)
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
  badge: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: {
    fontWeight: '700',
  },
  rewardCard: {
    gap: 4,
    padding: 10,
    borderRadius: 10,
    borderColor: '#E5E7EB',
    borderWidth: 1,
    backgroundColor: '#f8fafc',
  },
  logButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logButtonDisabled: {
    opacity: 0.7,
  },
  logButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});

export default StreakCounter;
