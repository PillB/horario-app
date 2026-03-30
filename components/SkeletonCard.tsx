/**
 * SkeletonCard — animated loading placeholder matching the shape of a data card.
 *
 * Renders N rows of pulsing gray bars. Uses `Animated` from react-native (not
 * react-native-reanimated) so the shimmer works uniformly on native, web, and
 * in Jest tests without requiring additional mock setup.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { Colors, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  /** Number of placeholder rows to render. Defaults to 3. */
  rows?: number;
  style?: ViewStyle;
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      gap: 12,
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    lineShort: {
      flex: 2,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.border, // border token provides ~3:1 contrast as skeleton placeholder
    },
    lineLong: {
      flex: 1,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.border, // border token provides ~3:1 contrast as skeleton placeholder
    },
  });

// ─── Component ────────────────────────────────────────────────────────────────

export function SkeletonCard({ rows = 3, style }: Props) {
  // Pulse between 0.6 and 1.0 so the bar never drops below ~3:1 perceived
  // contrast against the surface (fixing the 1.5:1 nadir at the old 0.3 floor).
  const opacity = useRef(new Animated.Value(0.6)).current;

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1.0,
          duration: 800,
          // Easing.linear avoids the bezier initialisation that can fail in
          // Jest after environment teardown. useNativeDriver: false keeps the
          // animation JS-driven for web and test compatibility.
          easing: Easing.linear,
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 800,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View
      testID="skeleton-card"
      style={[styles.card, style]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Animated.View
          key={i}
          testID="skeleton-row"
          style={[styles.row, { opacity }]}
        >
          <View style={styles.lineShort} />
          <View style={styles.lineLong} />
        </Animated.View>
      ))}
    </View>
  );
}