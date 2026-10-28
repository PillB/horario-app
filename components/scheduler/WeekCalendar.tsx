/**
 * WeekCalendar.tsx
 *
 * A visual weekly calendar for the Roster screen.
 * Displays shift chips in 7 day columns (Sun–Sat) for the current week.
 * Also supports a month view with mini calendar grid.
 *
 * Props:
 *   rosterByDate    – Record<dateString, RosterShift[]>
 *   coverageByDate  – optional Record<dateString, { scheduled: number; required: number }>
 *   onMaximize      – optional callback to enter full-screen modal
 *   weekStartKey    – optional controlled first visible day ('YYYY-MM-DD', a Sunday)
 *   onWeekStartChange – called with the new first visible day when the week changes
 *   shiftMarkers    – optional labor-compliance verdict per shift id (shown on the chip)
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
import type { Verdict } from '@/services/labor/types';
import { parseDateKey } from '@/utils/dateKeys';

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
  weekStartKey?: string;
  onWeekStartChange?: (weekStartKey: string) => void;
  shiftMarkers?: Record<string, Verdict>;
}

type ViewMode = 'week' | 'month';

interface MonthCell {
  date: Date;
  inMonth: boolean;
  key: string;
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
 * Adds `months` months to `date` and returns a new Date (1st of resulting month).
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the first day (Date) of the month containing `date`.
 */
function getMonthStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formats a Date as short day label "Mon 1" etc.
 */
function formatDayLabel(date: Date, t: (key: string) => string): string {
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
 * Returns short weekday abbreviations for month column headers.
 */
function getWeekdayAbbreviations(t: (key: string) => string): string[] {
  return [
    t('weekday.sun'),
    t('weekday.mon'),
    t('weekday.tue'),
    t('weekday.wed'),
    t('weekday.thu'),
    t('weekday.fri'),
    t('weekday.sat'),
  ];
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
      return colors.tint;
    case 'Draft':
    default:
      return brand.accentDark;
  }
}

/**
 * Returns a contrasting text colour (black or white) for a background.
 */
