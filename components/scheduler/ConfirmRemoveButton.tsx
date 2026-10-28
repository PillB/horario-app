/**
 * Two-tap remove button: the first tap arms it ("Tap again to remove"), a
 * second tap within a few seconds calls `onConfirm`. Used for workers,
 * availability slots, shift templates and roster shifts (CHG-088).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';

const ARMED_MS = 4000;

type Props = {
  onConfirm: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  /** Shorter label, e.g. "×" for an availability chip. */
  compactLabel?: string;
  testID?: string;
};

export const ConfirmRemoveButton = ({ onConfirm, accessibilityLabel, accessibilityHint, compactLabel, testID }: Props) => {
  const { t } = useT();
  const colors = Colors[useColorScheme() ?? 'light'];
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handlePress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (armed) {
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timerRef.current = setTimeout(() => setArmed(false), ARMED_MS);
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={armed ? t('scheduler.remove.confirm') : accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        { borderColor: colors.error },
        armed && { backgroundColor: colors.errorSurface },
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <ThemedText style={[styles.text, { color: colors.error }]}>
        {armed ? t('scheduler.remove.confirm') : compactLabel ?? t('scheduler.remove.remove')}
      </ThemedText>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 32,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
