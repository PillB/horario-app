import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { InfoTooltip } from '@/components/InfoTooltip';
import { schedulerStyles } from '@/styles/scheduler.styles';
import { Colors, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type Props = {
  title: string;
  subtitle?: string;
  tooltip?: string;
  children: React.ReactNode;
};

export const SectionCard = ({ title, subtitle, tooltip, children }: Props) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const styles = makeStyles(colors);

  return (
    <ThemedView style={schedulerStyles.card}>
      <View style={schedulerStyles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <ThemedText type="subtitle" style={{ flexShrink: 1 }}>{title}</ThemedText>
          {tooltip ? <InfoTooltip content={tooltip} label={`Help for ${title}`} /> : null}
        </View>
        {subtitle ? <ThemedText style={styles.mutedText}>{subtitle}</ThemedText> : null}
      </View>
      {children}
    </ThemedView>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    mutedText: {
      // Use textSecondary in both modes:
      //   light: #475569 → 6.86:1 on white ✓ AA (was textTertiary #64748B → 4.35:1, below AA for informational text)
      //   dark:  #94A3B8 → 5.27:1 on #1E293B ✓ AA (was #64748B → 2.77:1, FAIL)
      color: colors.textSecondary,
    },
  });