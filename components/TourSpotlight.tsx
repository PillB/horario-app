import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { brand, Colors, type ThemeColors } from '@/constants/Colors';
import { useWelcomeTour, type TourMode } from '@/contexts/WelcomeTourContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';
import type { LangCode } from '@/locales/en';

// Language meta for the inline picker — flags + native names
const LANG_META: Record<LangCode, { flag: string; native: string }> = {
  en: { flag: '🇺🇸', native: 'English' },
  es: { flag: '🇪🇸', native: 'Español' },
  de: { flag: '🇩🇪', native: 'Deutsch' },
  fr: { flag: '🇫🇷', native: 'Français' },
  it: { flag: '🇮🇹', native: 'Italiano' },
  zh: { flag: '🇨🇳', native: '中文' },
  sw: { flag: '🇰🇪', native: 'Kiswahili' },
  tl: { flag: '🇵🇭', native: 'Filipino' },
  hi: { flag: '🇮🇳', native: 'हिंदी' },
};
const LANG_CODES = Object.keys(LANG_META) as LangCode[];

/** Tour step targets that live on the Scheduler screen. */
const SCHEDULER_TARGETS = new Set([
  'workers-section',
  'availability-section',
  'shift-templates-section',
  'roster-section',
  'demand-section',
]);

/** Tour step targets that live on the Home screen. */
const HOME_TARGETS = new Set([
  'home-header',
  'week-stats',
  'streak-counter',
  'upcoming-shifts',
  'staffing-gaps',
  'quick-actions',
]);

/** Tour step targets that live on the Analytics screen. */
const ANALYTICS_TARGETS = new Set([
  'analytics-kpis',
  'analytics-revenue',
  'analytics-hours',
  'analytics-fairness',
]);

function tabForTarget(target: string): string | null {
  if (SCHEDULER_TARGETS.has(target)) return '/(tabs)/scheduler';
  if (HOME_TARGETS.has(target)) return '/';
  if (ANALYTICS_TARGETS.has(target)) return '/(tabs)/explore';
  return null;
}

function tabNameForTarget(target: string, t: (key: string) => string): string {
  if (SCHEDULER_TARGETS.has(target)) return t('nav.scheduler');
  if (HOME_TARGETS.has(target)) return t('nav.home');
  if (ANALYTICS_TARGETS.has(target)) return t('nav.analytics');
  return '';
}

function pathMatchesTab(pathname: string, tabPath: string): boolean {
  if (tabPath === '/') return pathname === '/' || pathname.endsWith('/index');
  return pathname.includes(tabPath.replace('/(tabs)/', ''));
}

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const CARD_MARGIN_H = 24;
const CARD_BELOW_GAP = 16;
const CARD_ABOVE_GAP = 16;
const MIN_SPACE_BELOW = 200;

/** Sub-component so prevStep is called at the hook call-site, not in a callback. */
function BackButton({ colors }: { colors: ThemeColors }) {
  const { prevStep } = useWelcomeTour();
  const { t } = useT();
  const styles = makeStyles(colors);
  return (
    <Pressable
      onPress={prevStep}
      accessibilityRole="button"
      accessibilityLabel={t('tour.nav.back')}
      accessibilityHint="Returns to the previous tour step"
      style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.5 }]}
    >
      <ThemedText style={styles.textButtonLabel}>{t('tour.nav.back')}</ThemedText>
    </Pressable>
  );
}

