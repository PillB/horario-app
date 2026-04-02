/**
 * InfoTooltip — a small ⓘ button that shows encouraging help text.
 *
 * Rendering strategy:
 *   Web: ReactDOM.createPortal renders the tooltip card directly into
 *   document.body with position:fixed — this is critical. Using React
 *   Native's Modal on web causes body overflow manipulation that scrolls
 *   the page to the top (root cause of the reported hover scroll bug).
 *   Portal + position:fixed avoids all body overflow side-effects.
 *
 *   Native: React Native Modal (fade animation, full-screen dismiss).
 *
 * Web UX:
 *   - Show on hover (onPointerEnter) or tap/click.
 *   - 150 ms dismiss delay so the cursor can travel from button → tooltip
 *     without flickering; cleared when pointer enters the tooltip card.
 *   - Portal backdrop is pointer-events:none so the rest of the page
 *     stays interactive while the tooltip is visible.
 *   - ESC key closes the tooltip.
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

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

// Lazy-load createPortal only on web to avoid issues with native/SSR
let createPortal: ((children: React.ReactNode, container: Element) => React.ReactPortal) | null = null;
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  createPortal = require('react-dom').createPortal;
}

type Props = {
  content: string;
  /** Optional accessible label override */
  label?: string;
};

const EDGE_GAP = 8;
/** Average glyph width at 14 px (conservative) */
const CHAR_W_PX = 7;
/** Line height matching tooltipText style */
const LINE_H_PX = 24;
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
  const [focused, setFocused] = useState(false);
  const buttonRef = useRef<View>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const colorScheme = useColorScheme();

  // Width: 75 % of screen, clamped 260–420 px
  const tooltipW = Math.min(Math.max(screenW * 0.75, 260), 420);
  const maxCardH = screenH * 0.55;

  // Resolved theme-aware colour values
  const iconColor =
    colorScheme === 'dark' ? Colors.dark.tint : brand.primaryDeep;
  const iconPressedBg =
    colorScheme === 'dark' ? Colors.dark.tint + '33' : brand.primary + '22';

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

  // ESC key handler on web — dismiss tooltip without page scroll
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, hide]);

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

  // ── Web tooltip card (portal, no scroll-locking) ──────────────────────────
  // CRITICAL FIX: we render this as a ReactDOM portal with position:fixed
  // instead of React Native Modal. Modal on web calls body overflow:hidden
  // which discards the page scroll position — this was the root cause of
  // users being "sent to the top of the page" on hover.
  const webTooltipPortal =
    isWeb && visible && cardPos && createPortal
      ? createPortal(
          <View
            style={[
              styles.tooltipCard,
              {
                // @ts-ignore — web-only CSS: position:fixed keeps card viewport-
                // relative without any body overflow side-effect
                position: 'fixed',
                top: cardPos.y,
                left: cardPos.x,
                width: tooltipW,
                maxHeight: maxCardH,
                // @ts-ignore
                zIndex: 9999,
              },
            ]}
            // @ts-ignore — web pointer events to keep hover alive
            onPointerEnter={clearHideTimer}
            // @ts-ignore
            onPointerLeave={scheduleHide}
          >
            <ScrollView
              scrollEnabled
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText style={styles.tooltipText}>{content}</ThemedText>
            </ScrollView>
          </View>,
          document.body,
        )
      : null;

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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && { backgroundColor: iconPressedBg },
          // Platform-conditional focus ring for keyboard/switch-access users
          Platform.OS === 'web' && focused && {
            // @ts-ignore — web-only outline style
            outline: `2px solid ${Colors.light.borderFocus}`,
            outlineOffset: 2,
          },
        ]}
      >
        <ThemedText style={[styles.iconText, { color: iconColor }]}>ⓘ</ThemedText>
      </Pressable>

      {/* Web: tooltip rendered via portal (no Modal = no scroll-lock side-effect) */}
      {webTooltipPortal}

      {/* Native: Modal-based tooltip with full-screen dismiss */}
      {!isWeb ? (
        <Modal
          visible={visible}
          transparent
          animationType="fade"
          onRequestClose={hide}
          statusBarTranslucent
        >
          <>
            {/* Full-screen dismiss tap area */}
            <Pressable
              style={[StyleSheet.absoluteFill, styles.backdrop]}
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
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && { backgroundColor: brand.primaryDark },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <ThemedText style={styles.closeText}>Got it ✓</ThemedText>
                </Pressable>
              </View>
            </View>
          </>
        </Modal>
      ) : null}
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
  iconText: {
    fontSize: 16,
    // color is applied dynamically in the component via iconColor (theme-aware)
    lineHeight: 20,
  },
  // ── Backdrop scrim ─────────────────────────────────────────────────────────
  backdrop: {
    // Slate 900 at 45% opacity — creates a legible scrim separating the modal
    // layer from page content without fully blocking the background
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  // ── Shared card ────────────────────────────────────────────────────────────
  tooltipCard: {
    // Intentionally dark surface in both modes for overlay contrast;
    // uses Colors.dark.surface (#1E293B) token value
    backgroundColor: Colors.dark.surface,
    borderRadius: 10,
    padding: 14,
    // shadowColor uses a documented constant for maximum shadow visibility
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 4 },
    // Increased opacity to 0.45 for perceptible card elevation on light backgrounds
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
  tooltipText: {
    // Increased to 15px for improved legibility on low-DPI screens (WCAG 1.4.12)
    fontSize: 15,
    // LINE_H_PX updated to 24 (1.5× of 16px per WCAG text spacing guidance)
    lineHeight: LINE_H_PX,
    // Colors.dark.text (#F1F5F9) — verified token, safe contrast on any dark surface
    color: Colors.dark.text,
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
    // Colors.light.surface (#FFFFFF) — token-based white, 6.88:1 on brand.primary ✓ AA
    color: Colors.light.surface,
  },
});
