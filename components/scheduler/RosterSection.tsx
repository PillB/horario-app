import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Modal,
  Platform,
  SafeAreaView,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import { type DemandForecast } from '@/services/demandForecast';
import { SectionCard } from './SectionCard';
import { WeekCalendar } from './WeekCalendar';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type RosterShift = Shift & { template?: ShiftTemplate; worker?: Worker };
type StaffingGap = DemandForecast & { scheduled: number; gap: number };

type ViewMode = 'list' | 'calendar';

type Props = {
  publishCelebration: { badgeVisible: boolean; confettiBurst: boolean };
  rosterByDate: Record<string, RosterShift[]>;
  handlePublishShift: (shiftId: string) => void;
  handleUnpublishShift: (shiftId: string) => void;
  handleNotifyShift: (shiftId: string) => void;
  onSelectShiftForNotes?: (shift: RosterShift) => void;
  upcomingShifts: RosterShift[];
  staffingGaps: StaffingGap[];
};

const makeLocalStyles = (colors: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    positiveBadge: {
      backgroundColor: colors.successSurface,
    },
    securedDot: {
      backgroundColor: colors.success,
    },
    badgeText: {
      color: colors.success,
    },
    draftStatus: {
      color: colors.warning,
    },
    publishedStatus: {
      color: isDark ? colors.tint : brand.primaryDeep,
    },
    actionChipText: {
      color: Colors.light.surface,
      fontSize: 13,
      fontWeight: '600',
    },
    disabledChipText: {
      color: isDark ? Colors.dark.textTertiary : Colors.light.textTertiary,
      fontSize: 13,
      fontWeight: '600',
    },
    mutedText: {
      color: colors.textSecondary,
    },
    statusPill: {
      backgroundColor: isDark ? colors.surfaceRaised : Colors.light.surface,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      alignItems: 'flex-end',
    },
    statusPillText: {
      color: colors.text,
    },
    shiftRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: 8,
      minHeight: 44,
    },
    shiftRowLeft: {
      flex: 1,
      gap: 2,
    },
    shiftWorkerName: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: colors.text,
    },
    shiftTime: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    ghostNameBar: {
      backgroundColor: isDark ? Colors.dark.border : Colors.light.border,
    },
    ghostTimeBar: {
      backgroundColor: isDark ? Colors.dark.border : Colors.light.border,
    },
    // View toggle row
    toggleRow: {
      flexDirection: 'row',
      marginBottom: 12,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      alignSelf: 'flex-start',
    },
    toggleBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: isDark ? colors.surfaceRaised : Colors.light.surface,
    },
    toggleBtnActive: {
      backgroundColor: brand.primary,
    },
    toggleBtnText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
    },
    toggleBtnTextActive: {
      color: Colors.light.surface,
      fontWeight: '600',
    },
    // Maximize modal
    modalOverlay: {
      flex: 1,
      backgroundColor: isDark ? Colors.dark.background : Colors.light.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.surfaceRaised,
    },
    closeBtnText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    modalBody: {
      flex: 1,
    },
    // Web portal fullscreen overlay
    webOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: isDark ? Colors.dark.background : Colors.light.background,
      zIndex: 9999,
    },
    webOverlayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    webOverlayBody: {
      flex: 1,
    },
    printRegion: {
      flex: 1,
    },
  });

// Web-only portal component
type WebPortalProps = {
  children: React.ReactNode;
};

const WebFullscreenPortal: React.FC<WebPortalProps> = ({ children }) => {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Guard: must be web platform AND document must exist (SSR safety)
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.top = '0';
    div.style.left = '0';
    div.style.right = '0';
    div.style.bottom = '0';
    div.style.zIndex = '9999';
    document.body.appendChild(div);
    containerRef.current = div;
    setMounted(true);

    return () => {
      if (div.parentNode) {
        div.parentNode.removeChild(div);
      }
      containerRef.current = null;
    };
  }, []);

  // SSR / non-web: never render portal
  if (Platform.OS !== 'web') return null;

  // Not yet mounted or document unavailable (SSR)
  if (!mounted || !containerRef.current) return null;

  // Guard: document must be available before requiring react-dom
  if (typeof document === 'undefined') return null;

  try {
    const ReactDOM = require('react-dom') as typeof import('react-dom');
    return ReactDOM.createPortal(children, containerRef.current);
  } catch {
    return null;
  }
};

