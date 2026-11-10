import { useMemo } from 'react';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LocationSetupCard } from '@/components/locations/LocationSetupCard';
import { Checklist } from '@/components/scheduler/Checklist';
import { SkeletonCard } from '@/components/SkeletonCard';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useLiveRosterSummary } from '@/hooks/useLiveRosterSummary';
import { useLocations } from '@/hooks/useLocations';
import { useT } from '@/contexts/LocaleContext';
import { useIdentity } from '@/contexts/IdentityContext';
import { TourStep } from '@/components/TourStep';
import { Colors, brand, ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PageTitle } from '@/components/PageTitle';
import type { SchedulerSection } from '@/hooks/useSchedulerHandlers';
import type { OnboardingStep } from '@/types/scheduler';

const schedulerHref = (section?: SchedulerSection): Href =>
  (section ? { pathname: '/scheduler', params: { section } } : '/scheduler') as Href;

export default function HomeScreen() {
  const { t } = useT();
  const router = useRouter();
  const { accountId: ACCOUNT_ID } = useIdentity();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isWideLayout = width >= 768;
  const {
    upcomingShifts, shiftCount, staffingGaps, setup, loading: rosterLoading, error: rosterError, refresh,
  } = useLiveRosterSummary(ACCOUNT_ID);
  // First-run: ask where the business is until it has a confirmed location.
  const { locations, loaded: locationsLoaded, save: saveLocation } = useLocations(ACCOUNT_ID);

  const styles = makeStyles(colors, colorScheme ?? 'light');

  // Setup steps still to do, each linking to its step of the scheduler.
  const setupSteps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'workers',
        title: t('scheduler.onboarding.addWorkers'),
        description: t('scheduler.onboarding.addWorkersDesc'),
        completed: setup.workers > 0,
        actionLabel: t('scheduler.onboarding.addWorkersAction'),
        onPress: () => router.push(schedulerHref('workers')),
      },
      {
        key: 'templates',
        title: t('scheduler.onboarding.saveTemplates'),
        description: t('scheduler.onboarding.saveTemplatesDesc'),
        completed: setup.templates > 0,
        actionLabel: t('scheduler.onboarding.saveTemplatesAction'),
        onPress: () => router.push(schedulerHref('templates')),
      },
      {
        key: 'forecast',
        title: t('scheduler.onboarding.runForecast'),
        description: t('scheduler.onboarding.runForecastDesc'),
        completed: setup.targets > 0,
        actionLabel: t('scheduler.onboarding.runForecastAction'),
        onPress: () => router.push(schedulerHref('forecast')),
      },
    ],
    [router, setup.targets, setup.templates, setup.workers, t],
  );
  const setupDone = setupSteps.filter((step) => step.completed).length;
  const showSetup = !rosterLoading && !rosterError && setupDone < setupSteps.length;

  return (
    <>
    <PageTitle title={t('nav.home')} />
    <ScrollView contentContainerStyle={styles.page}>
      <TourStep target="home-header">
      <ThemedView style={styles.card}>
        <View style={[styles.titleContainer, isWideLayout ? styles.titleRow : styles.titleStack]}>
          <View style={[styles.heroCopy, isWideLayout && styles.heroCopyWide]}>
            <ThemedText type="subtitle" accessibilityRole="header">{t('home.weekStats.title')}</ThemedText>
            <ThemedText style={styles.mutedText}>{t('home.hero.tagline2')}</ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.openSchedulerA11y')}
            accessibilityHint={t('home.openSchedulerHint')}
            onPress={() => router.push(schedulerHref())}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <ThemedText style={styles.primaryButtonText}>{t('home.openScheduler')}</ThemedText>
          </Pressable>
        </View>
        {rosterLoading ? <SkeletonCard rows={1} /> : rosterError ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <ThemedText style={styles.errorText}>{t('errors.networkError')}</ThemedText>
            <ThemedText style={styles.mutedText}>{rosterError}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.tryAgain')}
              accessibilityHint={t('errors.retryHint')}
              onPress={refresh}
              style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed]}>
              <ThemedText style={styles.inviteButtonText}>{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.kpiRow}>
            <View style={styles.kpiCell}>
              <ThemedText type="title" style={styles.kpiValue}>{String(shiftCount)}</ThemedText>
              <ThemedText style={styles.mutedText}>{t('home.weekStats.scheduled')}</ThemedText>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiCell}>
              <ThemedText type="title" style={[styles.kpiValue, { color: staffingGaps.length > 0 ? colors.error : colors.success }]}>
                {String(staffingGaps.length)}
              </ThemedText>
              <ThemedText style={styles.mutedText}>{t('home.weekStats.gaps')}</ThemedText>
            </View>
          </View>
        )}
      </ThemedView>
      </TourStep>

      {locationsLoaded && locations.length === 0 ? (
        <ErrorBoundary>
          <LocationSetupCard onSave={saveLocation} />
        </ErrorBoundary>
      ) : null}

      {showSetup ? (
        <Checklist steps={setupSteps} progress={setupDone / setupSteps.length} />
      ) : null}

      {!rosterError ? (
      <ErrorBoundary onRetry={refresh}>
        <View style={isWideLayout ? styles.columns : styles.stack}>
        <ThemedView style={[styles.card, isWideLayout && styles.column]}>
          <ThemedText type="subtitle">{t('home.upcomingShifts.title')}</ThemedText>
          {rosterLoading ? (
            <SkeletonCard rows={3} />
          ) : upcomingShifts.length === 0 ? (
            <>
              <ThemedText style={styles.mutedText}>{t('home.upcomingShifts.empty')}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.upcomingShifts.buildFirstA11y')}
                accessibilityHint={t('home.quickActions.buildShiftsHint')}
                onPress={() => router.push(schedulerHref('shifts'))}
                style={styles.emptyStateCta}>
                <ThemedText style={styles.emptyStateCtaText}>{t('home.upcomingShifts.buildFirst')}</ThemedText>
              </Pressable>
            </>
          ) : (
            upcomingShifts.map((shift) => (
              <View key={shift.id} style={styles.rowBetween}>
                <View style={styles.rowText}>
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

        <ThemedView style={[styles.card, isWideLayout && styles.column]}>
          <ThemedText type="subtitle">{t('home.staffingGaps.title')}</ThemedText>
          {rosterLoading ? (
            <SkeletonCard rows={2} />
          ) : staffingGaps.length === 0 ? (
            <ThemedText style={styles.mutedText}>
              {setup.targets > 0
                ? t('home.staffingGaps.allStaffed')
                : t('home.staffingGaps.noTargets')}
            </ThemedText>
          ) : (
            staffingGaps.map((gap) => (
              <View key={`${gap.date}::${gap.role}`} style={styles.rowBetween}>
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                  <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
                </View>
                <View style={styles.gapPill}>
                  <ThemedText style={styles.badge}>{t('home.staffingGaps.open', { n: String(gap.gap) })}</ThemedText>
                  <ThemedText style={styles.mutedText}>{t('home.staffingGaps.requiredCount', { n: String(gap.required) })}</ThemedText>
                </View>
              </View>
            ))
          )}
        </ThemedView>
        </View>
      </ErrorBoundary>
      ) : null}

      {/* The setup checklist already links to the same places. */}
      {showSetup ? null : (
      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">{t('home.quickActions.title')}</ThemedText>
        <View style={isWideLayout ? styles.columns : styles.actions}>
          {([
            ['workers', 'addAvailability'],
            ['templates', 'buildShifts'],
            ['shifts', 'publishRoster'],
          ] as const).map(([section, key]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={t(`home.quickActions.${key}A11y`)}
              accessibilityHint={t(`home.quickActions.${key}Hint`)}
              onPress={() => router.push(schedulerHref(section))}
              style={({ pressed }) => [styles.actionButton, isWideLayout && styles.column, pressed && styles.actionPressed]}>
              <ThemedText type="defaultSemiBold">{t(`home.quickActions.${key}`)}</ThemedText>
              <ThemedText style={styles.mutedText}>{t(`home.quickActions.${key}Desc`)}</ThemedText>
            </Pressable>
          ))}
        </View>
      </ThemedView>
      )}

    </ScrollView>
    </>
  );
}

const makeStyles = (colors: ThemeColors, scheme: 'light' | 'dark') =>
  StyleSheet.create({
    page: {
      padding: 16,
      gap: 16,
      width: '100%',
      maxWidth: 1100,
      alignSelf: 'center',
    },
    pressed: {
      opacity: 0.75,
    },
    actionPressed: {
      backgroundColor: colors.background,
    },
    columns: {
      flexDirection: 'row',
      gap: 16,
      alignItems: 'stretch',
    },
    stack: {
      gap: 16,
    },
    column: {
      flex: 1,
    },
    rowText: {
      flexShrink: 1,
    },
    errorBox: {
      gap: 8,
      alignItems: 'flex-start',
    },
    errorText: {
      color: colors.error,
      fontWeight: '600',
    },
    titleContainer: {
      gap: 12,
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
      // Uses theme-aware textSecondary: Slate 600 (6.86:1) light / Slate 400 (5.27:1) dark — both ✓ AA
      color: colors.textSecondary,
    },
    card: {
      gap: 12,
      padding: 16,
      borderRadius: 12,
      // Uses theme surface token: #FFFFFF (light) / #1E293B (dark) — visually distinct from page background
      backgroundColor: colors.surface,
    },
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
      // Minimum touch target height per WCAG 2.5.5
      minHeight: 44,
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
      // Uses theme-aware border and surface tokens — adapt correctly in dark mode
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    primaryButton: {
      // brand.primaryDark (#0F766E): white text gives 9.30:1 ✅ AAA; aligns with teal brand palette
      backgroundColor: brand.primaryDark,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 10,
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontWeight: '700',
    },
    emptyStateCta: {
      marginTop: 6,
      alignSelf: 'flex-start',
    },
    emptyStateCtaText: {
      // brand.primaryDeep (#115E59): 5.87:1 ✅ AA on white surface; scheme tint (#2DD4BF) in dark mode: 8.95:1 ✅ AAA
      color: scheme === 'dark' ? colors.tint : brand.primaryDeep,
      fontWeight: '600',
      // Increased to 16px for mobile readability; ensures AA at corrected colour
      fontSize: 16,
    },
    kpiRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 0,
    },
    kpiCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
    },
    kpiValue: {
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '700',
    },
    kpiDivider: {
      width: 1,
      height: 48,
      backgroundColor: colors.border,
    },
    inviteButton: {
      borderWidth: 1.5,
      borderColor: brand.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
    },
    inviteButtonText: {
      color: colors.tintText, // light #0F766E 5.47:1 on white ✓ AA (#0D9488 was 3.74:1)
      fontWeight: '600',
      fontSize: 14,
    },
  });