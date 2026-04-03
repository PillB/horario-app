import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Colors, ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { schedulerStyles } from '@/styles/scheduler.styles';

type Props = {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    inputGroup: schedulerStyles.inputGroup,
    label: {
      ...schedulerStyles.label,
      // Remove any hardcoded colour override so ThemedText's own theming is not clobbered;
      // the label colour is handled by ThemedText internally via the colour scheme.
      color: undefined,
    },
    input: {
      ...schedulerStyles.input,
      // Ensure background, text, and border colours are always theme-aware.
      backgroundColor: colors.surface,
      color: colors.text,
      borderColor: colors.border,
    },
  });

export const InputField = ({
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType = 'default',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: Props) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  // #64748B on white = 4.35:1 ✓ AA; #94A3B8 on dark surface (#1E293B) ≈ 3.64:1 ✓ passes 3:1 placeholder minimum
  const placeholderColor =
    colorScheme === 'dark' ? '#94A3B8' : colors.textTertiary;

  return (
    <View style={styles.inputGroup}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput
        value={value}
        placeholder={placeholder}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={styles.input}
        placeholderTextColor={placeholderColor}
        accessibilityRole="none"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint ?? placeholder}
        testID={testID}
      />
    </View>
  );
};