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
import { schedulerStyles as styles } from '@/styles/scheduler.styles';

type AvailabilityFormState = {
  workerId: string;
  day: string;
  from: string;
  to: string;
};

type WorkerFormState = {
  name: string;
  role: string;
  skills: string;
};

type Props = {
  workers: Worker[];
  workerForm: WorkerFormState;
  updateWorkerField: (key: keyof WorkerFormState) => (value: string) => void;
  handleAddWorker: () => void;
  workerError: string | null;
  workerSuccessMessage: string | null;
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
  workerForm,
  updateWorkerField,
  handleAddWorker,
  workerError,
  workerSuccessMessage,
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
      {workers.length === 0 && (
        <View>
          {/* Ghost preview — shows what populated workers look like */}
          <View style={styles.ghostContainer} accessibilityElementsHidden>
            {[0, 1].map((i) => (
              <View key={i} style={styles.ghostRow}>
                <View style={styles.ghostBlock}>
                  <View style={styles.ghostNameBar} />
                  <View style={styles.ghostRoleBar} />
                  <View style={styles.ghostTagRow}>
                    <View style={styles.ghostTag} />
                    <View style={styles.ghostTag} />
                  </View>
                </View>
                <View style={styles.ghostBadgeBar} />
              </View>
            ))}
          </View>
          <View style={styles.ghostEmptyCta}>
            <ThemedText style={styles.ghostEmptyCtaText}>Add your first worker below ↓</ThemedText>
          </View>
          <ThemedText style={styles.ghostEmptyNote}>
            Add 2–3 people to unlock auto-assign and scheduling.
          </ThemedText>
        </View>
      )}
    </SectionCard>

    <SectionCard
      title="Add worker"
      subtitle="Create a worker profile with role and skills."
    >
      <InputField
        label="Name"
        value={workerForm.name}
        placeholder="e.g. Alice"
        onChangeText={updateWorkerField('name')}
        accessibilityLabel="Worker name"
        accessibilityHint="Full name of the worker"
      />
      <InputField
        label="Role"
        value={workerForm.role}
        placeholder="e.g. Support"
        onChangeText={updateWorkerField('role')}
        accessibilityLabel="Worker role"
        accessibilityHint="Role or job title"
      />
      <InputField
        label="Skills (comma-separated)"
        value={workerForm.skills}
        placeholder="e.g. barista, cashier"
        onChangeText={updateWorkerField('skills')}
        accessibilityLabel="Worker skills"
        accessibilityHint="Comma-separated list of skills"
      />
      <Pressable
        onPress={handleAddWorker}
        style={styles.primaryButton}
        accessibilityRole="button"
        accessibilityLabel="Add worker"
        accessibilityHint="Save the new worker profile"
      >
        <ThemedText style={styles.primaryButtonText}>Add worker</ThemedText>
      </Pressable>
      {workerError ? (
        <ThemedText style={styles.errorText}>{workerError}</ThemedText>
      ) : null}
      {workerSuccessMessage ? (
        <ThemedText style={styles.successText}>{workerSuccessMessage}</ThemedText>
      ) : null}
    </SectionCard>

    <SectionCard
      title="Availability intake"
      subtitle="Capture recent changes before building rosters."
    >
      <InputField
        label="Worker ID"
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
