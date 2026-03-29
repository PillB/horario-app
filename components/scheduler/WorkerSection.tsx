import React from 'react';
import { View, Pressable } from 'react-native';
import { type Router } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type Worker } from '@/types/scheduler';
import { AvailabilityLabel } from './AvailabilityLabel';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';

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
}: Props) => {
  const { t } = useT();
  return (
    <>
      <SectionCard
        title={t('scheduler.workers.sectionTitle')}
        subtitle={t('scheduler.workers.sectionSubtitle')}
        tooltip={t('scheduler.workers.tooltip')}
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
              <ThemedText style={styles.ghostEmptyCtaText}>{t('scheduler.workers.emptyTitle')}</ThemedText>
            </View>
            <ThemedText style={styles.ghostEmptyNote}>
              {t('scheduler.workers.emptyDesc')}
            </ThemedText>
          </View>
        )}
      </SectionCard>

      <SectionCard
        title={t('scheduler.workers.addCardTitle')}
        subtitle={t('scheduler.workers.addCardSubtitle')}
      >
        <InputField
          label={t('scheduler.workers.nameLabel')}
          value={workerForm.name}
          placeholder={t('scheduler.workers.namePlaceholder')}
          onChangeText={updateWorkerField('name')}
          accessibilityLabel={t('scheduler.workers.nameA11y')}
          accessibilityHint={t('scheduler.workers.nameA11yHint')}
        />
        <InputField
          label={t('scheduler.workers.roleLabel')}
          value={workerForm.role}
          placeholder={t('scheduler.workers.rolePlaceholder')}
          onChangeText={updateWorkerField('role')}
          accessibilityLabel={t('scheduler.workers.roleA11y')}
          accessibilityHint={t('scheduler.workers.roleA11yHint')}
        />
        <InputField
          label={t('scheduler.workers.skillsLabel')}
          value={workerForm.skills}
          placeholder={t('scheduler.workers.skillsPlaceholder')}
          onChangeText={updateWorkerField('skills')}
          accessibilityLabel={t('scheduler.workers.skillsA11y')}
          accessibilityHint={t('scheduler.workers.skillsA11yHint')}
        />
        <Pressable
          onPress={handleAddWorker}
          style={styles.primaryButton}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.workers.addButtonA11y')}
          accessibilityHint={t('scheduler.workers.addButtonHint')}
        >
          <ThemedText style={styles.primaryButtonText}>{t('scheduler.workers.addButton')}</ThemedText>
        </Pressable>
        {workerError ? (
          <ThemedText style={styles.errorText}>{workerError}</ThemedText>
        ) : null}
        {workerSuccessMessage ? (
          <ThemedText style={styles.successText}>{workerSuccessMessage}</ThemedText>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('scheduler.availability.sectionTitle')}
        subtitle={t('scheduler.availability.sectionSubtitle')}
        tooltip={t('scheduler.availability.tooltip')}
      >
        <InputField
          label={t('scheduler.availability.workerIdLabel')}
          value={availabilityForm.workerId}
          placeholder={t('scheduler.availability.workerIdPlaceholder')}
          onChangeText={updateAvailabilityField('workerId')}
        />
        <View style={styles.inlineInputs}>
          <InputField
            label={t('scheduler.availability.dayLabel')}
            value={availabilityForm.day}
            placeholder={t('scheduler.availability.dayPlaceholder')}
            onChangeText={updateAvailabilityField('day')}
          />
          <InputField
            label={t('scheduler.availability.fromLabel')}
            value={availabilityForm.from}
            placeholder={t('scheduler.availability.fromPlaceholder')}
            onChangeText={updateAvailabilityField('from')}
          />
          <InputField
            label={t('scheduler.availability.toLabel')}
            value={availabilityForm.to}
            placeholder={t('scheduler.availability.toPlaceholder')}
            onChangeText={updateAvailabilityField('to')}
          />
        </View>
        <Pressable onPress={handleAvailabilitySubmit} style={styles.primaryButton}>
          <ThemedText style={styles.primaryButtonText}>{t('scheduler.availability.addButton')}</ThemedText>
        </Pressable>
        {availabilitySuccessPromptVisible ? (
          <ThemedView style={[styles.banner, styles.bannerSuccess, styles.dismissibleBanner]}>
            <View style={styles.bannerHeader}>
              <ThemedText style={styles.bannerText}>{t('scheduler.availability.savedTitle')}</ThemedText>
              <Pressable onPress={() => setAvailabilitySuccessPromptVisible(false)}>
                <ThemedText style={styles.dismissText}>{t('common.dismiss')}</ThemedText>
              </Pressable>
            </View>
            <ThemedText style={styles.mutedText}>{t('scheduler.availability.savedNext')}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('scheduler.availability.assignNow')}
              accessibilityHint={t('scheduler.availability.assignNowHint')}
              onPress={() => {
                scrollToShiftSection();
                setAvailabilitySuccessPromptVisible(false);
                router.setParams({ section: 'shifts' });
              }}
              style={[styles.secondaryButton, styles.tightButton]}
            >
              <ThemedText style={styles.primaryButtonText}>{t('scheduler.availability.assignNow')}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : null}
        {availabilityError ? (
          <ThemedText style={styles.errorText}>{availabilityError}</ThemedText>
        ) : null}
      </SectionCard>
    </>
  );
};
