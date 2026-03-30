import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import type { RankedFeedItem } from '@/hooks/usePersonalizedFeed';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ThemeColors } from '@/constants/Colors';

type PersonalizedFeedProps = {
  items: RankedFeedItem[];
  onSelectItem?: (item: RankedFeedItem) => void;
};

export function PersonalizedFeed({ items, onSelectItem }: PersonalizedFeedProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  if (!items.length) return null;

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Personalized actions</ThemedText>
      <View style={styles.list}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onSelectItem?.(item)}
            style={({ pressed }) => [
              styles.card,
              pressed && { backgroundColor: colors.background, borderColor: colors.borderFocus },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.summary}`}
          >
            <View style={styles.rowBetween}>
              <ThemedText type="defaultSemiBold">{item.title}</ThemedText>
              <ThemedText style={styles.badge}>
                {Math.round(Math.min(1, Math.max(0, item.score)) * 100)}%
              </ThemedText>
            </View>
            <ThemedText style={styles.helperText}>{item.summary}</ThemedText>
          </Pressable>
        ))}
      </View>
    </ThemedView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: 10,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.surfaceRaised,
    },
    list: {
      gap: 10,
    },
    card: {
      gap: 6,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    helperText: {
      color: colors.textSecondary,
      lineHeight: 22,
    },
    badge: {
      fontWeight: '700',
      color: '#FFFFFF',
      backgroundColor: colors.tint,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 10,
      overflow: 'hidden',
    },
  });

export default PersonalizedFeed;