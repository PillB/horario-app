import { Link } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PersonalizedFeed } from '@/components/PersonalizedFeed';
import { ProfileAchievements } from '@/components/ProfileAchievements';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { SkeletonCard } from '@/components/SkeletonCard';
import { StreakCounter } from '@/components/StreakCounter';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useEthicalReward } from '@/hooks/useEthicalReward';
import { useLiveRosterSummary } from '@/hooks/useLiveRosterSummary';
import { usePersonalizedFeed } from '@/hooks/usePersonalizedFeed';
import { useStreak } from '@/hooks/useStreak';

const ACCOUNT_ID = process.env.EXPO_PUBLIC_ACCOUNT_ID ?? 'demo-account';

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 768;
  const { items: feedItems } = usePersonalizedFeed({ focus: 'availability', prefersShortTasks: true });
  const { streakCount, longestStreak, isFresh, progress, recordAction } = useStreak('roster-health');
  const { tier } = useEthicalReward(streakCount);
  const { upcomingShifts, staffingGaps, loading: rosterLoading, refresh } = useLiveRosterSummary(ACCOUNT_ID);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#0F766E', dark: '#134E4A' }}
      headerImage={
        <View style={styles.heroContainer}>
          <View style={styles.heroLogoMark}>
            <ThemedText style={styles.heroLogoText}>H</ThemedText>
          </View>
          <ThemedText style={styles.heroWordmark}>Horario</ThemedText>
          <ThemedText style={styles.heroTagline}>Smart scheduling, simplified.</ThemedText>
        </View>
      }>
      <ThemedView
        style={[styles.titleContainer, isWideLayout ? styles.titleRow : styles.titleStack]}>
        <View style={[styles.heroCopy, isWideLayout && styles.heroCopyWide]}>
          <ThemedText type="title">
            Cut no-shows by auto-matching availability to demand in seconds.
          </ThemedText>
          <ThemedText style={styles.mutedText}>
            Keep worker availability, templates, and roster health in sync.
          </ThemedText>
        </View>
        <Link href="/(tabs)/scheduler" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Scheduler to plan shifts"
            accessibilityHint="Open the scheduling view to align availability with coverage"
            style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>Open Scheduler</ThemedText>
          </Pressable>
        </Link>
      </ThemedView>

      <ThemedView style={styles.card}>
        <StreakCounter
          label="Roster health streak"
          streakCount={streakCount}
          longestStreak={longestStreak}
          progress={progress}
          isFresh={isFresh}
          rewardTitle={tier.title}
          rewardMessage={tier.message}
          onRecordToday={() => recordAction()}
        />
      </ThemedView>

      <ErrorBoundary onRetry={refresh}>
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Upcoming shifts</ThemedText>
          {rosterLoading ? (
            <SkeletonCard rows={3} />
          ) : upcomingShifts.length === 0 ? (
            <ThemedText style={styles.mutedText}>No shifts scheduled in the next 7 days.</ThemedText>
          ) : (
            upcomingShifts.map((shift) => (
              <View key={shift.id} style={styles.rowBetween}>
                <View>
                  <ThemedText type="defaultSemiBold">{shift.workerName}</ThemedText>
                  <ThemedText style={styles.mutedText}>
                    {shift.templateName} • {shift.templateStart}–{shift.templateEnd}
                  </ThemedText>
                </View>
                <ThemedText style={styles.badge}>{shift.date}</ThemedText>
              </View>
            ))
          )}
        </ThemedView>

        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Staffing gaps</ThemedText>
          {rosterLoading ? (
            <SkeletonCard rows={2} />
          ) : staffingGaps.length === 0 ? (
            <ThemedText style={styles.mutedText}>No staffing gaps detected.</ThemedText>
          ) : (
            staffingGaps.map((gap) => (
              <View key={`${gap.date}::${gap.role}`} style={styles.rowBetween}>
                <View>
                  <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                  <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
                </View>
                <ThemedView style={styles.gapPill}>
                  <ThemedText style={styles.badge}>{gap.gap} open</ThemedText>
                  <ThemedText style={styles.mutedText}>{gap.required} required</ThemedText>
                </ThemedView>
              </View>
            ))
          )}
        </ThemedView>
      </ErrorBoundary>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Quick actions</ThemedText>
        <View style={styles.actions}>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add availability update"
              accessibilityHint="Capture new availability details in the scheduler"
              style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">Add availability</ThemedText>
              <ThemedText style={styles.mutedText}>Capture changes from the floor</ThemedText>
            </Pressable>
          </Link>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Build shifts from templates"
              accessibilityHint="Open the scheduler to generate shifts using templates"
              style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">Build shifts</ThemedText>
              <ThemedText style={styles.mutedText}>Start from templates</ThemedText>
            </Pressable>
          </Link>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Publish roster"
              accessibilityHint="Review targets and publish the roster to your team"
              style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">Publish roster</ThemedText>
              <ThemedText style={styles.mutedText}>Review targets vs coverage</ThemedText>
            </Pressable>
          </Link>
        </View>
      </ThemedView>

      <ThemedView style={styles.card}>
        <PersonalizedFeed
          items={feedItems}
          onSelectItem={(item) => {
            if (item.category === 'availability') {
              recordAction();
            }
          }}
        />
      </ThemedView>

      <ThemedView style={styles.card}>
        <ProfileAchievements
          items={[
            {
              id: 'ach-1',
              title: 'Consistent coverage checks',
              description: 'Logged updates 5 of the last 7 days.',
              progress: Math.max(streakCount, 1),
              goal: 7,
            },
            {
              id: 'ach-2',
              title: 'Drafts published',
              description: 'Move drafts into published when teams are ready.',
              progress: 3,
              goal: 5,
            },
          ]}
        />
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    gap: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
  },
  titleStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  heroCopy: {
    gap: 8,
    width: '100%',
  },
  heroCopyWide: {
    flex: 1,
  },
  mutedText: {
    color: '#9CA3AF',
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff11',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    fontWeight: '700',
  },
  gapPill: {
    alignItems: 'flex-end',
    gap: 4,
  },
  actions: {
    gap: 10,
  },
  actionButton: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  heroContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  heroLogoMark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroLogoText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  heroWordmark: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heroTagline: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
});
