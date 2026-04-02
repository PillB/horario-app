import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Pressable,
  TextInput,
  StyleSheet,
  Share,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemedText } from '@/components/ThemedText';
import { useColorScheme } from '@/hooks/useColorScheme';

export type TeamInviteModalProps = {
  visible: boolean;
  onClose: () => void;
  mode: 'manager' | 'worker';
};

const INVITE_CODE_KEY = 'horario.inviteCode';
const TEAM_CODE_KEY = 'horario.teamCode';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return code;
}

export function TeamInviteModal({ visible, onClose, mode }: TeamInviteModalProps): React.JSX.Element {
  const colorScheme = useColorScheme() ?? 'light';

  // Manager state
  const [inviteCode, setInviteCode] = useState<string>('');
  const [workerEmail, setWorkerEmail] = useState<string>('');
  const [codeCopied, setCodeCopied] = useState<boolean>(false);

  // Worker state
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [joinStatus, setJoinStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const loadOrCreateCode = useCallback(async (): Promise<void> => {
    try {
      const existing = await AsyncStorage.getItem(INVITE_CODE_KEY);
      if (existing && existing.length === 6) {
        setInviteCode(existing);
      } else {
        const newCode = generateCode();
        await AsyncStorage.setItem(INVITE_CODE_KEY, newCode);
        setInviteCode(newCode);
      }
    } catch {
      const fallback = generateCode();
      setInviteCode(fallback);
    }
  }, []);

  const regenerateCode = useCallback(async (): Promise<void> => {
    try {
      const newCode = generateCode();
      await AsyncStorage.setItem(INVITE_CODE_KEY, newCode);
      setInviteCode(newCode);
      setCodeCopied(false);
    } catch {
      Alert.alert('Error', 'Could not regenerate code. Please try again.');
    }
  }, []);

  useEffect(() => {
    if (visible && mode === 'manager') {
      void loadOrCreateCode();
      setWorkerEmail('');
      setCodeCopied(false);
    }
    if (visible && mode === 'worker') {
      setEnteredCode('');
      setJoinStatus('idle');
    }
  }, [visible, mode, loadOrCreateCode]);

  const handleCopyCode = useCallback(async (): Promise<void> => {
    try {
      await Share.share({
        message: `Join my Horario team with code: ${inviteCode}`,
      });
      setCodeCopied(true);
    } catch {
      Alert.alert('Error', 'Could not share the code. Please copy it manually.');
    }
  }, [inviteCode]);

  const handleJoinTeam = useCallback(async (): Promise<void> => {
    const trimmed = enteredCode.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setJoinStatus('error');
      return;
    }

    try {
      const storedCode = await AsyncStorage.getItem(INVITE_CODE_KEY);

      // In dev/simulation: any 6-char code works if no stored code exists,
      // or if it matches the stored code
      if (!storedCode || storedCode === trimmed) {
        await AsyncStorage.setItem(TEAM_CODE_KEY, trimmed);
        setJoinStatus('success');
      } else {
        setJoinStatus('error');
      }
    } catch {
      // Fallback: accept any valid 6-char code
      try {
        await AsyncStorage.setItem(TEAM_CODE_KEY, trimmed);
        setJoinStatus('success');
      } catch {
        setJoinStatus('error');
      }
    }
  }, [enteredCode]);

  const handleClose = useCallback((): void => {
    onClose();
  }, [onClose]);

  const dynamicStyles = {
    overlay: {
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    card: {
      backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
      shadowColor: colorScheme === 'dark' ? '#000' : '#333',
    },
    codeBox: {
      backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
      borderColor: colorScheme === 'dark' ? '#3A3A3C' : '#D1D1D6',
    },
    codeText: {
      color: colorScheme === 'dark' ? '#FFD60A' : '#1C1C1E',
    },
    input: {
      backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
      borderColor: colorScheme === 'dark' ? '#3A3A3C' : '#D1D1D6',
      color: colorScheme === 'dark' ? '#FFFFFF' : '#1C1C1E',
    },
    primaryButton: {
      backgroundColor: '#007AFF',
    },
    secondaryButton: {
      backgroundColor: colorScheme === 'dark' ? '#3A3A3C' : '#E5E5EA',
    },
    closeIconButton: {
      backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
    },
    divider: {
      backgroundColor: colorScheme === 'dark' ? '#3A3A3C' : '#E5E5EA',
    },
    successText: {
      color: '#34C759',
    },
    errorText: {
      color: '#FF3B30',
    },
    copiedText: {
      color: '#34C759',
    },
    emailInput: {
      backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
      borderColor: colorScheme === 'dark' ? '#3A3A3C' : '#D1D1D6',
      color: colorScheme === 'dark' ? '#FFFFFF' : '#1C1C1E',
    },
  };

  const renderManagerContent = (): React.JSX.Element => (
    <>
      <ThemedText style={styles.subtitle}>
        Share this code with your worker so they can join your team.
      </ThemedText>

      <View style={styles.codeSectionLabel}>
        <ThemedText style={styles.sectionLabel}>Invite Code</ThemedText>
      </View>

      <View style={[styles.codeBox, dynamicStyles.codeBox]}>
        <ThemedText
          style={[styles.codeText, dynamicStyles.codeText]}
          accessibilityLabel={`Invite code: ${inviteCode.split('').join(' ')}`}
        >
          {inviteCode || '------'}
        </ThemedText>
      </View>

      {codeCopied && (
        <ThemedText style={[styles.copiedFeedback, dynamicStyles.copiedText]}>
          ✓ Code shared!
        </ThemedText>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.buttonFlex,
            dynamicStyles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => { void handleCopyCode(); }}
          accessibilityRole="button"
          accessibilityLabel="Copy invite code"
        >
          <ThemedText style={styles.buttonTextLight}>Copy Code</ThemedText>
        </Pressable>

        <View style={styles.buttonGap} />

        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.buttonFlex,
            dynamicStyles.secondaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => { void regenerateCode(); }}
          accessibilityRole="button"
          accessibilityLabel="Regenerate invite code"
        >
          <ThemedText style={styles.buttonTextSecondary}>Regenerate</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.divider, dynamicStyles.divider]} />

      <ThemedText style={styles.sectionLabel}>{'Worker\'s email (optional)'}</ThemedText>
      <TextInput
        style={[styles.input, dynamicStyles.emailInput]}
        placeholder="worker@example.com"
        placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#AEAEB2'}
        value={workerEmail}
        onChangeText={setWorkerEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Worker email address input"
        accessibilityRole="none"
        maxLength={254}
      />

      <ThemedText style={styles.emailNote}>
        For your reference only — no email will be sent.
      </ThemedText>
    </>
  );

  const renderWorkerContent = (): React.JSX.Element => (
    <>
      <ThemedText style={styles.subtitle}>
        Enter the invite code your manager shared with you.
      </ThemedText>

      {joinStatus === 'success' ? (
        <View style={styles.successContainer}>
          <ThemedText style={[styles.successEmoji]}>🎉</ThemedText>
          <ThemedText style={[styles.successMessage, dynamicStyles.successText]}>
            {'You\'ve joined the team!'}
          </ThemedText>
          <ThemedText style={styles.successSub}>
            Joined! Welcome to the team.
          </ThemedText>
        </View>
      ) : (
        <>
          <View style={styles.codeSectionLabel}>
            <ThemedText style={styles.sectionLabel}>Invite Code</ThemedText>
          </View>

          <TextInput
            style={[
              styles.codeInput,
              dynamicStyles.input,
              joinStatus === 'error' && styles.inputError,
            ]}
            placeholder="A3F7KP"
            placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#AEAEB2'}
            value={enteredCode}
            onChangeText={(text) => {
              setEnteredCode(text.toUpperCase());
              if (joinStatus === 'error') setJoinStatus('idle');
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            accessibilityLabel="Enter invite code"
            accessibilityRole="none"
            keyboardType="default"
          />

          {joinStatus === 'error' && (
            <ThemedText style={[styles.errorText, dynamicStyles.errorText]}>
              Invalid code. Ask your manager for the correct code.
            </ThemedText>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.buttonFullWidth,
              dynamicStyles.primaryButton,
              pressed && styles.buttonPressed,
              enteredCode.length !== 6 && styles.buttonDisabled,
            ]}
            onPress={() => { void handleJoinTeam(); }}
            disabled={enteredCode.length !== 6}
            accessibilityRole="button"
            accessibilityLabel="Join team with invite code"
            accessibilityState={{ disabled: enteredCode.length !== 6 }}
          >
            <ThemedText style={styles.buttonTextLight}>Join Team</ThemedText>
          </Pressable>
        </>
      )}
    </>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.overlay, dynamicStyles.overlay]}>
          <View
            style={[styles.card, dynamicStyles.card]}
            accessibilityRole="none"
            accessible={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <ThemedText style={styles.title} accessibilityRole="header">
                {mode === 'manager' ? 'Invite a Team Member' : 'Join Your Manager\'s Team'}
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.closeIconButton,
                  dynamicStyles.closeIconButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ThemedText style={styles.closeIcon}>✕</ThemedText>
              </Pressable>
            </View>

            {/* Body */}
            <View style={styles.body}>
              {mode === 'manager' ? renderManagerContent() : renderWorkerContent()}
            </View>

            {/* Footer close */}
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.buttonFullWidth,
                dynamicStyles.secondaryButton,
                pressed && styles.buttonPressed,
                styles.closeButton,
              ]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close invite modal"
            >
              <ThemedText style={styles.buttonTextSecondary}>Close</ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
    letterSpacing: -0.3,
  },
  closeIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    marginTop: 8,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    opacity: 0.65,
    lineHeight: 18,
    marginBottom: 16,
  },
  codeSectionLabel: {
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    opacity: 0.55,
    marginBottom: 4,
  },
  codeBox: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  codeText: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  copiedFeedback: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 4,
    marginBottom: 16,
  },
  buttonGap: {
    width: 8,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonFullWidth: {
    width: '100%',
  },
  button: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonTextLight: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonTextSecondary: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.8,
  },
  divider: {
    height: 1,
    marginVertical: 14,
    borderRadius: 1,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 4,
  },
  emailNote: {
    fontSize: 11,
    opacity: 0.45,
    marginTop: 4,
    lineHeight: 15,
  },
  codeInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginBottom: 8,
  },
  inputError: {
    borderColor: '#FF3B30',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 12,
    lineHeight: 16,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  successEmoji: {
    fontSize: 44,
    marginBottom: 10,
  },
  successMessage: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: 'center',
  },
  closeButton: {
    marginTop: 0,
  },
});