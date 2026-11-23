import { StyleSheet, View } from 'react-native';

import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { useT } from '@/contexts/LocaleContext';

/**
 * A milestone built from stored data (CHG-106). `done` decides it; progress
 * and goal, when given, show how far a counted milestone is ("2 of 4 weeks").
 * Milestones are a path to competence (setup, then habits), not points:
 * nothing is ranked against other people.
 */
type Achievement = {
  id: string;
  title: string;
  description: string;
  progress: number;
  goal?: number;
  done?: boolean;
};

type ProfileAchievementsProps = {
  items: Achievement[];
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: 10,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.surfaceRaised,
    },
    list: {
      gap: 10,
    },
    card: {
      gap: 8,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    helperText: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    cardDone: {
      borderColor: colors.tint,
    },
    textBlock: {
      flexShrink: 1,
      paddingRight: 8,
    },
    badgeTodo: {
      fontWeight: '700',
      color: colors.textSecondary,
    },
    badge: {
      fontWeight: '700',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 99,
      // White on #0F766E is 5.47:1 (colors.tint #0D9488 was 3.74:1).
      backgroundColor: brand.primaryDark,
      color: '#FFFFFF',
      overflow: 'hidden',
    },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.tint,
    },
    progressFillEmpty: {
      height: '100%',
      borderRadius: 999,
      width: 4,
      backgroundColor: colors.tint,
      opacity: 0.3,
    },
  });

export function ProfileAchievements({ items }: ProfileAchievementsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);
  const { t } = useT();

  if (!items.length) return null;

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">{t('home.achievements.title')}</ThemedText>
      <View style={styles.list}>
        {items.map((achievement) => {
          const safeGoal = achievement.goal && achievement.goal > 0 ? achievement.goal : 1;
          const percent = Math.min(100, Math.max(0, Math.round((achievement.progress / safeGoal) * 100)));
          const done = achievement.done ?? percent >= 100;
          const counted = safeGoal > 1;
          const status = done
            ? t('home.achievements.done')
            : percent === 0 ? t('home.achievements.notStarted')
              : t('home.achievements.progressOf', { n: String(achievement.progress), m: String(safeGoal) });
          return (
            <ThemedView
              key={achievement.id}
              style={[styles.card, done && styles.cardDone]}
              accessibilityLabel={`${achievement.title}. ${status}`}>
              <View style={styles.rowBetween}>
                <View style={styles.textBlock}>
                  <ThemedText type="defaultSemiBold">{achievement.title}</ThemedText>
                  <ThemedText style={styles.helperText}>{achievement.description}</ThemedText>
                </View>
                <ThemedText style={done ? styles.badge : styles.badgeTodo}>{done ? '✓' : counted ? `${percent}%` : '○'}</ThemedText>
              </View>
              {counted && !done ? (
                <View
                  style={styles.progressTrack}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ now: Math.min(achievement.progress, safeGoal), min: 0, max: safeGoal }}>
                  {percent === 0 ? (
                    <View style={styles.progressFillEmpty} />
                  ) : (
                    <View style={[styles.progressFill, { width: `${percent}%` }]} />
                  )}
                </View>
              ) : null}
              <ThemedText style={styles.helperText}>{status}</ThemedText>
            </ThemedView>
          );
        })}
      </View>
    </ThemedView>
  );
}

export default ProfileAchievements;
export type { Achievement };