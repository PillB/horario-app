/**
 * WeekCalendar.tsx
 *
 * A visual weekly calendar for the Roster screen.
 * Displays shift chips in 7 day columns (Sun–Sat) for the current week.
 *
 * Props:
 *   rosterByDate    – Record<dateString, RosterShift[]>
 *   coverageByDate  – optional Record<dateString, { scheduled: number; required: number }>
 *   onMaximize      – optional callback to enter full-screen modal
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';

import { useT } from '@/contexts/LocaleContext';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RosterShift = Shift & {
  template?: ShiftTemplate;
  worker?: Worker;
};

interface WeekCalendarProps {
  rosterByDate: Record<string, RosterShift[]>;
  coverageByDate?: Record<string, { scheduled: number; required: number }>;
  onMaximize?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the Sunday of the week containing `date`.
 */
function getSundayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formats a Date as "YYYY-MM-DD" in local time (matches the keys used in rosterByDate).
 */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds `days` days to `date` and returns a new Date.
 */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Formats a Date as short day label "Mon 1" etc.
 */
function formatDayLabel(date: Date, t: (key: string) => string): string {
  // We'll build "Mon 1" style ourselves to avoid date-fns dependency.
  const dayNames = [
    t('weekday.sun'),
    t('weekday.mon'),
    t('weekday.tue'),
    t('weekday.wed'),
    t('weekday.thu'),
    t('weekday.fri'),
    t('weekday.sat'),
  ];
  return `${dayNames[date.getDay()]} ${date.getDate()}`;
}

/**
 * Formats a date range "Mar 30 – Apr 5, 2026".
 */
function formatWeekRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString(undefined, opts);
  const endStr = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
}

/**
 * Returns the status colour for a shift chip.
 */
function statusColor(
  status: RosterShift['status'],
  colors: ThemeColors
): string {
  switch (status) {
    case 'Published':
      return colors.tint; // teal
    case 'Draft':
    default:
      return brand.accentDark; // amber
  }
}

/**
 * Returns a contrasting text colour (black or white) for a background.
 * Simple luminance check.
 */
function contrastTextColor(hexBg: string): string {
  const r = parseInt(hexBg.slice(1, 3), 16);
  const g = parseInt(hexBg.slice(3, 5), 16);
  const b = parseInt(hexBg.slice(5, 7), 16);
  // Relative luminance (simplified)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111827' : '#FFFFFF';
}

/**
 * Returns the coverage indicator color based on scheduled vs required counts.
 */