function contrastTextColor(hexBg: string): string {
  const r = parseInt(hexBg.slice(1, 3), 16);
  const g = parseInt(hexBg.slice(3, 5), 16);
  const b = parseInt(hexBg.slice(5, 7), 16);
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

/**
 * Returns the dot color for a day cell in month view.
 */
function monthDotColor(
  shiftCount: number,
  cov: { scheduled: number; required: number } | undefined
): string {
  if (shiftCount === 0) {
    if (cov !== undefined && cov.required > 0) {
      return '#DC2626'; // red — demand but no shifts
    }
    return 'transparent'; // no dot
  }
  if (cov !== undefined && cov.required > 0) {
    if (cov.scheduled >= cov.required) return '#16A34A'; // green
    if (cov.scheduled > 0) return '#D97706';              // amber
    return '#DC2626';                                     // red
  }
  return '#6B7280'; // grey — shifts exist, no demand target
}

/**
 * Builds the grid cells for a month view: 5 or 6 rows × 7 columns.
 * Includes blank cells for days from the previous/next month.
 */
function buildMonthGrid(monthStart: Date): MonthCell[] {
  const firstDayOfMonth = new Date(monthStart);
  firstDayOfMonth.setDate(1);
  firstDayOfMonth.setHours(0, 0, 0, 0);

  const lastDayOfMonth = new Date(
    firstDayOfMonth.getFullYear(),
    firstDayOfMonth.getMonth() + 1,
    0
  );

  // Day of week the month starts on (0 = Sun)
  const startPadding = firstDayOfMonth.getDay();
  // Total cells = padding + days in month, rounded up to multiple of 7
  const daysInMonth = lastDayOfMonth.getDate();
  const totalCells = Math.ceil((startPadding + daysInMonth) / 7) * 7;

  const cells: MonthCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const offset = i - startPadding;
    const date = new Date(firstDayOfMonth);
    date.setDate(firstDayOfMonth.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    const inMonth = date.getMonth() === firstDayOfMonth.getMonth();
    cells.push({
      date,
      inMonth,
      key: toLocalDateString(date),
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ShiftChipProps {
  shift: RosterShift;
  chipBg: string;
  chipText: string;
  /** Localized compliance verdict, e.g. "Violation". */
  markerLabel?: string;
}

function ShiftChip({ shift, chipBg, chipText, markerLabel }: ShiftChipProps) {
  const templateName = shift.template?.name ?? '–';
  const workerName = shift.worker ? `${shift.worker.name}` : '–';
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
    markerText: {
      fontSize: 10,
      fontWeight: '700',
      color: chipText,
      textDecorationLine: 'underline',
    },
  });

  return (
    <View
      style={chipStyles.chip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${workerName}, ${templateName}, ${statusLabel}${timeRange ? `, ${timeRange}` : ''}${markerLabel ? `, ${markerLabel}` : ''}`}
    >
      {markerLabel ? (
        <Text style={chipStyles.markerText} numberOfLines={1} testID={`shift-marker-${shift.id}`}>
          {`! ${markerLabel}`}
        </Text>
      ) : null}
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

export function WeekCalendar({
  rosterByDate,
  coverageByDate,
  onMaximize,
  weekStartKey,
  onWeekStartChange,
  shiftMarkers,
}: WeekCalendarProps) {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  // ---- View mode -----------------------------------------------------------
  const [viewMode, setViewMode] = React.useState<ViewMode>('week');

  // ---- Week state ----------------------------------------------------------
  // Controlled when weekStartKey is given (the roster shares it with the
  // compliance panel), otherwise local state.
  const [internalWeekStart, setInternalWeekStart] = React.useState<Date>(() =>
    getSundayOfWeek(new Date())
  );
  const weekStart = useMemo(
    () => (weekStartKey ? getSundayOfWeek(parseDateKey(weekStartKey)) : internalWeekStart),
    [internalWeekStart, weekStartKey]
  );
  const setWeekStart = useCallback(
    (next: Date) => {
      setInternalWeekStart(next);
      onWeekStartChange?.(toLocalDateString(next));
    },
    [onWeekStartChange]
  );

  // ---- Month state ---------------------------------------------------------
  const [monthStart, setMonthStart] = React.useState<Date>(() =>
    getMonthStart(new Date())
  );

  // ---- Week derived ---------------------------------------------------------
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const weekDays = useMemo<Date[]>(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const weekRangeLabel = useMemo(
    () => formatWeekRange(weekStart, weekEnd),
    [weekStart, weekEnd]
  );

  // ---- Month derived --------------------------------------------------------
  const monthGrid = useMemo<MonthCell[]>(
    () => buildMonthGrid(monthStart),
    [monthStart]
  );

  const monthLabel = useMemo(() => {
    const month = monthStart.toLocaleDateString(undefined, { month: 'long' });
    const year = monthStart.getFullYear();
    return t('weekCalendar.monthLabel', { month, year: String(year) });
  }, [monthStart, t]);

  const weekdayAbbreviations = useMemo(
    () => getWeekdayAbbreviations(t),
    [t]
  );

  // ---- Navigation ----------------------------------------------------------
  const goToPrevWeek = useCallback(() => {
    setWeekStart(addDays(weekStart, -7));
  }, [setWeekStart, weekStart]);

  const goToNextWeek = useCallback(() => {
    setWeekStart(addDays(weekStart, 7));
  }, [setWeekStart, weekStart]);

  const goToPrevMonth = useCallback(() => {
    setMonthStart((prev) => addMonths(prev, -1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setMonthStart((prev) => addMonths(prev, 1));
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    setWeekStart(getSundayOfWeek(today));
    setMonthStart(getMonthStart(today));
  }, [setWeekStart]);

  // ---- View mode toggle ----------------------------------------------------
  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      if (prev === 'week') {
        // When switching to month view, sync monthStart to the week's month
        setMonthStart(getMonthStart(weekStart));
        return 'month';
      } else {
        return 'week';
      }
    });
  }, [weekStart]);

  // ---- Tap day in month view -----------------------------------------------
  const handleMonthDayPress = useCallback((date: Date) => {
    setWeekStart(getSundayOfWeek(date));
    setViewMode('week');
  }, [setWeekStart]);

  // ---- Derived data (week view) --------------------------------------------
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
  // Render helpers
  // -------------------------------------------------------------------------

  const renderWeekView = () => (
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
                    <Text style={[styles.coverageText, { color: dotColor }]}>
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
                          markerLabel={
                            shiftMarkers?.[shift.id]
                              ? t(`compliance.verdict.${shiftMarkers[shift.id]}`)
                              : undefined
                          }
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
  );

  const renderMonthView = () => {
    const rows: MonthCell[][] = [];
    for (let i = 0; i < monthGrid.length; i += 7) {
      rows.push(monthGrid.slice(i, i + 7));
    }

    return (
      <View style={styles.monthContainer}>
        {/* Weekday header row */}
        <View style={styles.monthWeekdayHeaderRow}>
          {weekdayAbbreviations.map((abbr) => (
            <View key={abbr} style={styles.monthWeekdayHeaderCell}>
              <Text style={styles.monthWeekdayHeaderText}>{abbr}</Text>
            </View>
          ))}
        </View>

        {/* Date rows */}
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.monthRow}>
            {row.map((cell) => {
              const isToday = cell.key === todayKey;
              const shifts = rosterByDate[cell.key] ?? [];
              const shiftCount = shifts.length;
              const cov = coverageByDate?.[cell.key];
              const dotColor = monthDotColor(shiftCount, cov);
              const showDot = dotColor !== 'transparent';
              const showBadge = shiftCount > 1;

              return (
                <Pressable
                  key={cell.key}
                  style={styles.monthDayCell}
                  onPress={() => handleMonthDayPress(cell.date)}
                  accessibilityRole="button"
                  accessibilityLabel={cell.date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                >
                  {/* Date number */}
                  <View
                    style={[
                      styles.monthDayNumberContainer,
                      isToday && styles.monthDayNumberContainerToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.monthDayNumber,
                        !cell.inMonth && styles.monthDayNumberOutOfMonth,
                        isToday && styles.monthDayNumberToday,
                      ]}
                    >
                      {cell.date.getDate()}
                    </Text>
                  </View>

                  {/* Dot + badge row */}
                  <View style={styles.monthDayIndicatorRow}>
                    {showDot ? (
                      <View
                        style={[
                          styles.monthDot,
                          { backgroundColor: dotColor },
                        ]}
                      />
                    ) : null}
                    {showBadge ? (
                      <View style={styles.monthBadge}>
                        <Text style={styles.monthBadgeText}>
                          {shiftCount}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  // -------------------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* ---- Header row -------------------------------------------------- */}
      <View style={styles.header}>
        <View style={styles.navRow}>
          <Pressable
            onPress={viewMode === 'week' ? goToPrevWeek : goToPrevMonth}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel={
              viewMode === 'week'
                ? t('weekCalendar.prevWeek')
                : t('weekCalendar.prevMonth')
            }
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
            onPress={viewMode === 'week' ? goToNextWeek : goToNextMonth}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel={
              viewMode === 'week'
                ? t('weekCalendar.nextWeek')
                : t('weekCalendar.nextMonth')
            }
          >
            <Text style={styles.navButtonText}>›</Text>
          </Pressable>
        </View>

        <Text style={styles.weekRangeLabel} accessibilityRole="text">
          {viewMode === 'week' ? weekRangeLabel : monthLabel}
        </Text>

        <View style={styles.headerRightRow}>
          {/* View mode toggle */}
          <Pressable
            onPress={toggleViewMode}
            style={styles.viewToggleButton}
            accessibilityRole="button"
            testID="week-calendar-view-toggle"
            accessibilityLabel={
              viewMode === 'week'
                ? t('weekCalendar.monthView')
                : t('weekCalendar.weekView')
            }
          >
            <Text style={styles.viewToggleText}>
              {viewMode === 'week'
                ? `📅 ${t('weekCalendar.monthView')}`
                : `📆 ${t('weekCalendar.weekView')}`}
            </Text>
          </Pressable>

          {/* Maximize button */}
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
      </View>

      {/* ---- Calendar grid ----------------------------------------------- */}
      {/* @print-region */}
      {viewMode === 'week' ? renderWeekView() : renderMonthView()}
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

    // ---- Header right group ----
    headerRightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    viewToggleButton: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewToggleText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
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

    // ---- Grid scroll container (week view) ----
    gridScrollContent: {
      flexGrow: 1,
    },
    grid: {
      flexDirection: 'column',
      minWidth: COLUMN_WIDTH * 7,
    },

    // ---- Column headers (week view) ----
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
      backgroundColor: colors.tint + '22',
    },
    columnHeaderText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    columnHeaderTextToday: {
      color: colors.tintText,
    },

    // ---- Coverage indicator (week view) ----
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

    // ---- Legend row (week view) ----
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

    // ---- Day columns (week view) ----
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
      backgroundColor: colors.tint + '11',
    },
    emptyDayCell: {
      minHeight: 40,
    },

    // ---- Empty state (week view) ----
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

    // ---- Month view container ----
    monthContainer: {
      flexDirection: 'column',
      paddingHorizontal: 8,
      paddingVertical: 8,
      backgroundColor: colors.background,
    },

    // ---- Month weekday header row ----
    monthWeekdayHeaderRow: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    monthWeekdayHeaderCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 4,
    },
    monthWeekdayHeaderText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },

    // ---- Month grid rows ----
    monthRow: {
      flexDirection: 'row',
      marginBottom: 2,
    },
    monthDayCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 4,
      minHeight: 52,
    },
    monthDayCellOutOfMonth: {
      opacity: 0.35,
    },
    monthDayNumberContainer: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthDayNumberContainerToday: {
      backgroundColor: colors.tint,
    },
    monthDayNumber: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    monthDayNumberOutOfMonth: {
      color: colors.textSecondary,
      fontWeight: '400',
    },
    monthDayNumberToday: {
      color: '#FFFFFF',
    },
    monthDayIndicatorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginTop: 2,
      minHeight: 10,
    },
    monthDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    monthBadge: {
      minWidth: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.tint,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    monthBadgeText: {
      fontSize: 9,
      fontWeight: '700',
      color: '#FFFFFF',
    },
  });
}