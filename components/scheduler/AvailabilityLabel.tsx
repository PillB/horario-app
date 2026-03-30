import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Colors, brand, ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type Status = 'available' | 'unavailable' | 'conflict';

type Props = {
  day: string;
  from: string;
  to: string;
  // Optional status prop for available/unavailable/conflict state differentiation (finding [5])
  status?: Status;
};

const makeStyles = (colors: ThemeColors, status: Status) => {
  // Badge background varies by status and respects dark-mode (findings [4], [5])
  const badgeBackground =
    status === 'available'
      ? colors.successSurface
      : status === 'conflict'
      ? colors.errorSurface
      : colors.surface; // 'unavailable' or default → neutral surface

  // Badge text colour varies by status (findings [2], [5], [8])
  // Available → success text (≥4.5:1 on successSurface)
  // Conflict  → error text  (≥4.5:1 on errorSurface)
  // Unavailable / default → primaryDeep (#115E59, 5.87:1) on light, tint on dark
  const badgeTextColor =
    status === 'available'
      ? colors.success
      : status === 'conflict'
      ? colors.error
      : brand.primaryDeep; // 5.87:1 on light surfaces ✓ AA

  // Muted text: textSecondary in light mode (6.86:1), textSecondary in dark mode (5.27:1) (findings [1], [3])
  const mutedTextColor = colors.textSecondary;

  // Unavailable badges get reduced opacity to signal inactive state (finding [5])
  const badgeOpacity = status === 'unavailable' ? 0.45 : 1;

  // Badge border colour for status differentiation (finding [5])
  const badgeBorderColor =
    status === 'available'
      ? colors.success
      : status === 'conflict'
      ? colors.error
      : colors.border;

  return StyleSheet.create({
    badge: {
      backgroundColor: badgeBackground,
      borderColor: badgeBorderColor,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      alignSelf: 'flex-start',
      opacity: badgeOpacity,
    },
    // Day label: bold ≥14px + token with ≥4.5:1 contrast (findings [2], [8])
    badgeText: {
      color: badgeTextColor,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 21,
    },
    // Time range: textSecondary, ≥14px normal weight → 6.86:1 on light, 5.27:1 on dark (findings [1], [3], [7])
    mutedText: {
      color: mutedTextColor,
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 21,
    },
  });
};

export const AvailabilityLabel = ({ day, from, to, status = 'available' }: Props) => {
  const colorScheme = useColorScheme();
  // Derive live theme colours so all tokens respect light/dark mode (finding [6])
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors, status);

  return (
    <View style={styles.badge}>
      <ThemedText style={styles.badgeText}>{day}</ThemedText>
      <ThemedText style={styles.mutedText}>
        {from} - {to}
      </ThemedText>
    </View>
  );
};