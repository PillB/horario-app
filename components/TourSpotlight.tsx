import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { brand, Colors, type ThemeColors } from '@/constants/Colors';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';

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

/** Role selection card shown before the tour starts */
function RoleSelectionModal({ colors }: { colors: ThemeColors }) {
  const { setUserRole } = useWelcomeTour();
  const { t } = useT();
  const styles = makeStyles(colors);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.roleBackdrop}>
        <View style={styles.roleCard}>
          <ThemedText style={styles.roleTitle}>
            {t('tour.roleSelect.title')}
          </ThemedText>
          <ThemedText style={styles.roleDesc}>
            {t('tour.roleSelect.desc')}
          </ThemedText>

          <Pressable
            onPress={() => setUserRole('manager')}
            accessibilityRole="button"
            accessibilityLabel={t('tour.roleSelect.managerTitle')}
            style={({ pressed }) => [
              styles.roleOptionButton,
              pressed && styles.roleOptionButtonPressed,
            ]}
          >
            <ThemedText style={styles.roleOptionTitle}>
              {t('tour.roleSelect.managerTitle')}
            </ThemedText>
            <ThemedText style={styles.roleOptionDesc}>
              {t('tour.roleSelect.managerDesc')}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setUserRole('worker')}
            accessibilityRole="button"
            accessibilityLabel={t('tour.roleSelect.workerTitle')}
            style={({ pressed }) => [
              styles.roleOptionButton,
              pressed && styles.roleOptionButtonPressed,
            ]}
          >
            <ThemedText style={styles.roleOptionTitle}>
              {t('tour.roleSelect.workerTitle')}
            </ThemedText>
            <ThemedText style={styles.roleOptionDesc}>
              {t('tour.roleSelect.workerDesc')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function TourSpotlight() {
  const {
    isActive,
    userRole,
    currentStep,
    currentStepIndex,
    totalSteps,
    stepLayouts,
    canAdvance,
    progressPercent,
    nextStep,
    skipTour,
  } = useWelcomeTour();

  const { t } = useT();
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
        top: spotlightRect.y + spotlightRect.height + SPOTLIGHT_PADDING + CARD_BELOW_GAP,
      };
    }
    return { bottom: screenH - spotlightRect.y + CARD_ABOVE_GAP };
  }, [spotlightRect, screenH]);

  const isLastStep = currentStepIndex === totalSteps - 1;
  const isFirstStep = currentStepIndex === 0;

  const roleKey = userRole === 'worker' ? 'worker' : 'manager';
  const stepId = currentStep?.id ?? '';

  const stepTitle = currentStep ? t(`tour.${roleKey}.step${stepId}.title`) : '';
  const stepDesc = currentStep ? t(`tour.${roleKey}.step${stepId}.desc`) : '';
  const stepWhy = currentStep ? t(`tour.${roleKey}.step${stepId}.why`) : '';

  const roleBadgeText =
    userRole === 'manager'
      ? '👔 Manager'
      : userRole === 'worker'
      ? '👷 Team Member'
      : null;

  const requiresActionAndBlocked =
    currentStep?.requiresAction === true && !canAdvance;

  if (!isActive) return null;

  // Show role selection if no role chosen yet
  if (userRole === null) {
    return <RoleSelectionModal colors={colors} />;
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
                height: screenH - (spotlightRect.y + spotlightRect.height),
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
                width: screenW - (spotlightRect.x + spotlightRect.width),
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
        <View style={styles.fullBackdrop} pointerEvents="none" />
      )}

      {/* ── Callout card ── */}
      <View
        style={[
          styles.card,
          { position: 'absolute', left: CARD_MARGIN_H, right: CARD_MARGIN_H },
          cardVerticalStyle,
        ]}
        accessibilityRole="alert"
        accessibilityLabel={`Tour step ${currentStepIndex + 1} of ${totalSteps}: ${stepTitle}`}
      >
        {/* Progress bar */}
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${progressPercent}%` },
            ]}
          />
        </View>

        {/* Step counter row with role badge */}
        <View style={styles.headerRow}>
          <ThemedText style={styles.stepCounter}>
            {t('tour.nav.stepOf', {
              current: String(currentStepIndex + 1),
              total: String(totalSteps),
            })}
          </ThemedText>
          {roleBadgeText !== null && (
            <View style={styles.roleBadge}>
              <ThemedText style={styles.roleBadgeText}>
                {roleBadgeText}
              </ThemedText>
            </View>
          )}
        </View>

        <ThemedText style={styles.title}>{stepTitle}</ThemedText>

        <ThemedText style={styles.description}>{stepDesc}</ThemedText>

        {/* Why this matters expandable section */}
        {stepWhy !== '' && (
          <View style={styles.whySection}>
            <Pressable
              onPress={() => setWhyExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel={
                whyExpanded
                  ? t('tour.nav.hide')
                  : t('tour.nav.whyMatters')
              }
              style={({ pressed }) => [
                styles.whyToggleButton,
                pressed && { opacity: 0.6 },
              ]}
            >
              <ThemedText style={styles.whyToggleLabel}>
                {whyExpanded
                  ? `▲  ${t('tour.nav.hide')}`
                  : `▼  ${t('tour.nav.whyMatters')}`}
              </ThemedText>
            </Pressable>
            {whyExpanded && (
              <View style={styles.whyContent}>
                <ThemedText style={styles.whyText}>{stepWhy}</ThemedText>
              </View>
            )}
          </View>
        )}

        {/* Button row */}
        <View style={styles.buttonRow}>
          <View style={styles.leftButtons}>
            {!isFirstStep && <BackButton colors={colors} />}
            {!isLastStep && (
              <Pressable
                onPress={skipTour}
                accessibilityRole="button"
                accessibilityLabel={t('tour.nav.skip')}
                accessibilityHint="Closes the welcome tour immediately"
                style={({ pressed }) => [
                  styles.textButton,
                  pressed && { opacity: 0.5 },
                ]}
              >
                <ThemedText style={styles.textButtonLabel}>
                  {t('tour.nav.skip')}
                </ThemedText>
              </Pressable>
            )}
          </View>

          {requiresActionAndBlocked ? (
            <View style={styles.actionPromptContainer}>
              <ThemedText style={styles.actionPromptLabel}>
                {t('tour.nav.actionPrompt')}
              </ThemedText>
            </View>
          ) : (
            <Pressable
              onPress={nextStep}
              accessibilityRole="button"
              accessibilityLabel={
                isLastStep ? t('tour.nav.done') : t('tour.nav.next')
              }
              accessibilityHint={
                isLastStep
                  ? 'Finishes the welcome tour'
                  : 'Advances to the next tour step'
              }
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <ThemedText style={styles.primaryButtonLabel}>
                {isLastStep ? t('tour.nav.done') : t('tour.nav.next')}
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdropSlice: {
      position: 'absolute',
      backgroundColor: 'rgba(0,0,0,0.65)',
    },
    fullBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.65)',
    },
    spotlightRing: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.75)',
      backgroundColor: 'transparent',
    },

    // Role selection
    roleBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    roleCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      width: '100%',
      shadowColor: colors.border,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 8,
    },
    roleTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: brand.primaryDeep,
      marginBottom: 8,
      textAlign: 'center',
    },
    roleDesc: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
    },
    roleOptionButton: {
      borderWidth: 2,
      borderColor: brand.primary,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    roleOptionButtonPressed: {
      backgroundColor: brand.primary + '18',
      opacity: 0.85,
    },
    roleOptionTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: brand.primaryDeep,
      marginBottom: 4,
    },
    roleOptionDesc: {
      fontSize: 14,
      color: colors.textSecondary,
    },

    // Callout card
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      shadowColor: colors.border,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 8,
    },

    // Progress bar
    progressBarTrack: {
      width: '100%',
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.border,
      marginBottom: 12,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: 6,
      borderRadius: 3,
      backgroundColor: brand.primary,
    },

    // Header row
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    stepCounter: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    roleBadge: {
      backgroundColor: brand.primary + '22',
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    roleBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: brand.primaryDeep,
    },

    title: {
      fontSize: 18,
      fontWeight: '700',
      color: brand.primaryDeep,
      marginBottom: 8,
    },
    description: {
      fontSize: 16,
      lineHeight: 24,
      color: colors.textSecondary,
      marginBottom: 12,
    },

    // Why this matters
    whySection: {
      marginBottom: 16,
    },
    whyToggleButton: {
      paddingVertical: 6,
    },
    whyToggleLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: brand.primary,
    },
    whyContent: {
      marginTop: 8,
      borderLeftWidth: 3,
      borderLeftColor: brand.primary,
      paddingLeft: 10,
    },
    whyText: {
      fontSize: 14,
      fontStyle: 'italic',
      color: colors.textSecondary,
      lineHeight: 20,
    },

    // Buttons
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
    },
    leftButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    textButton: {
      paddingVertical: 14,
      paddingHorizontal: 12,
    },
    textButtonLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    primaryButton: {
      backgroundColor: brand.primary,
      borderRadius: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    primaryButtonPressed: {
      backgroundColor: brand.primaryDeep,
      opacity: 0.85,
      transform: [{ scale: 0.97 }],
    },
    primaryButtonLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.surface,
    },
    actionPromptContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    actionPromptLabel: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });