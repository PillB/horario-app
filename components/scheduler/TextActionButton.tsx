/**
 * A small text button for a row or form action that is not the primary one
 * ("Edit", "Cancel"). Teal text on the surface, sized like ConfirmRemoveButton.
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type Props = {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  testID?: string;
};

const styles = StyleSheet.create({
  button: {
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  label: { fontSize: 13, fontWeight: '600' },
});

export const TextActionButton = ({ label, onPress, accessibilityLabel, accessibilityHint, testID }: Props) => {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [styles.button, { borderColor: colors.border }, pressed && styles.pressed]}
    >
      <ThemedText style={[styles.label, { color: colors.tintText }]}>{label}</ThemedText>
    </Pressable>
  );
};
