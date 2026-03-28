import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type ShiftTemplate } from '@/app/(tabs)/schedulerMetrics';
import { type AssignedShift } from '@/services/shiftAssigner';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type ShiftFormState = {
  workerId: string;
  templateId: string;
  date: string;
};

type Props = {
  shiftTemplates: ShiftTemplate[];
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
        placeholder="2024-12-15"
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
