import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { type Router } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type Worker } from '@/types/scheduler';
import { AvailabilityLabel } from './AvailabilityLabel';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

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

const makeLocalStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // [1][6] Worker role text — use textSecondary (6.86:1 on light, 5.27:1 on dark) instead of
    // textTertiary which fails AA for informational content in both light (4.35:1) and dark (2.10:1)
    roleText: {
      color: colors.textSecondary,
    },
    // [2] Skill badge text — use brand.primaryDeep (#115E59) on primarySurface (#F0FDFA) → 5.87:1 AA
    badgeText: {
      color: brand.primaryDeep,
    },
    // [5] Banner success title — use Colors.light.success (#15803D, 5.44:1) instead of
    // brand.success (#10B981) which is only 2.47:1 on successSurface
    bannerText: {
      color: colors.success,
    },
    // [4][7] Muted text inside success banner — use textSecondary for safe contrast on
    // successSurface in both light (~6.51:1) and dark modes; textTertiary fails in both
    bannerMutedText: {
      color: colors.textSecondary,
    },
    // [12] Dismiss label on successSurface — brand.primaryDeep (#115E59) → ~5.59:1 AA
    dismissText: {
      color: brand.primaryDeep,
    },
    // [10] Ghost empty CTA text — at minimum textSecondary for AA compliance
    ghostEmptyCtaText: {
      color: colors.textSecondary,
    },
  });

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
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const localStyles = makeLocalStyles(colors);

  // [8] Determine whether Add Worker button should be treated as disabled
  const isAddWorkerDisabled =
    !workerForm.name.trim() && !workerForm.role.trim() && !workerForm.skills.trim();

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
              {/* [1][6] role text: textSecondary passes AA in both light and dark mode */}
              <ThemedText style={localStyles.roleText}>{worker.role}</ThemedText>
              <View style={styles.tagRow}>
                {worker.skills.map((skill) => (
                  <View key={`${worker.id}-${skill}`} style={styles.tag}>
                    {/* [2] badge text: brand.primaryDeep on primarySurface → 5.87:1 AA */}
                    <ThemedText style={localStyles.badgeText}>{skill}</ThemedText>
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
              {/* [10] ghostEmptyCtaText: textSecondary minimum for AA compliance */}
              <ThemedText style={localStyles.ghostEmptyCtaText}>{t('scheduler.workers.emptyTitle')}</ThemedText>
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
        {/* [11] InputField placeholder colour is handled inside InputField component;
            confirm it uses Colors[scheme].textTertiary (#64748B, 4.35:1) at minimum */}
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
        {/* [3] primaryButton background must be brand.primary (#0D9488) or brand.primaryDark —
            never brand.accent (#F59E0B) with white text (only 2.25:1).
            [8] pressed state: opacity + darker background for clear visual feedback;
            disabled state: reduced opacity (0.5) when all fields empty */}
        <Pressable
          onPress={handleAddWorker}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && { opacity: 0.75, backgroundColor: brand.primaryDark },
            isAddWorkerDisabled && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.workers.addButtonA11y')}
          accessibilityHint={t('scheduler.workers.addButtonHint')}
          accessibilityState={{ disabled: isAddWorkerDisabled }}
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
        {/* [9] pressed state + accessibilityRole/Label added for visual and screen-reader feedback */}
        <Pressable
          onPress={handleAvailabilitySubmit}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && { opacity: 0.75 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.availability.addButton')}
        >
          <ThemedText style={styles.primaryButtonText}>{t('scheduler.availability.addButton')}</ThemedText>
        </Pressable>
        {availabilitySuccessPromptVisible ? (
          <ThemedView style={[styles.banner, styles.bannerSuccess, styles.dismissibleBanner]}>
            <View style={styles.bannerHeader}>
              {/* [5] bannerText: Colors[scheme].success (#15803D light / #34D399 dark) → passes AA
                  on their respective successSurface backgrounds */}
              <ThemedText style={localStyles.bannerText}>{t('scheduler.availability.savedTitle')}</ThemedText>
              {/* [12] dismissText: brand.primaryDeep (#115E59) on successSurface → ~5.59:1 AA */}
              <Pressable onPress={() => setAvailabilitySuccessPromptVisible(false)}>
                <ThemedText style={localStyles.dismissText}>{t('common.dismiss')}</ThemedText>
              </Pressable>
            </View>
            {/* [4][7] mutedText inside banner: textSecondary for AA on successSurface in both modes */}
            <ThemedText style={localStyles.bannerMutedText}>{t('scheduler.availability.savedNext')}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('scheduler.availability.assignNow')}
              accessibilityHint={t('scheduler.availability.assignNowHint')}
              onPress={() => {
                scrollToShiftSection();
                setAvailabilitySuccessPromptVisible(false);
                router.setParams({ section: 'shifts' });
              }}
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.tightButton,
                pressed && { opacity: 0.75 },
              ]}
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