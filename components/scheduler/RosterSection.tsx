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
    if (Platform.OS !== 'web') return;
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
    };
  }, []);

  if (!mounted || !containerRef.current) return null;

  // Use ReactDOM.createPortal — import ReactDOM from 'react-dom' only on web path
  // We conditionally require it to avoid native bundle issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const ReactDOM = require('react-dom') as any;
  return ReactDOM.createPortal(children, containerRef.current);
};

// Print style injector (web only)
const usePrintStyles = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web') return;
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
          accessibilityLabel={t('scheduler.roster.closeFullscreen')}
        >
          <ThemedText style={local.closeBtnText}>
            {t('scheduler.roster.closeFullscreen')}
          </ThemedText>
        </Pressable>
      </View>
      <View style={local.modalBody}>
        <WeekCalendar rosterByDate={rosterByDate} coverageByDate={coverageByDate} onMaximize={handleMaximize} />
      </View>
    </>
  );

  return (
    <>
      <SectionCard
        title={t('scheduler.roster.sectionTitle')}
        subtitle={t('scheduler.roster.sectionSubtitle')}
        tooltip={t('scheduler.roster.tooltip')}
      >
        {/* View toggle: List | Calendar */}
        <View style={local.toggleRow}>
          <Pressable
            onPress={() => setViewMode('list')}
            style={[local.toggleBtn, viewMode === 'list' && local.toggleBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={t('scheduler.roster.listView')}
            accessibilityState={{ selected: viewMode === 'list' }}
          >
            <ThemedText
              style={[
                local.toggleBtnText,
                viewMode === 'list' && local.toggleBtnTextActive,
              ]}
            >
              {t('scheduler.roster.listView')}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('calendar')}
            style={[local.toggleBtn, viewMode === 'calendar' && local.toggleBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={t('scheduler.roster.calendarView')}
            accessibilityState={{ selected: viewMode === 'calendar' }}
          >
            <ThemedText
              style={[
                local.toggleBtnText,
                viewMode === 'calendar' && local.toggleBtnTextActive,
              ]}
            >
              {t('scheduler.roster.calendarView')}
            </ThemedText>
          </Pressable>
        </View>

        {/* ── CALENDAR VIEW ── */}
        {viewMode === 'calendar' ? (
          <>
            {calendarContent}

            {/* Fullscreen modal — native */}
            {Platform.OS !== 'web' && (
              <Modal
                visible={isMaximized}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={handleCloseMaximize}
              >
                <SafeAreaView style={local.modalOverlay}>
                  {fullscreenContent}
                </SafeAreaView>
              </Modal>
            )}

            {/* Fullscreen portal — web */}
            {Platform.OS === 'web' && isMaximized && (
              <WebFullscreenPortal>
                <View style={local.modalOverlay}>{fullscreenContent}</View>
              </WebFullscreenPortal>
            )}
          </>
        ) : null}

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' ? (
          <>
            {publishCelebration.badgeVisible ? (
              <View style={[styles.badge, local.positiveBadge, styles.securedBadge]}>
                <View style={[styles.securedDot, local.securedDot]} />
                <ThemedText style={local.badgeText}>
                  {t('scheduler.roster.secured')}
                </ThemedText>
              </View>
            ) : null}
            {Object.entries(rosterByDate).length === 0 ? (
              <View>
                <View style={styles.ghostContainer} accessibilityElementsHidden>
                  {[0, 1].map((i) => (
                    <View key={i} style={styles.ghostRow}>
                      <View style={styles.ghostBlock}>
                        <View style={[styles.ghostNameBar, local.ghostNameBar]} />
                        <View style={[styles.ghostTimeBar, local.ghostTimeBar]} />
                      </View>
                      <View style={[styles.ghostBadgeBar, { width: 52 }]} />
                    </View>
                  ))}
                </View>
                <View style={styles.ghostEmptyCta}>
                  <ThemedText style={styles.ghostEmptyCtaText}>
                    {t('scheduler.roster.emptyTitle')}
                  </ThemedText>
                </View>
                <ThemedText style={styles.ghostEmptyNote}>
                  {t('scheduler.roster.emptyDesc')}
                </ThemedText>
              </View>
            ) : null}
            {Object.entries(rosterByDate).map(([date, shifts]) => (
              <View key={date} style={styles.rosterDay}>
                <ThemedText type="defaultSemiBold">{date}</ThemedText>
                {shifts.map((shift) => (
                  <View key={shift.id} style={styles.rosterRow}>
                    <View style={styles.rowBetween}>
                      <ThemedText style={local.badgeText}>
                        {shift.template?.name ?? shift.templateId}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.status,
                          shift.status === 'Draft'
                            ? local.draftStatus
                            : local.publishedStatus,
                        ]}
                      >
                        {shift.status === 'Draft'
                          ? t('common.draft')
                          : t('common.published')}
                      </ThemedText>
                    </View>
                    <ThemedText>
                      {shift.worker?.name ?? shift.workerId} •{' '}
                      {shift.template?.start} – {shift.template?.end}
                    </ThemedText>
                    <View style={styles.rosterActions}>
                      <Pressable
                        onPress={() => handlePublishShift(shift.id)}
                        disabled={shift.status === 'Published'}
                        accessibilityRole="button"
                        accessibilityLabel={t('scheduler.roster.publishA11y')}
                        accessibilityState={{ disabled: shift.status === 'Published' }}
                        style={({ pressed }) => [
                          styles.actionChip,
                          shift.status === 'Published'
                            ? styles.disabledButton
                            : styles.actionChipPrimary,
                          !shift.status ||
                          (shift.status !== 'Published' && pressed)
                            ? {
                                opacity: 0.75,
                                backgroundColor: brand.primaryDark,
                              }
                            : undefined,
                        ]}
                      >
                        <ThemedText
                          style={
                            shift.status === 'Published'
                              ? local.disabledChipText
                              : local.actionChipText
                          }
                        >
                          {t('common.publish')}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => handleUnpublishShift(shift.id)}
                        disabled={shift.status === 'Draft'}
                        accessibilityRole="button"
                        accessibilityLabel={t('scheduler.roster.unpublishA11y')}
                        accessibilityState={{ disabled: shift.status === 'Draft' }}
                        style={({ pressed }) => [
                          styles.actionChip,
                          shift.status === 'Draft'
                            ? styles.disabledButton
                            : styles.actionChipPrimary,
                          shift.status !== 'Draft' && pressed
                            ? {
                                opacity: 0.75,
                                backgroundColor: brand.primaryDark,
                              }
                            : undefined,
                        ]}
                      >
                        <ThemedText
                          style={
                            shift.status === 'Draft'
                              ? local.disabledChipText
                              : local.actionChipText
                          }
                        >
                          {t('common.unpublish')}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => handleNotifyShift(shift.id)}
                        disabled={shift.notified}
                        accessibilityRole="button"
                        accessibilityLabel={t('scheduler.roster.notifyA11y')}
                        accessibilityState={{ disabled: !!shift.notified }}
                        style={({ pressed }) => [
                          styles.actionChip,
                          shift.notified
                            ? styles.disabledButton
                            : styles.actionChipPrimary,
                          !shift.notified && pressed
                            ? {
                                opacity: 0.75,
                                backgroundColor: brand.primaryDark,
                              }
                            : undefined,
                        ]}
                      >
                        <ThemedText
                          style={
                            shift.notified
                              ? local.disabledChipText
                              : local.actionChipText
                          }
                        >
                          {shift.notified
                            ? t('common.notified')
                            : t('common.notify')}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => onSelectShiftForNotes?.(shift)}
                        accessibilityRole="button"
                        accessibilityLabel={t('shiftNotes.openNotes')}
                        style={({ pressed }) => [
                          styles.actionChip,
                          { backgroundColor: colors.surfaceRaised },
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <ThemedText style={[local.mutedText, { color: colors.text }]}>
                          {t('shiftNotes.notesBtn')}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('scheduler.roster.upcoming.title')}
        subtitle={t('scheduler.roster.upcoming.subtitle')}
      >
        {upcomingShifts.length === 0 ? (
          <ThemedText style={local.mutedText}>
            {t('scheduler.roster.upcoming.empty')}
          </ThemedText>
        ) : null}
        {upcomingShifts.map((shift) => (
          <View key={shift.id} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">
                {shift.worker?.name ?? shift.workerId}
              </ThemedText>
              <ThemedText style={local.mutedText}>
                {shift.template?.name ?? shift.templateId} •{' '}
                {shift.template?.start} – {shift.template?.end}
              </ThemedText>
            </View>
            <View style={local.statusPill}>
              <ThemedText style={local.statusPillText}>
                {shift.status === 'Draft'
                  ? t('common.draft')
                  : t('common.published')}
              </ThemedText>
              <ThemedText style={local.mutedText}>{shift.date}</ThemedText>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title={t('scheduler.roster.gaps.title')}
        subtitle={t('scheduler.roster.gaps.subtitle')}
      >
        {staffingGaps.length === 0 ? (
          <ThemedText>{t('scheduler.roster.gaps.allCovered')}</ThemedText>
        ) : (
          staffingGaps.map((gap) => (
            <View key={`${gap.date}-${gap.role}`} style={styles.rowBetween}>
              <View>
                <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                <ThemedText style={local.mutedText}>{gap.date}</ThemedText>
              </View>
              <View style={local.statusPill}>
                <ThemedText style={local.statusPillText}>
                  {t('scheduler.roster.gaps.scheduled', {
                    n: String(gap.scheduled),
                  })}
                </ThemedText>
                <ThemedText style={local.mutedText}>
                  {t('scheduler.roster.gaps.shortfall', {
                    n: String(gap.gap),
                  })}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </SectionCard>
    </>
  );
};