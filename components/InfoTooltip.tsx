/**
 * InfoTooltip — a small ⓘ button that shows encouraging help text.
 *
 * - Web: shown on hover (using onPointerEnter/Leave)
 * - Native: shown on long-press
 * - Dismisses on tap anywhere outside, or on second tap of the button
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Pressable,
  Modal,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { brand } from '@/constants/Colors';

type Props = {
  content: string;
  /** Optional accessible label override */
  label?: string;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOOLTIP_MAX_WIDTH = Math.min(SCREEN_WIDTH - 48, 320);

export function InfoTooltip({ content, label = 'More information' }: Props) {
  const [visible, setVisible] = useState(false);
  // Web hover state
  const [hovered, setHovered] = useState(false);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible((v) => !v), []);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrapper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Shows help information for this section"
          onPress={toggle}
          // @ts-ignore — web-only pointer events not in RN types
          onPointerEnter={() => { setHovered(true); setVisible(true); }}
          onPointerLeave={() => { setHovered(false); setVisible(false); }}
          style={[styles.iconButton, hovered && styles.iconButtonHovered]}
        >
          <ThemedText style={styles.iconText}>ⓘ</ThemedText>
        </Pressable>
        {visible && (
          <View style={styles.webTooltip} pointerEvents="none">
            <ThemedText style={styles.tooltipText}>{content}</ThemedText>
          </View>
        )}
      </View>
    );
  }

  // Native: long-press opens a modal overlay
  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Long press for help information"
        onLongPress={show}
        onPress={toggle}
        style={styles.iconButton}
      >
        <ThemedText style={styles.iconText}>ⓘ</ThemedText>
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={hide}
        statusBarTranslucent
      >
        <Pressable style={styles.modalOverlay} onPress={hide} accessibilityLabel="Close tooltip">
          <View style={styles.modalCard}>
            <ThemedText style={styles.tooltipText}>{content}</ThemedText>
            <Pressable
              onPress={hide}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <ThemedText style={styles.closeText}>Got it ✓</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  iconButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconButtonHovered: {
    backgroundColor: brand.primary + '22',
  },
  iconText: {
    fontSize: 16,
    color: brand.primary,
    lineHeight: 20,
  },
  // ─── Web tooltip ─────────────────────────────────────────────────────────
  webTooltip: {
    position: 'absolute',
    top: 28,
    left: 0,
    zIndex: 999,
    maxWidth: TOOLTIP_MAX_WIDTH,
    backgroundColor: '#1C2B3A',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  // ─── Native modal ─────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#1C2B3A',
    borderRadius: 16,
    padding: 20,
    maxWidth: TOOLTIP_MAX_WIDTH,
    width: '100%',
  },
  tooltipText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#E8F4F1',
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: brand.primary,
    borderRadius: 8,
  },
  closeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
