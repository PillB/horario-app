/**
 * TourSpotlight — the guide picker and the step card of a running guide.
 *
 * The step card is not a modal: the app stays usable while a guide runs, which
 * the scheduler guide needs (the user fills in real forms). For each step it
 * opens the step's screen, scrolls the target into view, and draws a ring
 * around it at its measured window position, re-measured while the step shows.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { brand, Colors, type ThemeColors } from '@/constants/Colors';
import {
  useWelcomeTour,
  type TourMode,
  type TourStepMeta,
} from '@/contexts/WelcomeTourContext';
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

const RING_PADDING = 6;
const RING_RADIUS = 12;
const MEASURE_INTERVAL_MS = 200;
/** Card width on wide screens; on phones it spans the screen. */
const CARD_MAX_WIDTH = 420;
/** Space kept clear of the tab bar. */
const CARD_BOTTOM = 72;

type Rect = { x: number; y: number; width: number; height: number };

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1);

/** True when the current path is the step's screen. */
export function pathMatchesRoute(pathname: string, route: TourStepMeta['route']): boolean {
  if (route === '/') return pathname === '/' || pathname === '' || pathname.endsWith('/index');
  return pathname === route || pathname.endsWith(route);
}

/**
 * Where the current step's target is on screen, or null while it is not
 * mounted or not visible. Scrolls it into view once per step (web).
 */
function useTargetRect(step: TourStepMeta | null, ready: boolean): Rect | null {
  const { getTarget } = useWelcomeTour();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [rect, setRect] = useState<Rect | null>(null);
  const scrolledForRef = useRef<TourStepMeta | null>(null);

  useEffect(() => {
    setRect(null);
    if (!step || !ready) return undefined;
    let cancelled = false;

    const measure = () => {
      const node = getTarget(step.target)?.current;
      if (!node) {
        setRect((prev) => (prev === null ? prev : null));
        return;
      }
      if (scrolledForRef.current !== step) {
        scrolledForRef.current = step;
        if (Platform.OS === 'web') {
          const el = node as unknown as {
            scrollIntoView?: (o: { block: 'start' | 'center'; behavior: 'smooth' }) => void;
            getBoundingClientRect?: () => { height: number };
          };
          const tall = (el.getBoundingClientRect?.().height ?? 0) > screenH * 0.5;
          el.scrollIntoView?.({ block: tall ? 'start' : 'center', behavior: 'smooth' });
        }
      }
      node.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        const visible = width > 0 && height > 0 && y < screenH && y + height > 0 && x < screenW && x + width > 0;
        const next = visible ? { x, y, width, height } : null;
        setRect((prev) => (sameRect(prev, next) ? prev : next));
      });
    };

    measure();
    const timer = setInterval(measure, MEASURE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, ready, getTarget, screenW, screenH]);

  return rect;
}

