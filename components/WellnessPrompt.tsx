import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';

type WellnessPromptProps = {
  visible: boolean;
  minutesActive: number;
  onDismiss: () => void;
  onTakeBreak: () => void;
};

export const WellnessPrompt = ({ visible, minutesActive, onDismiss, onTakeBreak }: WellnessPromptProps) => {
  const colorScheme = useColorScheme();
  const styles = makeStyles(colorScheme ?? 'light');

  if (!visible) return null;

  const roundedMinutes = Math.max(0, minutesActive);

  return (
    <ThemedView style={styles.wrapper} accessibilityRole="alert" accessibilityLabel="Mindful break reminder">
      <View style={styles.copy}>
        <ThemedText type="subtitle" style={{ color: '#FFFFFF' }}>Time for a mindful pause</ThemedText>
        <ThemedText style={styles.bodyText}>
          You have been focused for {roundedMinutes} minute{roundedMinutes === 1 ? '' : 's'}. Take a moment to stretch,
          hydrate, or review the plan before continuing.
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          style={({ pressed }) => [styles.button, styles.secondary, pressed && { opacity: 0.75 }]}
          accessibilityLabel="Dismiss break reminder"
        >
          <ThemedText style={styles.secondaryText}>Not now</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onTakeBreak}
          style={({ pressed }) => [styles.button, styles.primary, pressed && { opacity: 0.75 }]}
          accessibilityLabel="Take a short break"
        >
          <ThemedText style={styles.primaryText}>Take a 3-minute reset</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
};

const makeStyles = (colorScheme: 'light' | 'dark') => {
  const cardBackground = colorScheme === 'dark' ? brand.proDark : brand.pro;
  const shadowColor = colorScheme === 'dark' ? '#000000' : '#1E293B';

  return StyleSheet.create({
    wrapper: {
      borderRadius: 14,
      padding: 16,
      gap: 12,
      backgroundColor: cardBackground,
      shadowColor: shadowColor,
      shadowOpacity: Platform.OS === 'ios' ? 0.12 : 0.2,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 12,
      elevation: 5,
      marginBottom: 16,
    },
    copy: {
      gap: 6,
    },
    bodyText: {
      color: '#FFFFFF',
      lineHeight: 24,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
    },
    button: {
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 10,
      minHeight: 44,
    },
    primary: {
      backgroundColor: Colors.light.surface,
    },
    primaryText: {
      color: brand.primaryDeep,
      fontWeight: '700',
    },
    secondary: {
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
    },
    secondaryText: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
  });
};