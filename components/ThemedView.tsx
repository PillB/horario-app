import { View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/useThemeColor';
import type { ThemeColors } from '@/constants/Colors';

export type ThemedViewProps = ViewProps & {
  /**
   * Optional light-mode background override.
   * Must be a key of ThemeColors (a validated design token) — never a raw hex string.
   * Caller-supplied values bypass the design-token system and may silently fail
   * WCAG contrast requirements if a raw hex is passed.
   */
  lightColor?: keyof ThemeColors;
  /**
   * Optional dark-mode background override.
   * Must be a key of ThemeColors (a validated design token) — never a raw hex string.
   * Caller-supplied values bypass the design-token system and may silently fail
   * WCAG contrast requirements if a raw hex is passed.
   */
  darkColor?: keyof ThemeColors;
};

export function ThemedView({ style, lightColor, darkColor, ...otherProps }: ThemedViewProps) {
  // Defaults to Colors.[scheme].background — never hardcode a fallback hex at call sites.
  // When lightColor/darkColor are omitted the background token resolves to:
  //   light: Colors.light.background (#F8FAFC)
  //   dark:  Colors.dark.background  (#0F172A)
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  // Token-derived backgroundColor is placed AFTER the caller's style so it always wins,
  // preventing un-audited surface colours from silently overriding the design-token value.
  // Callers who need a different surface colour must use the lightColor/darkColor props
  // rather than passing a backgroundColor directly in the style prop.
  return <View style={[style, { backgroundColor }]} {...otherProps} />;
}