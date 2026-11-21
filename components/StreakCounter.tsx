/**
 * StreakCounter — the weekly "posted ahead" habit on Home (CHG-103).
 *
 * Shows the last weeks as labelled cells (symbol + date, so colour is never
 * the only signal, WCAG 1.4.1), the run of weeks in a row, and the steadier
 * "N of the last M weeks" count. A late week is shown in neutral grey, never
 * red, and is not called out: highlighting a broken streak lowers persistence
 * (Silverman & Barasch, J. Consumer Research 2022). There is no button to
 * "log" progress: the weeks come from when shifts were published.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useEthicalReward } from '@/hooks/useEthicalReward';
import type { HabitWeek, NoticeGoal, PostingHabit } from '@/utils/postingHabit';

type StreakCounterProps = {
  habit: PostingHabit | null;
  goal: NoticeGoal;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenRoster?: () => void;
};

const SYMBOL: Record<HabitWeek['verdict'], string> = { ahead: '✓', late: '–', open: '○', empty: '·' };

/** "11/03" from "2026-11-03": short, locale-free and identical on server and client. */
const shortDate = (key: string) => `${key.slice(5, 7)}/${key.slice(8, 10)}`;

export function StreakCounter({ habit, goal, loading = false, error = null, onRetry, onOpenRoster }: StreakCounterProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const styles = makeStyles(colors, colorScheme);
  const { t } = useT();
  const { tier } = useEthicalReward(habit?.run ?? 0);
  const days = String(goal.days);

  const header = (
    <>
      <ThemedText type="subtitle" accessibilityRole="header">{t('home.habit.title')}</ThemedText>
      <ThemedText style={styles.helperText}>{t('home.habit.goal', { n: days })}</ThemedText>
    </>
  );

  if (loading && !habit) {
    return <ThemedView style={styles.container}>{header}<ThemedText style={styles.helperText}>{t('home.habit.loading')}</ThemedText></ThemedView>;
  }
  if (error || !habit) {
    return (
      <ThemedView style={styles.container}>
        {header}
        <View accessibilityRole="alert">
          <ThemedText style={styles.helperText}>{t('home.habit.loadError')}</ThemedText>
        </View>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.tryAgain')}
            accessibilityHint={t('errors.retryHint')}
            onPress={onRetry}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <ThemedText style={styles.secondaryButtonText}>{t('common.tryAgain')}</ThemedText>
          </Pressable>
        ) : null}
      </ThemedView>
    );
  }

  const next = habit.weeks.find((w) => w.verdict === 'open');
  const verdictLabel = (w: HabitWeek) => t(`home.habit.verdict.${w.verdict}`);

  return (
    <ThemedView style={styles.container}>
      {header}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCell}>
          <ThemedText type="title" style={styles.bigNumber}>{String(habit.run)}</ThemedText>
          <ThemedText style={styles.helperText}>{t('home.habit.inARow')}</ThemedText>
        </View>
        <View style={styles.summaryCell}>
          <ThemedText type="title" style={styles.bigNumber}>
            {t('home.habit.ofWeeks', { n: String(habit.aheadWeeks), m: String(habit.decidedWeeks) })}
          </ThemedText>
          <ThemedText style={styles.helperText}>{t('home.habit.recentWeeks')}</ThemedText>
        </View>
      </View>

      <View style={styles.weeks} accessibilityRole="list" accessibilityLabel={t('home.habit.weeksA11y')}>
        {habit.weeks.map((w) => (
          <View
            key={w.weekStart}
            accessibilityRole="text"
            accessibilityLabel={t('home.habit.weekA11y', { date: w.weekStart, verdict: verdictLabel(w) })}
            style={[styles.week, styles[`week_${w.verdict}`]]}>
            <ThemedText style={[styles.weekSymbol, w.verdict === 'ahead' && styles.weekSymbolAhead]}>{SYMBOL[w.verdict]}</ThemedText>
            <ThemedText style={[styles.weekDate, w.verdict === 'ahead' && styles.weekSymbolAhead]}>{shortDate(w.weekStart)}</ThemedText>
          </View>
        ))}
      </View>
      <ThemedText style={styles.legend}>{t('home.habit.legend')}</ThemedText>

      {tier ? (
        <ThemedView style={styles.rewardCard}>
          <ThemedText type="defaultSemiBold">{t(tier.titleKey)}</ThemedText>
          <ThemedText style={styles.helperText}>{t(tier.messageKey)}</ThemedText>
        </ThemedView>
      ) : null}

      {next ? (
        <View style={styles.nextBox}>
          <ThemedText type="defaultSemiBold">
            {t('home.habit.next', { week: next.weekStart, deadline: next.deadline })}
          </ThemedText>
          {next.shifts > 0 ? (
            <ThemedText style={styles.helperText}>
              {t('home.habit.nextProgress', { n: String(next.postedByDeadline), m: String(next.shifts) })}
            </ThemedText>
          ) : null}
          {onOpenRoster ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.habit.openRosterA11y')}
              accessibilityHint={t('home.habit.openRosterHint')}
              onPress={onOpenRoster}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <ThemedText style={styles.secondaryButtonText}>{t('home.habit.openRoster')}</ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {goal.lawDays !== null && goal.lawDays >= goal.days ? (
        <ThemedText style={styles.helperText}>{t('home.habit.lawNotice', { n: String(goal.lawDays) })}</ThemedText>
      ) : null}
      {goal.ifCoveredDays !== null ? (
        <ThemedText style={styles.helperText}>{t('home.habit.fairWorkweek', { n: String(goal.ifCoveredDays) })}</ThemedText>
      ) : null}
      <ThemedText style={styles.why}>{t('home.habit.why')}</ThemedText>
    </ThemedView>
  );
}

const makeStyles = (colors: ThemeColors, scheme: 'light' | 'dark') =>
  StyleSheet.create({
    container: {
      gap: 10,
      padding: 16,
      borderRadius: 12,
      backgroundColor: scheme === 'light' ? brand.primarySurface : colors.surface,
    },
    helperText: {
      color: colors.textSecondary,
      lineHeight: 22,
    },
    why: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    summaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
    },
    summaryCell: {
      flexGrow: 1,
      flexBasis: 140,
    },
    bigNumber: {
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '700',
    },
    weeks: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    week: {
      minWidth: 52,
      minHeight: 52,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    week_ahead: {
      // White on #0F766E is 5.47:1.
      backgroundColor: brand.primaryDark,
      borderColor: brand.primaryDark,
    },
    week_late: {
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    week_open: {
      borderColor: colors.tint,
      borderStyle: 'dashed',
      backgroundColor: colors.surface,
    },
    week_empty: {
      borderColor: colors.border,
      backgroundColor: 'transparent',
    },
    weekSymbol: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    weekSymbolAhead: {
      color: '#FFFFFF',
    },
    weekDate: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    legend: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    rewardCard: {
      gap: 4,
      padding: 10,
      borderRadius: 10,
      borderColor: colors.border,
      borderWidth: 1,
      backgroundColor: colors.surface,
    },
    nextBox: {
      gap: 6,
    },
    secondaryButton: {
      borderWidth: 1.5,
      borderColor: brand.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    secondaryButtonText: {
      color: colors.tintText,
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.75,
    },
  });

export default StreakCounter;