/** Guide mode picker shown before the tour starts */
function GuideModePicker({ colors }: { colors: ThemeColors }) {
  const { startTourMode } = useWelcomeTour();
  const { t, langCode, setLanguage } = useT();
  const styles = makeStyles(colors);

  const modes: Array<{
    mode: TourMode;
    emoji: string;
    title: string;
    desc: string;
  }> = [
    {
      mode: 'overview',
      emoji: '🗺️',
      title: t('tour.mode.overview'),
      desc: t('tour.mode.overviewDesc'),
    },
    {
      mode: 'manager',
      emoji: '📋',
      title: t('tour.mode.manager'),
      desc: t('tour.mode.managerDesc'),
    },
    {
      mode: 'worker',
      emoji: '👷',
      title: t('tour.mode.worker'),
      desc: t('tour.mode.workerDesc'),
    },
    {
      mode: 'home',
      emoji: '🏠',
      title: t('tour.mode.home'),
      desc: t('tour.mode.homeDesc'),
    },
    {
      mode: 'scheduler',
      emoji: '📅',
      title: t('tour.mode.scheduler'),
      desc: t('tour.mode.schedulerDesc'),
    },
    {
      mode: 'analytics',
      emoji: '📊',
      title: t('tour.mode.analytics'),
      desc: t('tour.mode.analyticsDesc'),
    },
  ];

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.roleBackdrop}>
        <ScrollView
          contentContainerStyle={styles.roleScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.roleCard}>
            {/* ── Language picker ──────────────────────────── */}
            <ThemedText style={styles.roleLangLabel}>
              {t('tour.roleSelect.languageLabel')}
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.langRow}
            >
              {LANG_CODES.map((code) => {
                const meta = LANG_META[code];
                const selected = code === langCode;
                return (
                  <Pressable
                    key={code}
                    onPress={() => setLanguage(code)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={meta.native}
                    style={({ pressed }) => [
                      styles.langChip,
                      selected && styles.langChipSelected,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <ThemedText style={styles.langChipFlag}>{meta.flag}</ThemedText>
                    <ThemedText
                      style={[
                        styles.langChipText,
                        selected && styles.langChipTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {meta.native}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* ── Divider ──────────────────────────────────── */}
            <View style={styles.roleDivider} />

            {/* ── Section heading ──────────────────────────── */}
            <ThemedText style={styles.roleTitle}>
              {t('tour.mode.pickTitle')}
            </ThemedText>
            <ThemedText style={styles.roleDesc}>
              {t('tour.mode.pickDesc')}
            </ThemedText>

            {/* ── 2-column mode grid ───────────────────────── */}
            <View style={styles.modeGrid}>
              {modes.map(({ mode, emoji, title, desc }) => (
                <Pressable
                  key={mode}
                  onPress={() => startTourMode(mode)}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  style={({ pressed }) => [
                    styles.modeButton,
                    pressed && styles.modeButtonPressed,
                  ]}
                >
                  <ThemedText style={styles.modeEmoji}>{emoji}</ThemedText>
                  <ThemedText style={styles.modeTitle}>{title}</ThemedText>
                  <ThemedText style={styles.modeDesc}>{desc}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function TourSpotlight() {
  const {
    isActive,
    userRole,
    tourMode,
    currentStep,
    currentStepIndex,
    totalSteps,
    stepLayouts,
    canAdvance,
    progressPercent,
    nextStep,
    skipTour,
    startTourMode,
  } = useWelcomeTour();

  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  const { width: screenW, height: screenH } = useWindowDimensions();

  const [whyExpanded, setWhyExpanded] = useState(false);

  const rawLayout = useMemo(() => {
    if (!currentStep) return null;
    return stepLayouts[currentStep.target] ?? null;
  }, [currentStep, stepLayouts]);

  /**
   * Expand the raw measured rect by SPOTLIGHT_PADDING on all sides,
   * clamped to screen bounds.
   */
  const spotlightRect = useMemo(() => {
    if (!rawLayout) return null;
    const x = Math.max(0, rawLayout.x - SPOTLIGHT_PADDING);
    const y = Math.max(0, rawLayout.y - SPOTLIGHT_PADDING);
    const right = Math.min(screenW, rawLayout.x + rawLayout.width + SPOTLIGHT_PADDING);
    const bottom = Math.min(screenH, rawLayout.y + rawLayout.height + SPOTLIGHT_PADDING);
    return { x, y, width: right - x, height: bottom - y };
  }, [rawLayout, screenW, screenH]);

  /** Derive callout card vertical position. */
  const cardVerticalStyle = useMemo(():
    | { top: number }
    | { bottom: number } => {
    if (!spotlightRect) {
      return { top: screenH / 2 - 120 };
    }
    const spaceBelow =
      screenH - (spotlightRect.y + spotlightRect.height + SPOTLIGHT_PADDING);
    if (spaceBelow >= MIN_SPACE_BELOW) {
      return {
        top:
          spotlightRect.y +
          spotlightRect.height +
          SPOTLIGHT_PADDING +
          CARD_BELOW_GAP,
      };
    }
    return { bottom: screenH - spotlightRect.y + CARD_ABOVE_GAP };
  }, [spotlightRect, screenH]);

  const isLastStep = currentStepIndex === totalSteps - 1;
  const isFirstStep = currentStepIndex === 0;

  // Use tourMode for key path; fall back to userRole for backward compat
  const modeKey =
    tourMode ?? (userRole === 'worker' ? 'worker' : 'manager');
  const stepId = currentStep?.id ?? '';

  const stepTitle = currentStep
    ? t(`tour.${modeKey}.step${stepId}.title`)
    : '';
  const stepDesc = currentStep
    ? t(`tour.${modeKey}.step${stepId}.desc`)
    : '';
  const stepWhy = currentStep
    ? t(`tour.${modeKey}.step${stepId}.why`)
    : '';

  const modeBadgeText = (() => {
    switch (tourMode) {
      case 'overview':
        return '🗺️ Overview';
      case 'manager':
        return '👔 Manager';
      case 'worker':
        return '👷 Team Member';
      case 'home':
        return '🏠 Home';
      case 'scheduler':
        return '📅 Scheduler';
      case 'analytics':
        return '📊 Analytics';
      default:
        return null;
    }
  })();

  const requiresActionAndBlocked =
    currentStep?.requiresAction === true && !canAdvance;

  // Cross-tab navigation detection for all tabs
  const targetTab = currentStep ? tabForTarget(currentStep.target) : null;
  const isOnWrongScreen =
    currentStep !== null &&
    targetTab !== null &&
    rawLayout === null &&
    !pathMatchesTab(pathname, targetTab);

  const wrongScreenTabName =
    currentStep !== null
      ? tabNameForTarget(currentStep.target, t)
      : '';

  if (!isActive) return null;

  // Show guide mode picker if no mode chosen yet
  if (tourMode === null) {
    return <GuideModePicker colors={colors} />;
  }

  if (!currentStep) return null;

  return (
    <Modal
      visible={isActive}
      transparent
      animationType="fade"
      onRequestClose={skipTour}
      statusBarTranslucent
    >
      {/* ── Backdrop with spotlight cutout ── */}
      {spotlightRect ? (
        <>
          {/* Top */}
          <View
            style={[
              styles.backdropSlice,
              { top: 0, left: 0, width: screenW, height: spotlightRect.y },
            ]}
            pointerEvents="none"
          />
          {/* Bottom */}
          <View
            style={[
              styles.backdropSlice,
              {
                top: spotlightRect.y + spotlightRect.height,
                left: 0,
                width: screenW,
                height:
                  screenH - (spotlightRect.y + spotlightRect.height),
              },
            ]}
            pointerEvents="none"
          />
          {/* Left */}
          <View
            style={[
              styles.backdropSlice,
              {
                top: spotlightRect.y,
                left: 0,
                width: spotlightRect.x,
                height: spotlightRect.height,
              },
            ]}
            pointerEvents="none"
          />
          {/* Right */}
          <View
            style={[
              styles.backdropSlice,
              {
                top: spotlightRect.y,
                left: spotlightRect.x + spotlightRect.width,
                width:
                  screenW - (spotlightRect.x + spotlightRect.width),
                height: spotlightRect.height,
              },
            ]}
            pointerEvents="none"
          />
          {/* Highlight ring around spotlight */}
          <View
            style={[
              styles.spotlightRing,
              {
                top: spotlightRect.y,
                left: spotlightRect.x,
                width: spotlightRect.width,
                height: spotlightRect.height,
                borderRadius: SPOTLIGHT_RADIUS,
              },
            ]}
            pointerEvents="none"
          />
        </>
      ) : (
        // Full-screen backdrop when the target hasn't measured yet
        <View
          style={[
            styles.backdropSlice,
            { top: 0, left: 0, width: screenW, height: screenH },
          ]}
          pointerEvents="none"
        />
      )}

      {/* ── Callout card ── */}
      <View
        style={[
          styles.card,
          cardVerticalStyle,
          { left: CARD_MARGIN_H, right: CARD_MARGIN_H },
        ]}
      >
        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` as unknown as number }]} />
        </View>

        {/* Header row: mode badge + step counter + skip */}
        <View style={styles.cardHeader}>
          {modeBadgeText ? (
            <View style={styles.modeBadge}>
              <ThemedText style={styles.modeBadgeText}>{modeBadgeText}</ThemedText>
            </View>
          ) : null}
          <ThemedText style={styles.stepCounter}>
            {currentStepIndex + 1} / {totalSteps}
          </ThemedText>
          <Pressable
            onPress={skipTour}
            accessibilityRole="button"
            accessibilityLabel={t('tour.nav.skip')}
            style={({ pressed }) => [styles.skipButton, pressed && { opacity: 0.5 }]}
          >
            <ThemedText style={styles.skipText}>{t('tour.nav.skip')}</ThemedText>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.cardScroll}>
          {/* Cross-tab navigation prompt */}
          {isOnWrongScreen ? (
            <View style={styles.wrongScreenBanner}>
              <ThemedText style={styles.wrongScreenText}>
                {t('tour.nav.goToTab', { tab: wrongScreenTabName })}
              </ThemedText>
            </View>
          ) : null}

          {/* Step title */}
          <ThemedText style={styles.cardTitle}>{stepTitle}</ThemedText>

          {/* Step description */}
          <ThemedText style={styles.cardDesc}>{stepDesc}</ThemedText>

          {/* Interactive hint chip */}
          {currentStep?.interactiveHint ? (
            <View style={styles.hintChip}>
              <ThemedText style={styles.hintChipText}>
                {'💡 '}{currentStep.interactiveHint}
              </ThemedText>
            </View>
          ) : null}

          {/* Why this matters — expandable */}
          {stepWhy ? (
            <Pressable
              onPress={() => setWhyExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t('tour.nav.why')}
              style={styles.whyToggle}
            >
              <ThemedText style={styles.whyToggleText}>
                {whyExpanded ? '▲ ' : '▼ '}{t('tour.nav.why')}
              </ThemedText>
              {whyExpanded ? (
                <ThemedText style={styles.whyText}>{stepWhy}</ThemedText>
              ) : null}
            </Pressable>
          ) : null}
        </ScrollView>

        {/* Button row */}
        <View style={styles.buttonRow}>
          {!isFirstStep ? (
            <BackButton colors={colors} />
          ) : (
            <View style={styles.buttonSpacer} />
          )}
          <Pressable
            onPress={nextStep}
            disabled={requiresActionAndBlocked}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? t('tour.nav.finish') : t('tour.nav.next')}
            accessibilityState={{ disabled: requiresActionAndBlocked }}
            style={({ pressed }) => [
              styles.nextButton,
              requiresActionAndBlocked && styles.nextButtonDisabled,
              pressed && !requiresActionAndBlocked && { opacity: 0.85 },
            ]}
          >
            <ThemedText style={styles.nextButtonText}>
              {isLastStep ? t('tour.nav.finish') : t('tour.nav.next')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // ── Backdrop slices ─────────────────────────────────────────────────────
    backdropSlice: {
      position: 'absolute',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    // Thin highlight ring drawn on top of the transparent spotlight cutout
    spotlightRing: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: brand.primary,
    },

    // ── Callout card ──────────────────────────────────────────────────────
    card: {
      position: 'absolute',
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 8,
      maxHeight: 380,
    },
    cardScroll: {
      flexGrow: 0,
    },
    progressTrack: {
      height: 3,
      backgroundColor: colors.border,
      borderRadius: 2,
      marginBottom: 12,
      overflow: 'hidden',
    },
    progressFill: {
      height: 3,
      backgroundColor: brand.primary,
      borderRadius: 2,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
      gap: 8,
    },
    modeBadge: {
      backgroundColor: brand.primarySurface,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
    },
    modeBadgeText: {
      fontSize: 11,
      color: brand.primaryDeep,
      fontWeight: '600',
    },
    stepCounter: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
    },
    skipButton: {
      paddingVertical: 2,
      paddingHorizontal: 4,
    },
    skipText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    wrongScreenBanner: {
      backgroundColor: brand.accentSurface,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 10,
    },
    wrongScreenText: {
      fontSize: 13,
      color: brand.accentDark,
      fontWeight: '600',
    },
    cardTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    cardDesc: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: 8,
    },
    hintChip: {
      backgroundColor: brand.primarySurface,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    hintChipText: {
      fontSize: 13,
      color: brand.primaryDeep,
      lineHeight: 18,
    },
    whyToggle: {
      marginTop: 2,
      marginBottom: 4,
    },
    whyToggleText: {
      fontSize: 12,
      color: brand.primary,
      fontWeight: '600',
      marginBottom: 4,
    },
    whyText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },

    // ── Button row ────────────────────────────────────────────────────────
    buttonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
      gap: 12,
    },
    textButton: {
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    textButtonLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    buttonSpacer: {
      width: 60,
    },
    nextButton: {
      flex: 1,
      backgroundColor: brand.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    nextButtonDisabled: {
      backgroundColor: colors.border,
    },
    nextButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#FFFFFF',
    },

    // ── GuideModePicker ───────────────────────────────────────────────────
    roleBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center',
    },
    roleScrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 20,
    },
    roleCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 10,
    },
    roleLangLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 8,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    langRow: {
      flexDirection: 'row',
      gap: 8,
      paddingBottom: 4,
    },
    langChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    langChipSelected: {
      borderColor: brand.primary,
      backgroundColor: brand.primarySurface,
    },
    langChipFlag: {
      fontSize: 16,
    },
    langChipText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    langChipTextSelected: {
      color: brand.primaryDeep,
      fontWeight: '600',
    },
    roleDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
    },
    roleTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
      textAlign: 'center',
    },
    roleDesc: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 16,
      lineHeight: 20,
    },
    modeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    modeButton: {
      width: '47%',
      backgroundColor: colors.background,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
    },
    modeButtonPressed: {
      backgroundColor: brand.primarySurface,
      borderColor: brand.primary,
    },
    modeEmoji: {
      fontSize: 28,
      marginBottom: 6,
    },
    modeTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 4,
    },
    modeDesc: {
      fontSize: 11,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 15,
    },
  });