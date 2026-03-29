import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type AssignedShift } from '@/services/shiftAssigner';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';

type ShiftFormState = {
  workerId: string;
  templateId: string;
  date: string;
};

type TemplateFormState = {
  name: string;
  role: string;
  start: string;
  end: string;
  coverage: string;
};

type Props = {
  shiftTemplates: ShiftTemplate[];
  templateForm: TemplateFormState;
  updateTemplateField: (key: keyof TemplateFormState) => (value: string) => void;
  handleAddTemplate: () => void;
  templateError: string | null;
  templateSuccessMessage: string | null;
  shiftForm: ShiftFormState;
  updateShiftField: (key: keyof ShiftFormState) => (value: string) => void;
  handleShiftSubmit: () => void;
  shiftError: string | null;
  handleAutoAssign: () => void;
  applyAutoAssign: () => void;
  autoAssignSuggestions: AssignedShift[] | null;
  autoAssignApplying: boolean;
};

export const ShiftTemplateSection = ({
  shiftTemplates,
  templateForm,
  updateTemplateField,
  handleAddTemplate,
  templateError,
  templateSuccessMessage,
  shiftForm,
  updateShiftField,
  handleShiftSubmit,
  shiftError,
  handleAutoAssign,
  applyAutoAssign,
  autoAssignSuggestions,
  autoAssignApplying,
}: Props) => {
  const { t } = useT();
  return (
    <>
      <SectionCard
        title={t('scheduler.templates.sectionTitle')}
        subtitle={t('scheduler.templates.sectionSubtitle')}
        tooltip={t('scheduler.templates.tooltip')}
      >
        {shiftTemplates.map((template) => (
          <View key={template.id} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">{template.name}</ThemedText>
              <ThemedText style={styles.mutedText}>
                {template.role} • {template.start} - {template.end}
              </ThemedText>
            </View>
            <ThemedText style={styles.badgeText}>
              {t('scheduler.templates.needed', { n: String(template.coverage) })}
            </ThemedText>
          </View>
        ))}
        {shiftTemplates.length === 0 && (
          <View>
            {/* Ghost preview — shows what shift templates look like populated */}
            <View style={styles.ghostContainer} accessibilityElementsHidden>
              {[0, 1].map((i) => (
                <View key={i} style={styles.ghostRow}>
                  <View style={styles.ghostBlock}>
                    <View style={styles.ghostNameBar} />
                    <View style={styles.ghostTimeBar} />
                  </View>
                  <View style={styles.ghostBadgeBar} />
                </View>
              ))}
            </View>
            <View style={styles.ghostEmptyCta}>
              <ThemedText style={styles.ghostEmptyCtaText}>{t('scheduler.templates.emptyTitle')}</ThemedText>
            </View>
            <ThemedText style={styles.ghostEmptyNote}>
              {t('scheduler.templates.emptyDesc')}
            </ThemedText>
          </View>
        )}
      </SectionCard>

      <SectionCard
        title={t('scheduler.templates.addCardTitle')}
        subtitle={t('scheduler.templates.addCardSubtitle')}
      >
        <View style={styles.inlineInputs}>
          <InputField
            label={t('scheduler.templates.nameLabel')}
            value={templateForm.name}
            placeholder={t('scheduler.templates.namePlaceholder')}
            onChangeText={updateTemplateField('name')}
            accessibilityLabel={t('scheduler.templates.nameA11y')}
            accessibilityHint={t('scheduler.templates.nameA11yHint')}
          />
          <InputField
            label={t('scheduler.templates.roleLabel')}
            value={templateForm.role}
            placeholder={t('scheduler.templates.rolePlaceholder')}
            onChangeText={updateTemplateField('role')}
            accessibilityLabel={t('scheduler.templates.roleA11y')}
            accessibilityHint={t('scheduler.templates.roleA11yHint')}
          />
        </View>
        <View style={styles.inlineInputs}>
          <InputField
            label={t('scheduler.templates.startLabel')}
            value={templateForm.start}
            placeholder="09:00"
            onChangeText={updateTemplateField('start')}
            accessibilityLabel={t('scheduler.templates.startA11y')}
            accessibilityHint={t('scheduler.templates.startA11yHint')}
          />
          <InputField
            label={t('scheduler.templates.endLabel')}
            value={templateForm.end}
            placeholder="17:00"
            onChangeText={updateTemplateField('end')}
            accessibilityLabel={t('scheduler.templates.endA11y')}
            accessibilityHint={t('scheduler.templates.endA11yHint')}
          />
          <InputField
            label={t('scheduler.templates.coverageLabel')}
            value={templateForm.coverage}
            placeholder={t('scheduler.templates.coveragePlaceholder')}
            onChangeText={updateTemplateField('coverage')}
            accessibilityLabel={t('scheduler.templates.coverageA11y')}
            accessibilityHint={t('scheduler.templates.coverageA11yHint')}
          />
        </View>
        <Pressable
          onPress={handleAddTemplate}
          style={styles.primaryButton}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.templates.addButtonA11y')}
          accessibilityHint={t('scheduler.templates.addButtonHint')}
        >
          <ThemedText style={styles.primaryButtonText}>{t('scheduler.templates.addButton')}</ThemedText>
        </Pressable>
        {templateError ? <ThemedText style={styles.errorText}>{templateError}</ThemedText> : null}
        {templateSuccessMessage ? (
          <ThemedText style={styles.successText}>{templateSuccessMessage}</ThemedText>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('scheduler.shifts.sectionTitle')}
        subtitle={t('scheduler.shifts.sectionSubtitle')}
        tooltip={t('scheduler.shifts.tooltip')}
      >
        <View style={styles.inlineInputs}>
          <InputField
            label={t('scheduler.shifts.workerLabel')}
            value={shiftForm.workerId}
            placeholder={t('scheduler.shifts.workerPlaceholder')}
            onChangeText={updateShiftField('workerId')}
          />
          <InputField
            label={t('scheduler.shifts.templateLabel')}
            value={shiftForm.templateId}
            placeholder={t('scheduler.shifts.templatePlaceholder')}
            onChangeText={updateShiftField('templateId')}
          />
        </View>
        <InputField
          label={t('scheduler.shifts.dateLabel')}
          value={shiftForm.date}
          placeholder={t('scheduler.shifts.datePlaceholder')}
          onChangeText={updateShiftField('date')}
        />
        <View style={styles.inlineActions}>
          <Pressable
            accessibilityLabel={t('scheduler.shifts.saveButtonA11y')}
            onPress={handleShiftSubmit}
            style={[styles.primaryButton, styles.actionButton]}
          >
            <ThemedText style={styles.primaryButtonText}>{t('scheduler.shifts.saveButton')}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityLabel={t('scheduler.shifts.autoAssignA11y')}
            accessibilityHint={t('scheduler.shifts.autoAssignHint')}
            onPress={handleAutoAssign}
            style={[styles.secondaryButton, styles.actionButton]}
          >
            <ThemedText style={styles.primaryButtonText}>{t('scheduler.shifts.autoAssignButton')}</ThemedText>
          </Pressable>
        </View>
        {shiftError ? <ThemedText style={styles.errorText}>{shiftError}</ThemedText> : null}

        {autoAssignSuggestions && autoAssignSuggestions.length > 0 ? (
          <ThemedView style={[styles.banner, styles.bannerSuccess, styles.dismissibleBanner]}>
            <ThemedText style={styles.bannerText}>
              {t('scheduler.shifts.suggestions', { n: String(autoAssignSuggestions.length) })}
            </ThemedText>
            {autoAssignSuggestions.map((s) => (
              <ThemedText key={`${s.templateId}-${s.workerId}`} style={styles.mutedText}>
                {t('scheduler.shifts.suggestionItem', { worker: s.workerId, template: s.templateId, date: s.date })}
              </ThemedText>
            ))}
            <Pressable
              accessibilityLabel={t('scheduler.shifts.applyButton')}
              onPress={applyAutoAssign}
              disabled={autoAssignApplying}
              style={[styles.primaryButton, autoAssignApplying && styles.disabledButton]}
            >
              <ThemedText style={styles.primaryButtonText}>
                {autoAssignApplying ? t('scheduler.shifts.applyingButton') : t('scheduler.shifts.applyButton')}
              </ThemedText>
            </Pressable>
          </ThemedView>
        ) : null}
      </SectionCard>
    </>
  );
};
