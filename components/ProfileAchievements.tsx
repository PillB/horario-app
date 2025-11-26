import { StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';

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

export function ProfileAchievements({ items }: ProfileAchievementsProps) {
  if (!items.length) return null;

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Achievements</ThemedText>
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
                <View style={[styles.progressFill, { width: `${percent}%` }]} />
              </View>
              <ThemedText style={styles.helperText}>
                {achievement.progress} of {safeGoal}
              </ThemedText>
            </ThemedView>
          );
        })}
      </View>
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
  list: {
    gap: 10,
  },
  card: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  helperText: {
    color: '#6b7280',
  },
  badge: {
    fontWeight: '700',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
});

export default ProfileAchievements;
export type { Achievement };
