/**
 * SkeletonCard — animated loading placeholder matching the shape of a data card.
 *
 * Renders N rows of pulsing gray bars. Uses `Animated` from react-native (not
 * react-native-reanimated) so the shimmer works uniformly on native, web, and
 * in Jest tests without requiring additional mock setup.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  /** Number of placeholder rows to render. Defaults to 3. */
  rows?: number;
  style?: ViewStyle;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SkeletonCard({ rows = 3, style }: Props) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          // Easing.linear avoids the bezier initialisation that can fail in
          // Jest after environment teardown. useNativeDriver: false keeps the
          // animation JS-driven for web and test compatibility.
          easing: Easing.linear,
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
    backgroundColor: '#9CA3AF',
  },
  lineLong: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#9CA3AF',
  },
});
