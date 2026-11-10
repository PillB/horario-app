/**
 * ShiftMessagesPanel — messages for the worker of one roster shift.
 *
 * The quick actions (`ShiftMessageActions`) store a message through the secure
 * proxy, and the list shows what is stored for the shift. Nothing is delivered
 * yet: no push, SMS or email channel is connected, and the panel says so.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import ShiftMessageActions from '@/components/ShiftMessageActions';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { fetchShiftMessages, type DbShiftMessage } from '@/services/rosterService';

type Props = {
  shiftId: string;
  date: string;
  role: string;
  startTime: string;
  endTime: string;
};

export function ShiftMessagesPanel({ shiftId, date, role, startTime, endTime }: Props) {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const styles = makeStyles(Colors[colorScheme ?? 'light']);
  const [messages, setMessages] = useState<DbShiftMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const result = await fetchShiftMessages(shiftId);
    if (requestId !== requestIdRef.current) return;
    if (result.ok) {
      setMessages(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [shiftId]);

  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  return (
    <ThemedView style={styles.card} testID="shift-messages-panel">
      <ThemedText type="subtitle">{t('shiftMessages.title')}</ThemedText>
      <ThemedText style={styles.muted}>{t('shiftMessages.notDelivered')}</ThemedText>
      <ShiftMessageActions
        shiftId={shiftId}
        date={date}
        role={role}
        startTime={startTime}
        endTime={endTime}
        onMessageSent={() => { void load(); }}
      />
      {error ? <ThemedText style={styles.error} accessibilityRole="alert">{error}</ThemedText> : null}
      {messages.length === 0 && !error ? (
        <ThemedText style={styles.muted}>{t('shiftMessages.empty')}</ThemedText>
      ) : (
        messages.map((message) => (
          <View key={message.id} style={styles.row} testID={`shift-message-${message.id}`}>
            <ThemedText>{message.body}</ThemedText>
            <ThemedText style={styles.muted}>
              {message.status === 'pending' ? t('shiftMessages.statusPending') : message.status}
              {' · '}
              {message.createdAt.slice(0, 16).replace('T', ' ')}
            </ThemedText>
          </View>
        ))
      )}
    </ThemedView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: { gap: 12, padding: 16, borderTopWidth: 1, borderColor: colors.border },
    row: { gap: 2, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    muted: { color: colors.textSecondary, fontSize: 14 },
    error: { color: colors.error, fontSize: 14 },
  });
