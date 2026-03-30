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
import { useT } from '@/contexts/LocaleContext';
import { useIdentity } from '@/contexts/IdentityContext';
import { TourStep } from '@/components/TourStep';

export default function HomeScreen() {
  const { t } = useT();
  const { accountId: ACCOUNT_ID } = useIdentity();
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
      <TourStep target="home-header">
      <ThemedView
        style={[styles.titleContainer, isWideLayout ? styles.titleRow : styles.titleStack]}>
        <View style={[styles.heroCopy, isWideLayout && styles.heroCopyWide]}>
          <ThemedText type="title">
            {t('home.hero.tagline1')}
          </ThemedText>
          <ThemedText style={styles.mutedText}>
            {t('home.hero.tagline2')}
          </ThemedText>
        </View>
        <Link href="/(tabs)/scheduler" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.openSchedulerA11y')}
            accessibilityHint={t('home.openSchedulerHint')}
            style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>{t('home.openScheduler')}</ThemedText>
          </Pressable>
        </Link>
      </ThemedView>
      </TourStep>

      <TourStep target="streak-counter">
      <ThemedView style={styles.card}>
        <StreakCounter
          label={t('home.streak.title')}
          streakCount={streakCount}
          longestStreak={longestStreak}
          progress={progress}
          isFresh={isFresh}
          rewardTitle={tier.title}
          rewardMessage={tier.message}
          onRecordToday={() => recordAction()}
        />
      </ThemedView>
      </TourStep>

      <ErrorBoundary onRetry={refresh}>
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">{t('home.upcomingShifts.title')}</ThemedText>
          {rosterLoading ? (
            <SkeletonCard rows={3} />
          ) : upcomingShifts.length === 0 ? (
            <>
              <ThemedText style={styles.mutedText}>{t('home.upcomingShifts.empty')}</ThemedText>
              <Link href="/(tabs)/scheduler" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home.upcomingShifts.buildFirstA11y')}
                  style={styles.emptyStateCta}>
                  <ThemedText style={styles.emptyStateCtaText}>{t('home.upcomingShifts.buildFirst')}</ThemedText>
                </Pressable>
              </Link>
            </>
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
          <ThemedText type="subtitle">{t('home.staffingGaps.title')}</ThemedText>
          {rosterLoading ? (
            <SkeletonCard rows={2} />
          ) : staffingGaps.length === 0 ? (
            <ThemedText style={styles.mutedText}>
              {upcomingShifts.length > 0
                ? t('home.staffingGaps.allStaffed')
                : t('home.staffingGaps.noTargets')}
            </ThemedText>
          ) : (
            staffingGaps.map((gap) => (
              <View key={`${gap.date}::${gap.role}`} style={styles.rowBetween}>
                <View>
                  <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                  <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
                </View>
                <ThemedView style={styles.gapPill}>
                  <ThemedText style={styles.badge}>{t('home.staffingGaps.open', { n: String(gap.gap) })}</ThemedText>
                  <ThemedText style={styles.mutedText}>{t('home.staffingGaps.requiredCount', { n: String(gap.required) })}</ThemedText>
                </ThemedView>
              </View>
            ))
          )}
        </ThemedView>
      </ErrorBoundary>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">{t('home.quickActions.title')}</ThemedText>
        <View style={styles.actions}>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.quickActions.addAvailabilityA11y')}
              accessibilityHint={t('home.quickActions.addAvailabilityHint')}
              style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">{t('home.quickActions.addAvailability')}</ThemedText>
              <ThemedText style={styles.mutedText}>{t('home.quickActions.addAvailabilityDesc')}</ThemedText>
            </Pressable>
          </Link>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.quickActions.buildShiftsA11y')}
              accessibilityHint={t('home.quickActions.buildShiftsHint')}
              style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">{t('home.quickActions.buildShifts')}</ThemedText>
              <ThemedText style={styles.mutedText}>{t('home.quickActions.buildShiftsDesc')}</ThemedText>
            </Pressable>
          </Link>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.quickActions.publishRosterA11y')}
              accessibilityHint={t('home.quickActions.publishRosterHint')}
              style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">{t('home.quickActions.publishRoster')}</ThemedText>
              <ThemedText style={styles.mutedText}>{t('home.quickActions.publishRosterDesc')}</ThemedText>
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
              title: t('home.achievements.coverageChecks'),
              description: t('home.achievements.coverageChecksDesc'),
              progress: Math.max(streakCount, 1),
              goal: 7,
            },
            {
              id: 'ach-2',
              title: t('home.achievements.draftsPublished'),
              description: t('home.achievements.draftsPublishedDesc'),
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
    color: '#475569', // Slate 600 — 6.86:1 ✓ AA (was #9CA3AF 2.54:1 FAIL)
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
  emptyStateCta: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  emptyStateCtaText: {
    color: '#0D9488',
    fontWeight: '600',
    fontSize: 14,
  },
});
