import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';

const workflowCards = [
  {
    id: 'workflow-1',
    title: 'Worker management',
    description: 'Review skills, roles, and availability updates before scheduling.',
  },
  {
    id: 'workflow-2',
    title: 'Shift templates',
    description: 'Standardize start/end times to accelerate scheduling.',
  },
  {
    id: 'workflow-3',
    title: 'Calendar & roster',
    description: 'Publish the plan and spot draft shifts that need attention.',
  },
];

const highlights = [
  { id: 'hl-1', label: 'Availability added', value: '6 updates this week' },
  { id: 'hl-2', label: 'Shifts in draft', value: '4 waiting for approval' },
  { id: 'hl-3', label: 'Coverage gaps', value: '2 roles need staffing' },
];

export default function TabTwoScreen() {
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Explore scheduling flows</ThemedText>
        <ThemedText style={styles.mutedText}>
          Jump into the tabs you need to keep worker availability, demand targets, and roster health aligned.
        </ThemedText>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Start with the Scheduler</ThemedText>
        <ThemedText style={styles.mutedText}>
          Build shifts from templates, set demand targets, and publish rosters without losing track of worker updates.
        </ThemedText>
        <Link href="/(tabs)/scheduler" asChild>
          <Pressable style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>Open Scheduler</ThemedText>
          </Pressable>
        </Link>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Key workflows</ThemedText>
        <View style={styles.list}>
          {workflowCards.map((workflow) => (
            <ThemedView key={workflow.id} style={styles.listItem}>
              <ThemedText type="defaultSemiBold">{workflow.title}</ThemedText>
              <ThemedText style={styles.mutedText}>{workflow.description}</ThemedText>
            </ThemedView>
          ))}
        </View>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Highlights</ThemedText>
        <View style={styles.list}>
          {highlights.map((highlight) => (
            <View key={highlight.id} style={styles.rowBetween}>
              <ThemedText type="defaultSemiBold">{highlight.label}</ThemedText>
              <ThemedText style={styles.badge}>{highlight.value}</ThemedText>
            </View>
          ))}
        </View>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    gap: 10,
    marginBottom: 12,
  },
  mutedText: {
    color: '#9CA3AF',
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff11',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  list: {
    gap: 10,
  },
  listItem: {
    gap: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    fontWeight: '700',
  },
});