// Print style injector (web only)
const usePrintStyles = (enabled: boolean) => {
  useEffect(() => {
    // Guard: must be web platform AND document must exist (SSR safety)
    if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return;

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-horario-print', 'roster');
    styleEl.textContent = `
      @media print {
        body > *:not(.print-region) { display: none !important; }
        .print-region { display: block !important; }
      }
    `;
    document.head.appendChild(styleEl);

    return () => {
      if (styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    };
  }, [enabled]);
};

export const RosterSection = ({
  publishCelebration,
  rosterByDate,
  handlePublishShift,
  handleUnpublishShift,
  handleNotifyShift,
  onSelectShiftForNotes,
  upcomingShifts,
  staffingGaps,
}: Props) => {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const local = makeLocalStyles(colors, isDark);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [isMaximized, setIsMaximized] = useState(false);

  // Aggregate staffing gaps into a per-date coverage map for the calendar
  const coverageByDate = useMemo(() => {
    const result: Record<string, { scheduled: number; required: number }> = {};
    staffingGaps.forEach((gap) => {
      const existing = result[gap.date];
      if (!existing) {
        result[gap.date] = { scheduled: gap.scheduled, required: gap.required };
      } else {
        result[gap.date] = {
          scheduled: existing.scheduled + gap.scheduled,
          required: existing.required + gap.required,
        };
      }
    });
    return result;
  }, [staffingGaps]);

  // Inject print styles on web
  usePrintStyles(Platform.OS === 'web');

  const handleMaximize = () => setIsMaximized(true);
  const handleCloseMaximize = () => setIsMaximized(false);

  const calendarContent = (
    <View style={local.printRegion} className="print-region">
      <WeekCalendar rosterByDate={rosterByDate} coverageByDate={coverageByDate} onMaximize={handleMaximize} />
    </View>
  );

  const fullscreenContent = (
    <>
      <View style={local.modalHeader}>
        <Pressable
          onPress={handleCloseMaximize}
          style={local.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <ThemedText style={local.closeBtnText}>{t('common.close')}</ThemedText>
        </Pressable>
      </View>
      <View style={local.modalBody}>
        {calendarContent}
      </View>
    </>
  );

  return (
    <SectionCard title={t('scheduler.roster.sectionTitle')}>
      {/* View mode toggle */}
      <View style={local.toggleRow}>
        <Pressable
          style={[local.toggleBtn, viewMode === 'list' && local.toggleBtnActive]}
          onPress={() => setViewMode('list')}
          accessibilityRole="button"
          accessibilityState={{ selected: viewMode === 'list' }}
        >
          <ThemedText
            style={[local.toggleBtnText, viewMode === 'list' && local.toggleBtnTextActive]}
          >
            {t('scheduler.roster.viewList')}
          </ThemedText>
        </Pressable>
        <Pressable
          style={[local.toggleBtn, viewMode === 'calendar' && local.toggleBtnActive]}
          onPress={() => setViewMode('calendar')}
          accessibilityRole="button"
          accessibilityState={{ selected: viewMode === 'calendar' }}
        >
          <ThemedText
            style={[local.toggleBtnText, viewMode === 'calendar' && local.toggleBtnTextActive]}
          >
            {t('scheduler.roster.viewCalendar')}
          </ThemedText>
        </Pressable>
      </View>

      {viewMode === 'calendar' ? (
        <>
          {calendarContent}

          {/* Maximized / fullscreen overlay */}
          {isMaximized && Platform.OS === 'web' ? (
            <WebFullscreenPortal>
              <View style={local.webOverlay}>
                <View style={local.webOverlayHeader}>
                  <Pressable
                    onPress={handleCloseMaximize}
                    style={local.closeBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <ThemedText style={local.closeBtnText}>{t('common.close')}</ThemedText>
                  </Pressable>
                </View>
                <View style={local.webOverlayBody}>
                  {calendarContent}
                </View>
              </View>
            </WebFullscreenPortal>
          ) : isMaximized ? (
            <Modal
              visible={isMaximized}
              animationType="slide"
              onRequestClose={handleCloseMaximize}
              statusBarTranslucent
            >
              <SafeAreaView style={local.modalOverlay}>
                {fullscreenContent}
              </SafeAreaView>
            </Modal>
          ) : null}
        </>
      ) : (
        /* List view — render upcomingShifts */
        upcomingShifts.map((shift) => (
          <Pressable
            key={shift.id}
            onPress={() => onSelectShiftForNotes?.(shift)}
            accessibilityRole="button"
          >
            <View style={local.shiftRow}>
              <View style={local.shiftRowLeft}>
                <ThemedText style={local.shiftWorkerName}>
                  {shift.worker?.name ?? t('scheduler.roster.unassigned')}
                </ThemedText>
                <ThemedText style={[local.shiftTime, local.mutedText]}>
                  {shift.template?.name ?? shift.date}
                </ThemedText>
              </View>
              <View style={local.statusPill}>
                <ThemedText
                  style={[
                    local.statusPillText,
                    shift.status === 'Draft' ? local.draftStatus : local.publishedStatus,
                  ]}
                >
                  {shift.status === 'Draft'
                    ? t('scheduler.roster.draft')
                    : t('scheduler.roster.published')}
                </ThemedText>
              </View>
            </View>
          </Pressable>
        ))
      )}
    </SectionCard>
  );
};