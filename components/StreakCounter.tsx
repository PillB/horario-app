import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { Colors, brand, ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

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
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors, colorScheme ?? 'light');

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
          <ThemedText style={styles.logButtonText}>{isFresh ? 'Logged for today' : 'Log today\u2019s progress'}</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const makeStyles = (colors: ThemeColors, scheme: 'light' | 'dark') =>
  StyleSheet.create({
    container: {
      gap: 10,
      padding: 16,
      borderRadius: 12,
      // Opaque surface token eliminates unverifiable semi-transparent composite (fix #1, #11)
      backgroundColor: scheme === 'light' ? brand.primarySurface : colors.surface,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
    },
    helperText: {
      // Theme-aware token: #475569 light (6.86:1) / #94A3B8 dark (5.27:1) — fixes #2, #3, #15
      color: colors.textSecondary,
      lineHeight: 22, // ≈1.57× 14px — WCAG 1.4.12 line-height fix (#15)
    },
    progressTrack: {
      height: 14, // Increased from 10px for better visual weight (#13)
      borderRadius: 999,
      // Theme-aware border token replaces hardcoded #E5E7EB — fixes #12
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      // On-brand teal replaces hardcoded #2563EB — fixes #6
      backgroundColor: brand.primary,
    },
    badge: {
      // Theme-aware badge background — fixes #4, #5
      backgroundColor: scheme === 'light' ? brand.primarySurface : brand.primaryDeep,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
    },
    badgeText: {
      fontWeight: '700',
      // Explicit badge text colour for deterministic contrast — fixes #4, #5
      // light: brand.primaryDeep (#115E59) 5.87:1 on #F0FDFA ✓ AA
      // dark: brand.primaryLight (#99F6E4) on brand.primaryDeep (#115E59) ✓ AA
      color: scheme === 'light' ? brand.primaryDeep : brand.primaryLight,
    },
    rewardCard: {
      gap: 4,
      padding: 10,
      borderRadius: 10,
      // Theme-aware tokens replace hardcoded #E5E7EB / #f8fafc — fixes #7
      borderColor: colors.border,
      borderWidth: 1,
      backgroundColor: colors.surface,
    },
    logButton: {
      // On-brand teal CTA replaces hardcoded near-black #111827 — fixes #9, #10
      backgroundColor: colors.tint,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      minHeight: 44, // WCAG 2.5.5 / Apple HIG minimum touch target — fixes #14
    },
    logButtonDisabled: {
      // Clear disabled visual: muted background + reduced opacity — fixes #8
      backgroundColor: colors.border,
      opacity: 0.5,
    },
    logButtonText: {
      color: '#ffffff',
      fontWeight: '700',
    },
  });

export default StreakCounter;