import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

type FieldKey = keyof ScheduleFormState;

type ScheduleFormState = {
  caseNumber: string;
  productId: string;
  clientId: string;
  teamId: string;
  startDate: string;
  endDate: string;
  hours: string;
};

export type ScheduleEntry = {
  caseNumber: string;
  productId: string;
  clientId: string;
  teamId: string;
  startDate: string;
  endDate: string;
  hours: number;
};

type Props = {
  existingEntries: ScheduleEntry[];
  onSubmit: (entry: ScheduleEntry) => void;
};

type ValidationErrors = Partial<Record<FieldKey, string>>;

const initialState: ScheduleFormState = {
  caseNumber: '',
  productId: '',
  clientId: '',
  teamId: '',
  startDate: '',
  endDate: '',
  hours: '',
};

export function ScheduleForm({ existingEntries, onSubmit }: Props) {
  const [form, setForm] = useState<ScheduleFormState>(initialState);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [modalMessage, setModalMessage] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  const fieldOrder: FieldKey[] = useMemo(
    () => ['caseNumber', 'productId', 'clientId', 'teamId', 'startDate', 'endDate', 'hours'],
    []
  );

  const updateField = (key: FieldKey, value: string) => {
    setTouched((prev) => new Set(prev).add(key));
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: validateField(key, value, { ...form, [key]: value }) }));
  };

  const validateDateFormat = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  const validateNumeric = (value: string) => {
    if (value.trim() === '') return 'Hours are required';
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return 'Hours must be a number';
    if (parsed < 0) return 'Hours cannot be negative';
    if (parsed > 24) return 'Hours cannot exceed 24 in a day';
    return '';
  };

  const validateField = (key: FieldKey, value: string, currentState: ScheduleFormState) => {
    if (!value.trim()) return 'This field is required';

    switch (key) {
      case 'startDate':
      case 'endDate': {
        if (!validateDateFormat(value)) return 'Use YYYY-MM-DD format';
        const start = new Date(`${currentState.startDate}T00:00:00Z`).getTime();
        const end = new Date(`${currentState.endDate}T00:00:00Z`).getTime();
        if (currentState.startDate && currentState.endDate && start > end) {
          return 'Start date must be before end date';
        }
        return '';
      }
      case 'hours':
        return validateNumeric(value);
      default:
        return '';
    }
  };

  const validateForm = (): ValidationErrors => {
    const validation: ValidationErrors = {};

    fieldOrder.forEach((key) => {
      validation[key] = validateField(key, form[key], form);
    });

    if (!validation.startDate && !validation.endDate) {
      const existingDuplicate = existingEntries.find(
        (entry) =>
          entry.caseNumber.trim().toLowerCase() === form.caseNumber.trim().toLowerCase() &&
          entry.productId.trim().toLowerCase() === form.productId.trim().toLowerCase() &&
          entry.clientId.trim().toLowerCase() === form.clientId.trim().toLowerCase() &&
          entry.teamId.trim().toLowerCase() === form.teamId.trim().toLowerCase() &&
          entry.startDate === form.startDate
      );

      if (existingDuplicate) {
        validation.startDate = 'Duplicate schedule for this case/product/client/team/date';
      }
    }

    return validation;
  };

  const handleSubmit = () => {
    const validation = validateForm();
    const activeErrors = Object.values(validation).filter(Boolean);
    setErrors(validation);

    if (activeErrors.length) {
      setModalMessage(activeErrors[0] ?? 'Please resolve the highlighted issues.');
      setModalVisible(true);
      return;
    }

    onSubmit({
      caseNumber: form.caseNumber.trim(),
      productId: form.productId.trim(),
      clientId: form.clientId.trim(),
      teamId: form.teamId.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      hours: Number(form.hours),
    });
    setForm(initialState);
    setErrors({});
    setTouched(new Set());
  };

  const closeModal = () => setModalVisible(false);

  return (
    <ThemedView style={styles.formContainer}>
      <ThemedText type="subtitle">Schedule intake</ThemedText>
      <ThemedText style={styles.helperText}>
        Validate date ranges, numeric hours, and duplicates as you edit fields.
      </ThemedText>
      <View style={styles.inlineInputs}>
        <FormField
          label="Case number"
          value={form.caseNumber}
          placeholder="2024-001"
          onChangeText={(text) => updateField('caseNumber', text)}
          error={touched.has('caseNumber') ? errors.caseNumber : ''}
          autoCapitalize="characters"
        />
        <FormField
          label="Product"
          value={form.productId}
          placeholder="Product ID"
          onChangeText={(text) => updateField('productId', text)}
          error={touched.has('productId') ? errors.productId : ''}
        />
      </View>
      <View style={styles.inlineInputs}>
        <FormField
          label="Client"
          value={form.clientId}
          placeholder="Client ID"
          onChangeText={(text) => updateField('clientId', text)}
          error={touched.has('clientId') ? errors.clientId : ''}
        />
        <FormField
          label="Team"
          value={form.teamId}
          placeholder="Team code"
          onChangeText={(text) => updateField('teamId', text)}
          error={touched.has('teamId') ? errors.teamId : ''}
        />
      </View>
      <View style={styles.inlineInputs}>
        <FormField
          label="Start date"
          value={form.startDate}
          placeholder="YYYY-MM-DD"
          onChangeText={(text) => updateField('startDate', text)}
          error={touched.has('startDate') ? errors.startDate : ''}
        />
        <FormField
          label="End date"
          value={form.endDate}
          placeholder="YYYY-MM-DD"
          onChangeText={(text) => updateField('endDate', text)}
          error={touched.has('endDate') ? errors.endDate : ''}
        />
      </View>
      <FormField
        label="Hours"
        value={form.hours}
        placeholder="8"
        onChangeText={(text) => updateField('hours', text)}
        keyboardType="numeric"
        error={touched.has('hours') ? errors.hours : ''}
      />
      <Pressable onPress={handleSubmit} style={styles.primaryButton}>
        <ThemedText style={styles.primaryButtonText}>Save schedule</ThemedText>
      </Pressable>

      <Modal animationType="fade" transparent visible={modalVisible} onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="subtitle">Review validation</ThemedText>
            <ThemedText style={styles.modalText}>{modalMessage}</ThemedText>
            <Pressable onPress={closeModal} style={styles.secondaryButton}>
              <ThemedText style={styles.secondaryButtonText}>Close</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

type FormFieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'numeric';
  error?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

const FormField = ({ label, value, placeholder, onChangeText, keyboardType, error, autoCapitalize }: FormFieldProps) => {
  return (
    <View style={styles.inputGroup}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TextInput
        value={value}
        placeholder={placeholder}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize}
        style={[styles.input, error ? styles.inputError : null]}
        placeholderTextColor="#9CA3AF"
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  formContainer: {
    gap: 10,
  },
  helperText: {
    color: '#6B7280',
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: 10,
  },
  inputGroup: {
    flex: 1,
    gap: 6,
  },
  label: {
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    color: '#111827',
  },
  inputError: {
    borderColor: '#DC2626',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#111827',
    padding: 20,
    borderRadius: 12,
    gap: 12,
  },
  modalText: {
    color: '#E5E7EB',
  },
  secondaryButton: {
    backgroundColor: '#ffffff22',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

