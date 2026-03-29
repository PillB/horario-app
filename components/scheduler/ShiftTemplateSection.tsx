import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type AssignedShift } from '@/services/shiftAssigner';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';

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
}: Props) => (
  <>
    <SectionCard
      title="Shift templates"
      subtitle="Standardize start/end times and coverage expectations by role."
    >
      {shiftTemplates.map((template) => (
        <View key={template.id} style={styles.rowBetween}>
          <View>
            <ThemedText type="defaultSemiBold">{template.name}</ThemedText>
            <ThemedText style={styles.mutedText}>
              {template.role} • {template.start} - {template.end}
            </ThemedText>
          </View>
          <ThemedText style={styles.badgeText}>{template.coverage} needed</ThemedText>
        </View>
      ))}
      {shiftTemplates.length === 0 && (
        <ThemedText style={styles.mutedText}>
          No templates yet. Templates let you build a full roster in one tap.
        </ThemedText>
      )}
    </SectionCard>

    <SectionCard
      title="Add shift template"
      subtitle="Define a reusable shift with role, time window, and minimum coverage."
    >
      <View style={styles.inlineInputs}>
        <InputField
          label="Name"
          value={templateForm.name}
          placeholder="e.g. Morning"
          onChangeText={updateTemplateField('name')}
          accessibilityLabel="Template name"
          accessibilityHint="A short name for this shift template"
        />
        <InputField
          label="Role"
          value={templateForm.role}
          placeholder="e.g. Support"
          onChangeText={updateTemplateField('role')}
          accessibilityLabel="Template role"
          accessibilityHint="Role required for this template"
        />
      </View>
      <View style={styles.inlineInputs}>
        <InputField
          label="Start"
          value={templateForm.start}
          placeholder="09:00"
          onChangeText={updateTemplateField('start')}
          accessibilityLabel="Shift start time"
          accessibilityHint="HH:MM format"
        />
        <InputField
          label="End"
          value={templateForm.end}
          placeholder="17:00"
          onChangeText={updateTemplateField('end')}
          accessibilityLabel="Shift end time"
          accessibilityHint="HH:MM format"
        />
        <InputField
          label="Coverage"
          value={templateForm.coverage}
          placeholder="1"
          onChangeText={updateTemplateField('coverage')}
          accessibilityLabel="Required coverage"
          accessibilityHint="Minimum number of workers needed"
        />
      </View>
      <Pressable
        onPress={handleAddTemplate}
        style={styles.primaryButton}
        accessibilityRole="button"
        accessibilityLabel="Add template"
        accessibilityHint="Save the new shift template"
      >
        <ThemedText style={styles.primaryButtonText}>Add template</ThemedText>
      </Pressable>
      {templateError ? <ThemedText style={styles.errorText}>{templateError}</ThemedText> : null}
      {templateSuccessMessage ? (
        <ThemedText style={styles.successText}>{templateSuccessMessage}</ThemedText>
      ) : null}
    </SectionCard>

    <SectionCard
      title="Shift creation"
      subtitle="Assign workers into templates for specific dates."
    >
      <View style={styles.inlineInputs}>
        <InputField
          label="Worker"
          value={shiftForm.workerId}
          placeholder="W-01"
          onChangeText={updateShiftField('workerId')}
        />
        <InputField
          label="Template"
          value={shiftForm.templateId}
          placeholder="morning"
          onChangeText={updateShiftField('templateId')}
        />
      </View>
      <InputField
        label="Date"
        value={shiftForm.date}
        placeholder="YYYY-MM-DD"
        onChangeText={updateShiftField('date')}
      />
      <View style={styles.inlineActions}>
        <Pressable
          accessibilityLabel="Save and notify team"
          onPress={handleShiftSubmit}
          style={[styles.primaryButton, styles.actionButton]}
        >
          <ThemedText style={styles.primaryButtonText}>Save and notify team</ThemedText>
        </Pressable>
        <Pressable
          accessibilityLabel="Auto-assign workers to all templates for this date"
          accessibilityHint="Runs the fairness-based assignment algorithm"
          onPress={handleAutoAssign}
          style={[styles.secondaryButton, styles.actionButton]}
        >
          <ThemedText style={styles.primaryButtonText}>Auto-assign</ThemedText>
        </Pressable>
      </View>
      {shiftError ? <ThemedText style={styles.errorText}>{shiftError}</ThemedText> : null}

      {autoAssignSuggestions && autoAssignSuggestions.length > 0 ? (
        <ThemedView style={[styles.banner, styles.bannerSuccess, styles.dismissibleBanner]}>
          <ThemedText style={styles.bannerText}>
            {autoAssignSuggestions.length} assignment suggestion(s) ready
          </ThemedText>
          {autoAssignSuggestions.map((s) => (
            <ThemedText key={`${s.templateId}-${s.workerId}`} style={styles.mutedText}>
              {s.workerId} → {s.templateId} on {s.date}
            </ThemedText>
          ))}
          <Pressable
            accessibilityLabel="Apply auto-assign suggestions"
            onPress={applyAutoAssign}
            disabled={autoAssignApplying}
            style={[styles.primaryButton, autoAssignApplying && styles.disabledButton]}
          >
            <ThemedText style={styles.primaryButtonText}>
              {autoAssignApplying ? 'Applying…' : 'Apply suggestions'}
            </ThemedText>
          </Pressable>
        </ThemedView>
      ) : null}
    </SectionCard>
  </>
);
