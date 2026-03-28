import React from 'react';
import { View, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { type Router } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type Worker } from '@/types/scheduler';
import { AvailabilityLabel } from './AvailabilityLabel';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type AvailabilityFormState = {
  workerId: string;
  day: string;
  from: string;
  to: string;
};

type Props = {
  workers: Worker[];
  availabilityForm: AvailabilityFormState;
  updateAvailabilityField: (key: keyof AvailabilityFormState) => (value: string) => void;
  handleAvailabilitySubmit: () => void;
  availabilitySuccessPromptVisible: boolean;
  setAvailabilitySuccessPromptVisible: (v: boolean) => void;
  availabilityError: string | null;
  scrollToShiftSection: () => void;
  router: Router;
};

export const WorkerSection = ({
  workers,
  availabilityForm,
  updateAvailabilityField,
  handleAvailabilitySubmit,
  availabilitySuccessPromptVisible,
  setAvailabilitySuccessPromptVisible,
  availabilityError,
  scrollToShiftSection,
  router,
}: Props) => (
  <>
    <SectionCard
      title="Worker management"
      subtitle="Track skills, role fit, and availability to place the right people in the right shifts."
    >
      {workers.map((worker) => (
        <View key={worker.id} style={styles.rowBetween}>
          <View style={styles.rowContent}>
            <ThemedText type="defaultSemiBold">{worker.name}</ThemedText>
            <ThemedText style={styles.mutedText}>{worker.role}</ThemedText>
            <View style={styles.tagRow}>
              {worker.skills.map((skill) => (
                <View key={`${worker.id}-${skill}`} style={styles.tag}>
                  <ThemedText style={styles.badgeText}>{skill}</ThemedText>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.availabilityList}>
            {worker.availability.map((slot, index) => (
              <AvailabilityLabel
                key={`${worker.id}-${index}`}
                day={slot.day}
                from={slot.from}
                to={slot.to}
              />
            ))}
          </View>
        </View>
      ))}
    </SectionCard>

    <SectionCard
      title="Availability intake"
      subtitle="Capture recent changes before building rosters."
    >
      <InputField
        label="Worker"
        value={availabilityForm.workerId}
        placeholder="Worker ID"
        onChangeText={updateAvailabilityField('workerId')}
      />
      <View style={styles.inlineInputs}>
        <InputField
          label="Day"
          value={availabilityForm.day}
          placeholder="Mon"
          onChangeText={updateAvailabilityField('day')}
        />
        <InputField
          label="From"
          value={availabilityForm.from}
          placeholder="09:00"
          onChangeText={updateAvailabilityField('from')}
        />
        <InputField
          label="To"
          value={availabilityForm.to}
          placeholder="17:00"
          onChangeText={updateAvailabilityField('to')}
        />
      </View>
      <Pressable onPress={handleAvailabilitySubmit} style={styles.primaryButton}>
        <ThemedText style={styles.primaryButtonText}>Add availability</ThemedText>
      </Pressable>
      {availabilitySuccessPromptVisible ? (
        <ThemedView style={[styles.banner, styles.bannerSuccess, styles.dismissibleBanner]}>
          <View style={styles.bannerHeader}>
            <ThemedText style={styles.bannerText}>Availability saved.</ThemedText>
            <Pressable onPress={() => setAvailabilitySuccessPromptVisible(false)}>
              <ThemedText style={styles.dismissText}>Dismiss</ThemedText>
            </Pressable>
          </View>
          <ThemedText style={styles.mutedText}>Assign to a template now.</ThemedText>
          <Link
            href={{ pathname: '/(tabs)/scheduler', params: { section: 'shifts' } }}
            asChild
          >
            <Pressable
              onPress={() => {
                scrollToShiftSection();
                setAvailabilitySuccessPromptVisible(false);
                router.setParams({ section: 'shifts' });
              }}
              style={[styles.secondaryButton, styles.tightButton]}
            >
              <ThemedText style={styles.primaryButtonText}>Assign to a template now</ThemedText>
            </Pressable>
          </Link>
        </ThemedView>
      ) : null}
      {availabilityError ? (
        <ThemedText style={styles.errorText}>{availabilityError}</ThemedText>
      ) : null}
    </SectionCard>
  </>
);
