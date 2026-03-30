/**
 * InfoTooltip — a small ⓘ button that shows encouraging help text.
 *
 * Rendering strategy:
 *   Both web and native use React Native's Modal, which on web portals to
 *   document.body — guaranteed top layer, never occluded by parent stacking
 *   contexts or ScrollView containers.
 *
 * Web UX:
 *   - Show on hover (onPointerEnter) or tap/click.
 *   - 150 ms dismiss delay so the cursor can travel from button → tooltip
 *     without flickering; cleared when pointer enters the tooltip card.
 *   - Modal backdrop is pointer-events:none so the rest of the page
 *     stays interactive while the tooltip is visible.
 *   - ESC / onRequestClose dismisses.
 *
 * Native UX:
 *   - Show on tap or long-press.
 *   - Full-screen dismiss area + "Got it ✓" button.
 *
 * Sizing:
 *   - Width  = clamp(screenWidth × 0.75, 260 px, 420 px)
 *   - Height = maxHeight screenHeight × 0.55 (scrollable if taller)
 *   - Position: below button by default; flips above when insufficient
 *     space below, using a character-count height estimate as the basis.
 *   - Horizontally clamped within an 8 px viewport gutter.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { brand } from '@/constants/Colors';

type Props = {
  content: string;
  /** Optional accessible label override */
  label?: string;
};

const EDGE_GAP = 8;
/** Average glyph width at 14 px (conservative) */
const CHAR_W_PX = 7;
/** Line height matching tooltipText style */
const LINE_H_PX = 22;
/** Vertical padding inside the card */
const CARD_VERT_PAD = 28;

/** Estimate rendered card height from content and card width (pixels). */
function estimateCardHeight(content: string, cardWidth: number, maxH: number): number {
  const innerW = Math.max(1, cardWidth - 28); // subtract horizontal padding
  const charsPerLine = Math.max(1, Math.floor(innerW / CHAR_W_PX));
  const lines = Math.ceil(content.length / charsPerLine);
  return Math.min(lines * LINE_H_PX + CARD_VERT_PAD, maxH);
}

export function InfoTooltip({ content, label = 'More information' }: Props) {
  const [visible, setVisible] = useState(false);
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<View>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Width: 75 % of screen, clamped 260–420 px
  const tooltipW = Math.min(Math.max(screenW * 0.75, 260), 420);
  const maxCardH = screenH * 0.55;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setVisible(false), 150);
  }, [clearHideTimer]);

  const hide = useCallback(() => {
    clearHideTimer();
    setVisible(false);
  }, [clearHideTimer]);

  /**
   * Measures button viewport position and computes tooltip coordinates.
   * On web uses getBoundingClientRect (viewport-relative, works inside ScrollViews).
   * On native uses measure() (page-relative absolute coords).
   * Falls back to null → native centered layout.
   */
  const measureAndShow = useCallback(() => {
    clearHideTimer();

    const computeAndShow = (left: number, top: number, bottom: number) => {
      const approxH = estimateCardHeight(content, tooltipW, maxCardH);
      const spaceBelow = screenH - bottom - EDGE_GAP;
      const useAbove =
        spaceBelow < approxH + EDGE_GAP && top > approxH + EDGE_GAP;
      const y = useAbove
        ? Math.max(EDGE_GAP, top - approxH - 8)
        : bottom + 8;
      const x = Math.min(
        Math.max(left, EDGE_GAP),
        screenW - tooltipW - EDGE_GAP
      );
      setCardPos({ x, y });
      setVisible(true);
    };

    const node = buttonRef.current as any;
    if (Platform.OS === 'web' && typeof node?.getBoundingClientRect === 'function') {
      const rect: DOMRect = node.getBoundingClientRect();
      computeAndShow(rect.left, rect.top, rect.bottom);
    } else if (typeof node?.measure === 'function') {
      node.measure(
        (
          _x: number,
          _y: number,
          _w: number,
          height: number,
          pageX: number,
          pageY: number
        ) => {
          computeAndShow(pageX, pageY, pageY + height);
        }
      );
    } else {
      // Measurement unavailable — use centered native layout
      setCardPos(null);
      setVisible(true);
    }
  }, [content, screenW, screenH, tooltipW, maxCardH, clearHideTimer]);

  const isWeb = Platform.OS === 'web';

  return (
    <View
      ref={buttonRef}
      style={styles.wrapper}
      // collapsable={false} keeps the native View node alive for measure()
      collapsable={false}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={
          isWeb
            ? 'Shows help information for this section'
            : 'Long press for help information'
        }
        onPress={measureAndShow}
        onLongPress={!isWeb ? measureAndShow : undefined}
        // @ts-ignore — web-only pointer events not in RN types
        onPointerEnter={isWeb ? measureAndShow : undefined}
        // @ts-ignore — web-only pointer events not in RN types
        onPointerLeave={isWeb ? scheduleHide : undefined}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && styles.iconButtonPressed,
        ]}
      >
        <ThemedText style={styles.iconText}>ⓘ</ThemedText>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType={isWeb ? 'none' : 'fade'}
        onRequestClose={hide}
        statusBarTranslucent
      >
        {isWeb && cardPos ? (
          // ── Web: positioned card, backdrop passes pointer events through ──
          //
          // The outer View fills the screen but uses pointerEvents="box-none"
          // so the page behind stays interactive — only the card itself
          // captures pointer events (to keep hover alive).
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View
              style={[
                styles.tooltipCard,
                {
                  position: 'absolute',
                  top: cardPos.y,
                  left: cardPos.x,
                  width: tooltipW,
                  maxHeight: maxCardH,
                },
              ]}
              // @ts-ignore — web pointer events
              onPointerEnter={clearHideTimer}
              // @ts-ignore — web pointer events
              onPointerLeave={scheduleHide}
            >
              <ScrollView
                scrollEnabled
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <ThemedText style={styles.tooltipText}>{content}</ThemedText>
              </ScrollView>
            </View>
          </View>
        ) : (
          // ── Native (or web fallback): centred card with dismiss controls ──
          <>
            {/* Full-screen dismiss tap area */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={hide}
              accessibilityLabel="Close tooltip"
            />
            <View style={styles.nativeOverlay} pointerEvents="box-none">
              <View
                style={[
                  styles.tooltipCard,
                  { width: tooltipW, maxHeight: maxCardH },
                ]}
              >
                <ScrollView
                  scrollEnabled
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <ThemedText style={styles.tooltipText}>{content}</ThemedText>
                </ScrollView>
                <Pressable
                  onPress={hide}
                  style={styles.closeButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <ThemedText style={styles.closeText}>Got it ✓</ThemedText>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
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
  iconButtonPressed: {
    backgroundColor: brand.primary + '22',
  },
  iconText: {
    fontSize: 16,
    color: brand.primary,
    lineHeight: 20,
  },
  // ── Shared card ────────────────────────────────────────────────────────────
  tooltipCard: {
    backgroundColor: '#1C2B3A',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  tooltipText: {
    fontSize: 14,
    lineHeight: LINE_H_PX,
    color: '#E8F4F1',
  },
  // ── Native centred layout ──────────────────────────────────────────────────
  nativeOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
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
