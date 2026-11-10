import { StyleSheet, View } from 'react-native';

import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { useT } from '@/contexts/LocaleContext';

type Achievement = {
  id: string;
  title: string;
  description: string;
  progress: number;
  goal?: number;
};

type ProfileAchievementsProps = {
  items: Achievement[];
};

import type { ThemeColors } from '@/constants/Colors';

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
    badge: {
      fontWeight: '700',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 99,
      backgroundColor: colors.tint,
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
          return (
            <ThemedView key={achievement.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View>
                  <ThemedText type="defaultSemiBold">{achievement.title}</ThemedText>
                  <ThemedText style={styles.helperText}>{achievement.description}</ThemedText>
                </View>
                <ThemedText style={styles.badge}>{percent}%</ThemedText>
              </View>
              <View style={styles.progressTrack}>
                {percent === 0 ? (
                  <View style={styles.progressFillEmpty} />
                ) : (
                  <View style={[styles.progressFill, { width: `${percent}%` }]} />
                )}
              </View>
              <ThemedText style={styles.helperText}>
                {percent === 0 ? t('home.achievements.notStarted') : `${achievement.progress} of ${safeGoal}`}
              </ThemedText>
            </ThemedView>
          );
        })}
      </View>
    </ThemedView>
  );
}

export default ProfileAchievements;
export type { Achievement };