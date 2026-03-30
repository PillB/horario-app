/**
 * TourSpotlight — full-screen Modal overlay that highlights the current
 * welcome-tour step with a transparent "spotlight" cutout in the backdrop.
 *
 * Reads all state from useWelcomeTour(). Renders nothing when the tour
 * is not active. The spotlight hole is implemented as four opaque rectangles
 * surrounding the measured target rect — no SVG or Canvas required.
 *
 * Callout card positioning:
 *   - Below the spotlight when ≥ 200 px of space remains beneath it.
 *   - Above the spotlight otherwise.
 *   - Centered vertically when no layout has been registered for the step.
 */

import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { brand, Colors, type ThemeColors } from '@/constants/Colors';
import { useWelcomeTour, TOUR_STEPS } from '@/contexts/WelcomeTourContext';
import { useColorScheme } from '@/hooks/useColorScheme';

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const CARD_MARGIN_H = 24;
const CARD_BELOW_GAP = 16;
const CARD_ABOVE_GAP = 16;
const MIN_SPACE_BELOW = 200;
const TOTAL_STEPS = TOUR_STEPS.length;

/** Sub-component so prevStep is called at the hook call-site, not in a callback. */
function BackButton({ colors }: { colors: ThemeColors }) {
  const { prevStep } = useWelcomeTour();
  const styles = makeStyles(colors);
  return (
    <Pressable
      onPress={prevStep}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      accessibilityHint="Returns to the previous tour step"
      style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.5 }]}
    >
      <ThemedText style={styles.textButtonLabel}>← Back</ThemedText>
    </Pressable>
  );
}

export function TourSpotlight() {
  const {
    isActive,
    currentStep,
    currentStepIndex,
    stepLayouts,
    nextStep,
    skipTour,
  } = useWelcomeTour();

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  const { width: screenW, height: screenH } = useWindowDimensions();

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

  const isLastStep = currentStepIndex === TOTAL_STEPS - 1;
  const isFirstStep = currentStepIndex === 0;

  if (!isActive || !currentStep) return null;

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
            style={[styles.backdropSlice, { top: 0, left: 0, width: screenW, height: spotlightRect.y }]}
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
              { top: spotlightRect.y, left: 0, width: spotlightRect.x, height: spotlightRect.height },
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
        style={[styles.card, { position: 'absolute', left: CARD_MARGIN_H, right: CARD_MARGIN_H }, cardVerticalStyle]}
        accessibilityRole="alert"
        accessibilityLabel={`Tour step ${currentStepIndex + 1} of ${TOTAL_STEPS}: ${currentStep.title}`}
      >
        <ThemedText style={styles.stepCounter}>
          {`Step ${currentStepIndex + 1} of ${TOTAL_STEPS}`}
        </ThemedText>

        <ThemedText style={styles.title}>{currentStep.title}</ThemedText>

        <ThemedText style={styles.description}>{currentStep.description}</ThemedText>

        <View style={styles.buttonRow}>
          <View style={styles.leftButtons}>
            {!isFirstStep && <BackButton colors={colors} />}
            {!isLastStep && (
              <Pressable
                onPress={skipTour}
                accessibilityRole="button"
                accessibilityLabel="Skip tour"
                accessibilityHint="Closes the welcome tour immediately"
                style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.5 }]}
              >
                <ThemedText style={styles.textButtonLabel}>Skip tour</ThemedText>
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={nextStep}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? 'Done' : 'Next step'}
            accessibilityHint={
              isLastStep ? 'Finishes the welcome tour' : 'Advances to the next tour step'
            }
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <ThemedText style={styles.primaryButtonLabel}>
              {isLastStep ? 'Done ✓' : 'Next →'}
            </ThemedText>
          </Pressable>
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
      // Increased from 0.35 to 0.75 to meet 3:1 non-text contrast requirement
      borderColor: 'rgba(255,255,255,0.75)',
      backgroundColor: 'transparent',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      // Resolved dynamically; in dark mode rely on surfaceRaised elevation cues
      shadowColor: colors.border,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 8,
    },
    stepCounter: {
      // Increased from 12px to 14px for ambient-light readability
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      // brand.primaryDeep (#115E59) achieves 5.87:1 on white — passes AA
      color: brand.primaryDeep,
      marginBottom: 8,
    },
    description: {
      // Increased from 14px to 16px for ambient-light mobile readability
      fontSize: 16,
      lineHeight: 24,
      color: colors.textSecondary,
      marginBottom: 20,
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    leftButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    textButton: {
      // Increased from paddingVertical:6 to paddingVertical:14 to achieve ≥44px touch target
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
      // brand.primaryDeep (#115E59) increases color delta significantly vs primaryDark
      backgroundColor: brand.primaryDeep,
      opacity: 0.85,
      transform: [{ scale: 0.97 }],
    },
    primaryButtonLabel: {
      fontSize: 14,
      fontWeight: '600',
      // Use colors.surface token instead of hardcoded '#FFFFFF'
      color: colors.surface,
    },
  });