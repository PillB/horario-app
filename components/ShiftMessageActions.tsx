/**
 * ShiftMessageActions.tsx — Quick-action toolbar for shift-context messaging.
 *
 * Renders three action buttons for a shift card. Tapping "Request coverage"
 * opens a bottom-sheet template picker; "Notify eligible staff" fires a
 * broadcast immediately; "Confirm replacement" is a placeholder hook for
 * scheduling-layer confirmation flows.
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {
  View,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Animated,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import {
  PRESET_TEMPLATES,
  sendShiftMessage,
  type ShiftMessage,
  type MessageTemplate,
} from '@/services/shiftMessaging';

// ─── Environment ──────────────────────────────────────────────────────────────

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  shiftId: string;
  date: string;
  role: string;
  startTime: string;
  endTime: string;
  onMessageSent?: (msg: ShiftMessage) => void;
};

type SheetMode = 'template_picker' | 'free_text';

// ─── Confirmation Toast ───────────────────────────────────────────────────────

function ConfirmationToast({ visible }: { visible: boolean }): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(1400),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, opacity]);

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <ThemedText style={styles.toastText}>✓ Message sent</ThemedText>
    </Animated.View>
  );
}

// ─── Template Row ─────────────────────────────────────────────────────────────

type TemplateRowProps = {
  template: MessageTemplate;
  onSelect: (template: MessageTemplate) => void;
  disabled: boolean;
};

function TemplateRow({ template, onSelect, disabled }: TemplateRowProps): React.ReactElement {
  const handlePress = useCallback(() => {
    onSelect(template);
  }, [onSelect, template]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.templateRow,
        pressed && styles.templateRowPressed,
        disabled && styles.templateRowDisabled,
      ]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={template.label}
    >
      <View style={styles.templateRowInner}>
        <ThemedText style={styles.templateLabel}>{template.label}</ThemedText>
        <ThemedText style={styles.templateBody} numberOfLines={2}>
          {template.body}
        </ThemedText>
      </View>
      <ThemedText style={styles.templateChevron}>›</ThemedText>
    </Pressable>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ShiftMessageActions({
  shiftId,
  date,
  role,
  startTime,
  endTime,
  onMessageSent,
}: Props): React.ReactElement {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>('template_picker');
  const [freeText, setFreeText] = useState('');
  const [sending, setSending] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ──

  const showToast = useCallback(() => {
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current);
    }
    setToastVisible(true);
    toastTimer.current = setTimeout(() => {
      setToastVisible(false);
      toastTimer.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const buildBaseMessage = useCallback(
    (
      type: ShiftMessage['type'],
      body: string,
      templateId?: string,
    ): Omit<ShiftMessage, 'id' | 'createdAt' | 'status'> => ({
      shiftId,
      date,
      role,
      type,
      body,
      sentBy: SUPABASE_ANON_KEY.slice(0, 8), // placeholder — replace with real user id
      templateId,
    }),
    [shiftId, date, role],
  );

  const dispatchMessage = useCallback(
    async (payload: Omit<ShiftMessage, 'id' | 'createdAt' | 'status'>): Promise<void> => {
      setSending(true);
      setErrorText(null);
      try {
        const sent = await sendShiftMessage(payload, PROXY_URL, null);
        onMessageSent?.(sent);
        showToast();
        setSheetVisible(false);
        setFreeText('');
        setSheetMode('template_picker');
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to send message. Please try again.';
        setErrorText(message);
      } finally {
        setSending(false);
      }
    },
    [onMessageSent, showToast],
  );

  // ── Button handlers ──

  const handleRequestCoverage = useCallback(() => {
    setSheetMode('template_picker');
    setErrorText(null);
    setSheetVisible(true);
  }, []);

  const handleNotifyEligible = useCallback(async () => {
    const template = PRESET_TEMPLATES.find((t) => t.id === 'tpl_shift_available');
    if (template === undefined) return;
    const payload = buildBaseMessage('broadcast', template.body, template.id);
    await dispatchMessage(payload);
  }, [buildBaseMessage, dispatchMessage]);

  const handleConfirmReplacement = useCallback(() => {
    // Placeholder: hook into scheduling confirmation layer.
    // For now we send a schedule-change notice as a broadcast.
    const template = PRESET_TEMPLATES.find((t) => t.id === 'tpl_schedule_change');
    if (template === undefined) return;
    const payload = buildBaseMessage('broadcast', template.body, template.id);
    void dispatchMessage(payload);
  }, [buildBaseMessage, dispatchMessage]);

  // ── Sheet handlers ──

  const handleCloseSheet = useCallback(() => {
    if (sending) return;
    setSheetVisible(false);
    setFreeText('');
    setSheetMode('template_picker');
    setErrorText(null);
  }, [sending]);

  const handleSelectTemplate = useCallback(
    (template: MessageTemplate) => {
      const payload = buildBaseMessage(template.type, template.body, template.id);
      void dispatchMessage(payload);
    },
    [buildBaseMessage, dispatchMessage],
  );

  const handleOpenFreeText = useCallback(() => {
    setSheetMode('free_text');
    setErrorText(null);
  }, []);

  const handleBackToTemplates = useCallback(() => {
    setSheetMode('template_picker');
    setErrorText(null);
  }, []);

  const handleSendFreeText = useCallback(() => {
    const trimmed = freeText.trim();
    if (trimmed.length === 0) return;
    const payload = buildBaseMessage('coverage_request', trimmed);
    void dispatchMessage(payload);
  }, [freeText, buildBaseMessage, dispatchMessage]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Action Buttons ── */}
      <View style={styles.buttonRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.actionButtonCoverage,
            pressed && styles.actionButtonPressed,
            sending && styles.actionButtonDisabled,
          ]}
          onPress={handleRequestCoverage}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Request coverage"
        >
          <ThemedText style={styles.actionButtonText}>Request coverage</ThemedText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.actionButtonBroadcast,
            pressed && styles.actionButtonPressed,
            sending && styles.actionButtonDisabled,
          ]}
          onPress={() => { void handleNotifyEligible(); }}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Notify eligible staff"
        >
          <ThemedText style={styles.actionButtonText}>Notify eligible staff</ThemedText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.actionButtonConfirm,
            pressed && styles.actionButtonPressed,
            sending && styles.actionButtonDisabled,
          ]}
          onPress={handleConfirmReplacement}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Confirm replacement"
        >
          <ThemedText style={styles.actionButtonText}>Confirm replacement</ThemedText>
        </Pressable>
      </View>

      {/* ── Toast ── */}
      <ConfirmationToast visible={toastVisible} />

      {/* ── Bottom Sheet Modal ── */}
      <Modal
        visible={sheetVisible}
        animationType="slide"
        transparent
        onRequestClose={handleCloseSheet}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={handleCloseSheet} />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrapper}
        >
          <View style={styles.sheet}>

            {/* Sheet Header */}
            <View style={styles.sheetHeader}>
              {sheetMode === 'free_text' ? (
                <Pressable
                  onPress={handleBackToTemplates}
                  accessibilityRole="button"
                  accessibilityLabel="Back to templates"
                >
                  <ThemedText style={styles.sheetBackText}>‹ Templates</ThemedText>
                </Pressable>
              ) : (
                <View />
              )}
              <ThemedText style={styles.sheetTitle}>
                {sheetMode === 'template_picker' ? 'Send message' : 'Custom message'}
              </ThemedText>
              <Pressable
                onPress={handleCloseSheet}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <ThemedText style={styles.sheetCloseText}>✕</ThemedText>
              </Pressable>
            </View>

            {/* Shift context summary */}
            <View style={styles.contextBadge}>
              <ThemedText style={styles.contextText}>
                {role} · {date} · {startTime}–{endTime}
              </ThemedText>
            </View>

            {/* Error */}
            {errorText !== null && (
              <View style={styles.errorBanner}>
                <ThemedText style={styles.errorText}>{errorText}</ThemedText>
              </View>
            )}

            {/* ── Template Picker ── */}
            {sheetMode === 'template_picker' && (
              <ScrollView
                style={styles.templateList}
                contentContainerStyle={styles.templateListContent}
                keyboardShouldPersistTaps="handled"
              >
                {PRESET_TEMPLATES.map((template) => (
                  <TemplateRow
                    key={template.id}
                    template={template}
                    onSelect={handleSelectTemplate}
                    disabled={sending}
                  />
                ))}

                {/* Free-text option */}
                <Pressable
                  style={({ pressed }) => [
                    styles.templateRow,
                    styles.freeTextRow,
                    pressed && styles.templateRowPressed,
                    sending && styles.templateRowDisabled,
                  ]}
                  onPress={handleOpenFreeText}
                  disabled={sending}
                  accessibilityRole="button"
                  accessibilityLabel="Write a custom message"
                >
                  <View style={styles.templateRowInner}>
                    <ThemedText style={styles.templateLabel}>Write custom message…</ThemedText>
                    <ThemedText style={styles.templateBody}>
                      Compose your own message for this shift.
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.templateChevron}>›</ThemedText>
                </Pressable>
              </ScrollView>
            )}

            {/* ── Free Text Composer ── */}
            {sheetMode === 'free_text' && (
              <View style={styles.freeTextComposer}>
                <TextInput
                  style={styles.freeTextInput}
                  multiline
                  placeholder="Type your message…"
                  placeholderTextColor="#9CA3AF"
                  value={freeText}
                  onChangeText={setFreeText}
                  editable={!sending}
                  autoFocus
                  returnKeyType="default"
                  maxLength={500}
                  accessibilityLabel="Custom message text"
                />
                <ThemedText style={styles.charCount}>{freeText.length}/500</ThemedText>

                <Pressable
                  style={({ pressed }) => [
                    styles.sendButton,
                    pressed && styles.sendButtonPressed,
                    (sending || freeText.trim().length === 0) && styles.sendButtonDisabled,
                  ]}
                  onPress={handleSendFreeText}
                  disabled={sending || freeText.trim().length === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                >
                  {sending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <ThemedText style={styles.sendButtonText}>Send message</ThemedText>
                  )}
                </Pressable>
              </View>
            )}

            {/* Sending indicator (template flow) */}
            {sending && sheetMode === 'template_picker' && (
              <View style={styles.sendingOverlay}>
                <ActivityIndicator color="#0D9488" size="large" />
                <ThemedText style={styles.sendingText}>Sending…</ThemedText>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Container
  container: {
    position: 'relative',
  },

  // Action buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    minWidth: 100,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonCoverage: {
    backgroundColor: '#F59E0B', // amber — urgency
  },
  actionButtonBroadcast: {
    backgroundColor: '#0D9488', // teal — standard action
  },
  actionButtonConfirm: {
    backgroundColor: '#0F766E', // teal dark — confirmation
  },
  actionButtonPressed: {
    opacity: 0.78,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: '#0D9488',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 100,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  // Modal backdrop
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // Sheet wrapper (KeyboardAvoidingView)
  sheetWrapper: {
    justifyContent: 'flex-end',
  },

  // Bottom sheet
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },

  // Sheet header
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetBackText: {
    fontSize: 15,
    color: '#0F766E',
    fontWeight: '500',
    minWidth: 80,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    flex: 1,
  },
  sheetCloseText: {
    fontSize: 18,
    color: '#94A3B8',
    minWidth: 32,
    textAlign: 'right',
  },

  // Context badge
  contextBadge: {
    marginHorizontal: 20,
    marginVertical: 8,
    backgroundColor: '#F0FDFA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  contextText: {
    fontSize: 12,
    color: '#115E59',
    fontWeight: '500',
  },

  // Error banner
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
  },

  // Template list
  templateList: {
    flex: 1,
  },
  templateListContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 14,
    minHeight: 60,
  },
  freeTextRow: {
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
  },
  templateRowPressed: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
  },
  templateRowDisabled: {
    opacity: 0.5,
  },
  templateRowInner: {
    flex: 1,
    gap: 2,
  },
  templateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  templateBody: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  templateChevron: {
    fontSize: 20,
    color: '#94A3B8',
    paddingLeft: 8,
  },

  // Free text composer
  freeTextComposer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 10,
  },
  freeTextInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    minHeight: 120,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'right',
  },

  // Send button
  sendButton: {
    backgroundColor: '#0D9488',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  sendButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Sending overlay
  sendingOverlay: {
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  sendingText: {
    fontSize: 14,
    color: '#64748B',
  },
});