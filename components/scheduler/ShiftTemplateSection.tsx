import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { type ShiftTemplate } from '@/app/(tabs)/schedulerMetrics';
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
};

export const ShiftTemplateSection = ({
  shiftTemplates,
  shiftForm,
  updateShiftField,
  handleShiftSubmit,
  shiftError,
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
      <Pressable
        accessibilityLabel="Save and notify team"
        onPress={handleShiftSubmit}
        style={styles.primaryButton}
      >
        <ThemedText style={styles.primaryButtonText}>Save and notify team</ThemedText>
      </Pressable>
      {shiftError ? <ThemedText style={styles.errorText}>{shiftError}</ThemedText> : null}
    </SectionCard>
  </>
);
