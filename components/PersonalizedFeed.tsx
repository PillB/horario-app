import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import type { FeedItem } from '@/hooks/usePersonalizedFeed';

type PersonalizedFeedProps = {
  items: FeedItem[];
  onSelectItem?: (item: FeedItem) => void;
};

export function PersonalizedFeed({ items, onSelectItem }: PersonalizedFeedProps) {
  if (!items.length) return null;

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Personalized actions</ThemedText>
      <View style={styles.list}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onSelectItem?.(item)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.summary}`}
          >
            <View style={styles.rowBetween}>
              <ThemedText type="defaultSemiBold">{item.title}</ThemedText>
              <ThemedText style={styles.badge}>{Math.round(item.impactScore * 100)}%</ThemedText>
            </View>
            <ThemedText style={styles.helperText}>{item.summary}</ThemedText>
          </Pressable>
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff11',
  },
  list: {
    gap: 10,
  },
  card: {
    gap: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  helperText: {
    color: '#6b7280',
  },
  badge: {
    fontWeight: '700',
  },
});

export default PersonalizedFeed;
