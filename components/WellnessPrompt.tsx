import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';

type WellnessPromptProps = {
  visible: boolean;
  minutesActive: number;
  onDismiss: () => void;
  onTakeBreak: () => void;
};

export const WellnessPrompt = ({ visible, minutesActive, onDismiss, onTakeBreak }: WellnessPromptProps) => {
  if (!visible) return null;

  const roundedMinutes = Math.max(0, minutesActive);

  return (
    <ThemedView style={styles.wrapper} accessibilityRole="alert" accessibilityLabel="Mindful break reminder">
      <View style={styles.copy}>
        <ThemedText type="subtitle">Time for a mindful pause</ThemedText>
        <ThemedText style={styles.bodyText}>
          You have been focused for {roundedMinutes} minute{roundedMinutes === 1 ? '' : 's'}. Take a moment to stretch,
          hydrate, or review the plan before continuing.
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onDismiss} style={[styles.button, styles.secondary]}
          accessibilityLabel="Dismiss break reminder">
          <ThemedText style={styles.secondaryText}>Not now</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onTakeBreak}
          style={[styles.button, styles.primary]}
          accessibilityLabel="Take a short break"
        >
          <ThemedText style={styles.primaryText}>Take a 3-minute reset</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 14,
    padding: 16,
    gap: 12,
    backgroundColor: '#0b5ad3',
    shadowColor: '#000000',
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
    color: '#E5E7EB',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  primary: {
    backgroundColor: '#ffffff',
  },
  primaryText: {
    color: '#0b5ad3',
    fontWeight: '700',
  },
  secondary: {
    backgroundColor: '#ffffff22',
    borderWidth: 1,
    borderColor: '#ffffff44',
  },
  secondaryText: {
    color: '#E5E7EB',
    fontWeight: '600',
  },
});
