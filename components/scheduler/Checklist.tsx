import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type OnboardingStep } from '@/types/scheduler';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';

type Props = {
  steps: OnboardingStep[];
  progress: number;
};

export const Checklist = ({ steps, progress }: Props) => {
  const { t } = useT();
  return (
    <ThemedView style={styles.onboardingCard}>
      <View style={styles.rowBetween}>
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
          style={[styles.rowBetween, styles.onboardingStep]}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.onboarding.completedA11y', { step: step.title }) + (step.completed ? '' : '')}
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
