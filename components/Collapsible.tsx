import { PropsWithChildren, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const theme = useColorScheme() ?? 'light';

  return (
    <ThemedView>
      <TouchableOpacity
        onPress={() => setIsOpen((value) => !value)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={isOpen ? 'Tap to collapse' : 'Tap to expand'}
        focusable
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[
          styles.heading,
          isFocused && [styles.headingFocused, { borderColor: Colors[theme].tint }],
        ]}>
        <IconSymbol
          name="chevron.right"
          size={18}
          weight="medium"
          color={theme === 'light' ? Colors.light.icon : Colors.dark.text}
          style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}
        />

        <ThemedText type="defaultSemiBold">{title}</ThemedText>
      </TouchableOpacity>
      {isOpen && <ThemedView style={styles.content}>{children}</ThemedView>}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
  },
  headingFocused: {
    borderWidth: 2,
    borderRadius: 8,
    padding: 4,
  },
  content: {
    marginTop: 6,
    marginLeft: 24,
  },
});