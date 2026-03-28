import React from 'react';
import { View, TextInput } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { schedulerStyles as styles } from '@/app/(tabs)/scheduler.styles';

type Props = {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
};

export const InputField = ({
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType = 'default',
}: Props) => (
  <View style={styles.inputGroup}>
    <ThemedText style={styles.label}>{label}</ThemedText>
    <TextInput
      value={value}
      placeholder={placeholder}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      style={styles.input}
      placeholderTextColor="#9CA3AF"
    />
  </View>
);
