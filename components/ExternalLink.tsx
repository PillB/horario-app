import { Href, Link } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { type ComponentProps } from 'react';
import { Platform } from 'react-native';
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & {
  href: Href & string;
  /**
   * Optional text colour override.
   * Defaults to a WCAG AA-compliant teal derived from the active colour scheme:
   *   light → brand.primaryDeep (#115E59, 5.87:1 on white)
   *   dark  → Colors.dark.tint  (#2DD4BF, 8.95:1 on #0F172A)
   */
  color?: string;
};

export function ExternalLink({ href, color, style, ...rest }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Pick a scheme-appropriate default that meets AA for normal-weight body text.
  const resolvedColor =
    color ?? (colorScheme === 'dark' ? colors.tint : brand.primaryDeep);

  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      style={[
        {
          color: resolvedColor,
          textDecorationLine: 'underline',
        },
        style,
      ]}
      onPress={async (event) => {
        if (Platform.OS !== 'web') {
          // Prevent the default behavior of linking to the default browser on native.
          event.preventDefault();
          // Open the link in an in-app browser.
          await openBrowserAsync(href);
        }
      }}
    />
  );
}