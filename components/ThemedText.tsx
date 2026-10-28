import { StyleSheet, Text, Pressable, type TextProps } from 'react-native';
import { useState } from 'react';

import { useThemeColor } from '@/hooks/useThemeColor';
import { Colors } from '@/constants/Colors';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  /**
   * IMPORTANT: `darkColor` must not be set to `Colors.dark.textTertiary` (#64748B),
   * which only achieves 2.74:1 against the dark background — a WCAG AA failure for
   * normal-sized text. Use `Colors.dark.text` (#F1F5F9) or
   * `Colors.dark.textSecondary` (#94A3B8, 5.27:1) as the minimum safe dark value.
   */
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  // Link colour: primaryDeep (#115E59, 5.87:1 on white) in light mode,
  // tint (#2DD4BF, 8.95:1 on #0F172A) in dark mode.
  const resolvedLinkColor = useThemeColor(
    { light: '#115E59', dark: Colors.dark.tint },
    'tint',
  );

  // Pressed-state colour for link affordance (text, so the text-safe teal)
  const linkPressedColor = useThemeColor(
    { light: Colors.light.tintText, dark: Colors.dark.borderFocus },
    'tintText',
  );

  const [isPressed, setIsPressed] = useState(false);

  if (type === 'link') {
    return (
      <Pressable
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        accessibilityRole="link"
      >
        <Text
          style={[
            styles.link,
            {
              color: isPressed ? linkPressedColor : resolvedLinkColor,
              textDecorationLine: isPressed ? 'underline' : 'none',
            },
            style,
          ]}
          {...rest}
        />
      </Pressable>
    );
  }

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    // lineHeight 26 (1.625×) improves readability in bright outdoor conditions
    lineHeight: 26,
  },
  defaultSemiBold: {
    fontSize: 16,
    // lineHeight 26 (1.625×) improves readability in bright outdoor conditions
    lineHeight: 26,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    // lineHeight 40 (1.25×) provides adequate leading for wrapped title lines
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: 'bold',
    // lineHeight 30 (1.5×) meets WCAG SC 1.4.8 recommendation for body-adjacent text
    lineHeight: 30,
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
    // colour is applied inline via resolvedLinkColor / linkPressedColor tokens —
    // no hardcoded hex here so the token-driven colour always takes precedence.
  },
});