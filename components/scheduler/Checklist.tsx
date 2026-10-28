import React from 'react';
import { View, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type OnboardingStep } from '@/types/scheduler';
import { schedulerStyles } from '@/styles/scheduler.styles';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';

type Props = {
  steps: OnboardingStep[];
  progress: number;
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Fix [1] & [5]: mutedText uses textSecondary instead of textTertiary for informational body text
    mutedText: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    // Fix [2] & [6]: badge background darkened to primaryDeep so white text passes AA
    progressBadge: {
      backgroundColor: brand.primaryDeep,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    },
    // Fix [7]: track background uses Slate 400 (#94A3B8) for 3:1+ non-text contrast
    progressTrack: {
      height: 6,
      backgroundColor: '#94A3B8',
      borderRadius: 3,
      marginVertical: 10,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: brand.primary,
      borderRadius: 3,
    },
    // Fix [8]: incomplete indicator border uses Slate 400 (#94A3B8) for 3:1+ non-text contrast
    stepIndicator: {
      width: 28,
      height: 28,
      borderRadius: 14,
      // Fix [3]: background darkened to Slate 600 (#475569) so white numerals pass AA
      backgroundColor: '#475569',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepIndicatorDone: {
      backgroundColor: brand.primaryDark,
    },
    stepIndicatorText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    // Fix [4]: link text uses primaryDeep for AA compliance on white surface, with underline
    linkText: {
      color: brand.primaryDeep,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
  });

export const Checklist = ({ steps, progress }: Props) => {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  return (
    <ThemedView style={schedulerStyles.onboardingCard}>
      <View style={schedulerStyles.rowBetween}>
        <View>
          <ThemedText type="subtitle">{t('scheduler.onboarding.title')}</ThemedText>
          <ThemedText style={styles.mutedText}>
            {t('scheduler.onboarding.subtitle')}
          </ThemedText>
        </View>
        <View style={styles.progressBadge}>
          <ThemedText style={styles.badgeText}>{Math.round(progress * 100)}%</ThemedText>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 6)}%` }]} />
      </View>
      {steps.map((step, index) => (
        <Pressable
          key={step.key}
          onPress={step.onPress}
          style={[schedulerStyles.rowBetween, schedulerStyles.onboardingStep]}
          accessibilityRole="button"
          accessibilityLabel={step.completed ? t('scheduler.onboarding.completedA11y', { step: step.title }) : step.title}
        >
          <View style={[styles.stepIndicator, step.completed && styles.stepIndicatorDone]}>
            <ThemedText style={styles.stepIndicatorText}>
              {step.completed ? '✓' : index + 1}
            </ThemedText>
          </View>
          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <ThemedText type="defaultSemiBold">{step.title}</ThemedText>
            <ThemedText style={styles.mutedText}>{step.description}</ThemedText>
          </View>
          <ThemedText style={styles.linkText}>
            {step.completed ? t('scheduler.onboarding.stepDone') : step.actionLabel}
          </ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
};