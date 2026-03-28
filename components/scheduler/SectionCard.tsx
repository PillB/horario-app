import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export const SectionCard = ({ title, subtitle, children }: Props) => (
  <ThemedView style={styles.card}>
    <View style={styles.cardHeader}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {subtitle ? <ThemedText style={styles.mutedText}>{subtitle}</ThemedText> : null}
    </View>
    {children}
  </ThemedView>
);