function coverageColor(scheduled: number, required: number): string {
  if (scheduled >= required) return '#16A34A'; // green
  if (scheduled > 0) return '#D97706';          // amber
  return '#DC2626';                              // red
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ShiftChipProps {
  shift: RosterShift;
  chipBg: string;
  chipText: string;
}

function ShiftChip({ shift, chipBg, chipText }: ShiftChipProps) {
  const templateName = shift.template?.name ?? '–';
  const workerName = shift.worker
    ? `${shift.worker.name}`
    : '–';
  const statusLabel = shift.status === 'Published' ? 'Published' : 'Draft';
  const hasTimeRange = !!(shift.template?.start && shift.template?.end);
  const timeRange = hasTimeRange
    ? `${shift.template!.start} – ${shift.template!.end}`
    : null;

  const chipStyles = StyleSheet.create({
    chip: {
      backgroundColor: chipBg,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 4,
      marginBottom: 4,
    },
    templateText: {
      fontSize: 11,
      fontWeight: '600',
      color: chipText,
    },
    workerText: {
      fontSize: 10,
      color: chipText,
      opacity: 0.9,
    },
    timeText: {
      fontSize: 9,
      color: chipText,
      opacity: 0.75,
    },
  });

  return (
    <View
      style={chipStyles.chip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${workerName}, ${templateName}, ${statusLabel}${timeRange ? `, ${timeRange}` : ''}`}
    >
      <Text style={chipStyles.templateText} numberOfLines={1}>
        {templateName}
      </Text>
      <Text style={chipStyles.workerText} numberOfLines={1}>
        {workerName}
      </Text>
      {hasTimeRange ? (
        <Text style={chipStyles.timeText} numberOfLines={1}>
          {timeRange}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WeekCalendar({ rosterByDate, coverageByDate, onMaximize }: WeekCalendarProps) {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  // ---- Week state ----------------------------------------------------------
  const [weekStart, setWeekStart] = React.useState<Date>(() =>
    getSundayOfWeek(new Date())
  );

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const weekDays = useMemo<Date[]>(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const weekRangeLabel = useMemo(
    () => formatWeekRange(weekStart, weekEnd),
    [weekStart, weekEnd]
  );

  // ---- Navigation ----------------------------------------------------------
  const goToPrevWeek = useCallback(() => {
    setWeekStart((prev) => addDays(prev, -7));
  }, []);

  const goToNextWeek = useCallback(() => {
    setWeekStart((prev) => addDays(prev, 7));
  }, []);

  const goToToday = useCallback(() => {
    setWeekStart(getSundayOfWeek(new Date()));
  }, []);

  // ---- Derived data --------------------------------------------------------
  const shiftsThisWeek = useMemo(() => {
    const result: Record<string, RosterShift[]> = {};
    weekDays.forEach((day) => {
      const key = toLocalDateString(day);
      result[key] = rosterByDate[key] ?? [];
    });
    return result;
  }, [rosterByDate, weekDays]);

  const hasAnyShifts = useMemo(
    () => Object.values(shiftsThisWeek).some((arr) => arr.length > 0),
    [shiftsThisWeek]
  );

  // ---- Today highlight -----------------------------------------------------
  const todayKey = toLocalDateString(new Date());

  // -------------------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* ---- Header row -------------------------------------------------- */}
      <View style={styles.header}>
        <View style={styles.navRow}>
          <Pressable
            onPress={goToPrevWeek}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel={t('weekCalendar.prevWeek')}
          >
            <Text style={styles.navButtonText}>‹</Text>
          </Pressable>

          <Pressable
            onPress={goToToday}
            style={styles.todayButton}
            accessibilityRole="button"
            accessibilityLabel={t('weekCalendar.today')}
          >
            <Text style={styles.todayButtonText}>{t('weekCalendar.today')}</Text>
          </Pressable>

          <Pressable
            onPress={goToNextWeek}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel={t('weekCalendar.nextWeek')}
          >
            <Text style={styles.navButtonText}>›</Text>
          </Pressable>
        </View>

        <Text style={styles.weekRangeLabel} accessibilityRole="text">
          {weekRangeLabel}
        </Text>

        {onMaximize ? (
          <Pressable
            onPress={onMaximize}
            style={styles.maximizeButton}
            accessibilityRole="button"
            accessibilityLabel={t('weekCalendar.maximize')}
          >
            <Text style={styles.maximizeIcon}>⤢</Text>
          </Pressable>
        ) : null}
      </View>

      {/* ---- Calendar grid ----------------------------------------------- */}
      {/* @print-region */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.gridScrollContent}
        accessibilityRole="none"
      >
        <View style={styles.grid}>
          {/* Day column headers */}
          <View style={styles.columnHeaderRow}>
            {weekDays.map((day) => {
              const key = toLocalDateString(day);
              const isToday = key === todayKey;
              const cov = coverageByDate?.[key];
              const showCoverage = cov !== undefined && cov.required > 0;
              const dotColor = showCoverage
                ? coverageColor(cov!.scheduled, cov!.required)
                : undefined;

              return (
                <View
                  key={key}
                  style={[styles.columnHeader, isToday && styles.columnHeaderToday]}
                  accessibilityRole="header"
                >
                  <Text
                    style={[
                      styles.columnHeaderText,
                      isToday && styles.columnHeaderTextToday,
                    ]}
                  >
                    {formatDayLabel(day, t)}
                  </Text>
                  {showCoverage ? (
                    <View style={styles.coverageRow}>
                      <View
                        style={[
                          styles.coverageDot,
                          { backgroundColor: dotColor },
                        ]}
                      />
                      <Text
                        style={[styles.coverageText, { color: dotColor }]}
                      >
                        {`${cov!.scheduled}/${cov!.required}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Legend row — only when there are shifts */}
          {hasAnyShifts ? (
            <View
              style={styles.legendRow}
              accessibilityRole="text"
              accessibilityLabel={t('weekCalendar.legend')}
            >
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: brand.accentDark }]}
                />
                <Text style={styles.legendText}>
                  {t('weekCalendar.legendDraft')}
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: colors.tint }]}
                />
                <Text style={styles.legendText}>
                  {t('weekCalendar.legendPublished')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Shift columns */}
          {hasAnyShifts ? (
            <View style={styles.columnsRow}>
              {weekDays.map((day) => {
                const key = toLocalDateString(day);
                const shifts = shiftsThisWeek[key] ?? [];
                const isToday = key === todayKey;

                return (
                  <View
                    key={key}
                    style={[
                      styles.dayColumn,
                      isToday && styles.dayColumnToday,
                    ]}
                  >
                    {shifts.length === 0 ? (
                      <View style={styles.emptyDayCell} />
                    ) : (
                      shifts.map((shift) => {
                        const bg = statusColor(shift.status, colors);
                        const textCol = contrastTextColor(bg);
                        return (
                          <ShiftChip
                            key={shift.id}
                            shift={shift}
                            chipBg={bg}
                            chipText={textCol}
                          />
                        );
                      })
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyStateRow}>
              <Text style={styles.emptyStateText}>
                {t('weekCalendar.noShifts')}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
      {/* @print-region */}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles factory
// ---------------------------------------------------------------------------

function makeStyles(colors: ThemeColors) {
  const COLUMN_WIDTH = 120;

  return StyleSheet.create({
    container: {
      backgroundColor: colors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },

    // ---- Header ----
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexWrap: 'wrap',
      gap: 8,
    },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    navButton: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navButtonText: {
      fontSize: 20,
      color: colors.text,
      lineHeight: 24,
    },
    todayButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.tint,
    },
    todayButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    weekRangeLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      flexShrink: 1,
    },
    maximizeButton: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    maximizeIcon: {
      fontSize: 18,
      color: colors.text,
    },

    // ---- Grid scroll container ----
    gridScrollContent: {
      flexGrow: 1,
    },
    grid: {
      flexDirection: 'column',
      minWidth: COLUMN_WIDTH * 7,
    },

    // ---- Column headers ----
    columnHeaderRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    columnHeader: {
      width: COLUMN_WIDTH,
      paddingVertical: 8,
      paddingHorizontal: 6,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    columnHeaderToday: {
      backgroundColor: colors.tint + '22', // teal tint at 13% opacity
    },
    columnHeaderText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    columnHeaderTextToday: {
      color: colors.tint,
    },

    // ---- Coverage indicator ----
    coverageRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 3,
      gap: 3,
    },
    coverageDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    coverageText: {
      fontSize: 9,
    },

    // ---- Legend row ----
    legendRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 16,
      paddingVertical: 4,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    legendText: {
      fontSize: 11,
      color: colors.textSecondary,
      marginLeft: 4,
    },

    // ---- Day columns ----
    columnsRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    dayColumn: {
      width: COLUMN_WIDTH,
      minHeight: 80,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    dayColumnToday: {
      backgroundColor: colors.tint + '11', // subtle teal wash
    },
    emptyDayCell: {
      minHeight: 40,
    },

    // ---- Empty state ----
    emptyStateRow: {
      paddingVertical: 32,
      alignItems: 'center',
      justifyContent: 'center',
      width: COLUMN_WIDTH * 7,
    },
    emptyStateText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
  });
}