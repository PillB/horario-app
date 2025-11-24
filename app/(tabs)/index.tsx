import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

const upcomingShifts = [
  { id: 'up-1', worker: 'Alex Johnson', shift: 'Morning Coverage', date: 'Dec 12', time: '08:00-14:00' },
  { id: 'up-2', worker: 'Priya Singh', shift: 'Evening Coverage', date: 'Dec 12', time: '14:00-22:00' },
  { id: 'up-3', worker: 'Liam Chen', shift: 'Weekend Ops', date: 'Dec 13', time: '09:00-17:00' },
];

const staffingGaps = [
  { id: 'gap-1', role: 'Support', date: 'Dec 12', gap: 1, note: 'Need bilingual cover' },
  { id: 'gap-2', role: 'Front Desk', date: 'Dec 15', gap: 2, note: 'Coverage for training day' },
];

export default function HomeScreen() {
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <View style={{ flex: 1 }}>
          <ThemedText type="title">Scheduler overview</ThemedText>
          <ThemedText style={styles.mutedText}>
            Keep worker availability, templates, and roster health in sync.
          </ThemedText>
        </View>
        <Link href="/(tabs)/scheduler" asChild>
          <Pressable style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>Open Scheduler</ThemedText>
          </Pressable>
        </Link>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Upcoming shifts</ThemedText>
        {upcomingShifts.map((shift) => (
          <View key={shift.id} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">{shift.worker}</ThemedText>
              <ThemedText style={styles.mutedText}>
                {shift.shift} • {shift.time}
              </ThemedText>
            </View>
            <ThemedText style={styles.badge}>{shift.date}</ThemedText>
          </View>
        ))}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Staffing gaps</ThemedText>
        {staffingGaps.map((gap) => (
          <View key={gap.id} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
              <ThemedText style={styles.mutedText}>{gap.note}</ThemedText>
            </View>
            <ThemedView style={styles.gapPill}>
              <ThemedText style={styles.badge}>{gap.gap} open</ThemedText>
              <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
            </ThemedView>
          </View>
        ))}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Quick actions</ThemedText>
        <View style={styles.actions}>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">Add availability</ThemedText>
              <ThemedText style={styles.mutedText}>Capture changes from the floor</ThemedText>
            </Pressable>
          </Link>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">Build shifts</ThemedText>
              <ThemedText style={styles.mutedText}>Start from templates</ThemedText>
            </Pressable>
          </Link>
          <Link href="/(tabs)/scheduler" asChild>
            <Pressable style={styles.actionButton}>
              <ThemedText type="defaultSemiBold">Publish roster</ThemedText>
              <ThemedText style={styles.mutedText}>Review targets vs coverage</ThemedText>
            </Pressable>
          </Link>
        </View>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    fontWeight: '700',
  },
  gapPill: {
    alignItems: 'flex-end',
    gap: 4,
  },
  actions: {
    gap: 10,
  },
  actionButton: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#ffffff',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});