/** Guide mode picker shown before the tour starts */
function GuideModePicker({ colors }: { colors: ThemeColors }) {
  const { startTourMode, skipTour } = useWelcomeTour();
  const { t, langCode, setLanguage } = useT();
  const styles = makeStyles(colors);

  const modes: {
    mode: TourMode;
    emoji: string;
    title: string;
    desc: string;
  }[] = [
    {
      mode: 'overview',
      emoji: '🗺️',
      title: t('tour.mode.overview'),
      desc: t('tour.mode.overviewDesc'),
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
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={skipTour}>
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
              accessibilityRole="radiogroup"
              accessibilityLabel={t('tour.roleSelect.languageLabel')}
            >
              {LANG_CODES.map((code) => {
                const meta = LANG_META[code];
                const selected = code === langCode;
                return (
                  <Pressable
                    key={code}
                    onPress={() => setLanguage(code)}
                    accessibilityRole="radio"
                    aria-checked={selected}
                    accessibilityLabel={meta.native}
                    accessibilityHint={t('language.selectorHint')}
                    style={({ pressed }) => [
                      styles.langChip,
                      selected && styles.langChipSelected,
                      pressed && styles.pressed,
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

            {/* Without this the first-run picker can only be left by starting a tour. */}
            <Pressable
              onPress={skipTour}
              accessibilityRole="button"
              accessibilityLabel={t('tour.nav.skip')}
              accessibilityHint={t('tour.nav.skipHint')}
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            >
              <ThemedText style={styles.textButtonLabel}>{t('tour.nav.skip')}</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}


export function TourSpotlight() {
  const {
    isActive,
    tourMode,
    currentStep,
    currentStepIndex,
    totalSteps,
    progressPercent,
    nextStep,
    prevStep,
    skipTour,
  } = useWelcomeTour();

  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Take the user to the step's screen (and scheduler step) when it changes.
  useEffect(() => {
    if (!currentStep) return;
    const href = currentStep.section
      ? { pathname: currentStep.route, params: { section: currentStep.section } }
      : currentStep.route;
    router.navigate(href as Href);
    // Only when the step changes: the user may look around while it shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // Escape closes the guide on web.
  useEffect(() => {
    if (!isActive || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skipTour();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isActive, skipTour]);

  const onStepScreen = currentStep ? pathMatchesRoute(pathname, currentStep.route) : false;
  const rect = useTargetRect(currentStep, isActive && onStepScreen);

  if (!isActive) return null;
  if (tourMode === null) return <GuideModePicker colors={colors} />;
  if (!currentStep) return null;

  const isLastStep = currentStepIndex === totalSteps - 1;
  const isFirstStep = currentStepIndex === 0;
  const stepTitle = t(`tour.${tourMode}.step${currentStep.id}.title`);
  const stepDesc = t(`tour.${tourMode}.step${currentStep.id}.desc`);

  const ring = rect
    ? {
        left: Math.max(0, rect.x - RING_PADDING),
        top: Math.max(0, rect.y - RING_PADDING),
        width: Math.min(screenW, rect.x + rect.width + RING_PADDING) - Math.max(0, rect.x - RING_PADDING),
        height: Math.min(screenH, rect.y + rect.height + RING_PADDING) - Math.max(0, rect.y - RING_PADDING),
      }
    : null;

  const wide = screenW >= 600;

  return (
    <View style={styles.overlay} testID="tour-overlay">
      {ring ? <View style={[styles.spotlightRing, ring]} testID="tour-ring" /> : null}

      <View
        style={[styles.card, wide ? styles.cardWide : styles.cardNarrow]}
        role="dialog"
        aria-label={stepTitle}
        testID="tour-card"
      >
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>

        <View style={styles.cardHeader}>
          <View style={styles.modeBadge}>
            <ThemedText style={styles.modeBadgeText}>{t(`tour.mode.${tourMode}`)}</ThemedText>
          </View>
          <ThemedText style={styles.stepCounter}>
            {t('tour.nav.stepOf', { current: String(currentStepIndex + 1), total: String(totalSteps) })}
          </ThemedText>
          <Pressable
            onPress={skipTour}
            accessibilityRole="button"
            accessibilityLabel={t('tour.nav.skip')}
            accessibilityHint={t('tour.nav.skipHint')}
            hitSlop={8}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.skipText}>{t('tour.nav.skip')}</ThemedText>
          </Pressable>
        </View>

        <ThemedText style={styles.cardTitle} accessibilityRole="header" aria-live="polite">
          {stepTitle}
        </ThemedText>
        <ThemedText style={styles.cardDesc}>{stepDesc}</ThemedText>

        <View style={styles.buttonRow}>
          {!isFirstStep ? (
            <Pressable
              onPress={prevStep}
              accessibilityRole="button"
              accessibilityLabel={t('tour.nav.back')}
              accessibilityHint={t('tour.nav.backHint')}
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            >
              <ThemedText style={styles.textButtonLabel}>{t('tour.nav.back')}</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={nextStep}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? t('tour.nav.done') : t('tour.nav.next')}
            accessibilityHint={t('tour.nav.nextHint')}
            testID="tour-next"
            style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.nextButtonText}>
              {isLastStep ? t('tour.nav.done') : t('tour.nav.next')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Covers the screen but lets every touch through to the app.
    overlay: {
      ...StyleSheet.absoluteFillObject,
      pointerEvents: 'box-none',
      zIndex: 1000,
    },
    // Ring around the target; never takes touches.
    spotlightRing: {
      position: 'absolute',
      borderWidth: 3,
      borderColor: brand.primary,
      borderRadius: RING_RADIUS,
      boxShadow: '0 0 0 4px rgba(13,148,136,0.25)',
      pointerEvents: 'none',
    },
    pressed: {
      opacity: 0.7,
    },

    // ── Callout card ──────────────────────────────────────────────────────
    card: {
      position: 'absolute',
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
      boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
      elevation: 8,
      bottom: CARD_BOTTOM,
    },
    cardNarrow: {
      left: 12,
      right: 12,
    },
    cardWide: {
      right: 24,
      width: CARD_MAX_WIDTH,
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
    nextButton: {
      flex: 1,
      backgroundColor: brand.primaryDark,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
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
      boxShadow: '0 6px 16px rgba(0,0,0,0.2)',
      elevation: 10,
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
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
      flexGrow: 1,
      flexBasis: 150,
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