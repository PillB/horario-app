import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { InfoTooltip } from '@/components/InfoTooltip';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';

type Props = {
  title: string;
  subtitle?: string;
  tooltip?: string;
  children: React.ReactNode;
};

export const SectionCard = ({ title, subtitle, tooltip, children }: Props) => (
  <ThemedView style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <ThemedText type="subtitle" style={{ flexShrink: 1 }}>{title}</ThemedText>
        {tooltip ? <InfoTooltip content={tooltip} label={`Help for ${title}`} /> : null}
      </View>
      {subtitle ? <ThemedText style={styles.mutedText}>{subtitle}</ThemedText> : null}
    </View>
    {children}
  </ThemedView>
);
