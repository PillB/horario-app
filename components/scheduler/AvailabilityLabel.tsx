import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type Props = {
  day: string;
  from: string;
  to: string;
};

export const AvailabilityLabel = ({ day, from, to }: Props) => (
  <View style={styles.badge}>
    <ThemedText style={styles.badgeText}>{day}</ThemedText>
    <ThemedText style={styles.mutedText}>
      {from} - {to}
    </ThemedText>
  </View>
);
