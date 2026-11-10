import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { brand, Colors } from '@/constants/Colors';
import type { DemandForecast } from '@/services/demandForecast';
import {
  applyForecastEnhancements,
  type DemandRecommendation,
  type PosSalesRow,
} from '@/services/forecastEngine';
import type { Shift, ShiftTemplate } from '@/utils/schedulerMetrics';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 5;
const MIN_CONFIDENCE_FOR_HIGH = 0.75;
/** Fallback shift duration in hours when no template data is available. */
const FALLBACK_SHIFT_HOURS = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive total scheduled worker-hours per date from published shifts.
 * Uses the matching ShiftTemplate start/end times when available;
 * falls back to FALLBACK_SHIFT_HOURS per shift.
 */
function buildScheduledHoursByDate(
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
): Record<string, number> {
  const templateMap = new Map<string, ShiftTemplate>(
    shiftTemplates.map((t) => [t.id, t]),
  );

  const result: Record<string, number> = {};

  for (const shift of roster) {
    if (shift.status !== 'Published') continue;

    let hours = FALLBACK_SHIFT_HOURS;
    const template = templateMap.get(shift.templateId);
    if (template) {
      // Parse "HH:MM" strings
      const toMinutes = (t: string): number => {
        const parts = t.split(':');
        const h = parseInt(parts[0] ?? '0', 10);
        const m = parseInt(parts[1] ?? '0', 10);
        return h * 60 + m;
      };
      const startMin = toMinutes(template.start);
      const endMin = toMinutes(template.end);
      // Handle overnight shifts
      const durationMin =
        endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
      hours = durationMin / 60;
    }

    result[shift.date] = (result[shift.date] ?? 0) + hours;
  }

  return result;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 1.0) return 'High';
  if (confidence >= MIN_CONFIDENCE_FOR_HIGH) return 'Medium';
  if (confidence > 0) return 'Low';
  return 'None';
}

function confidenceColor(confidence: number): string {
  if (confidence >= 1.0) return brand.success;
  if (confidence >= MIN_CONFIDENCE_FOR_HIGH) return brand.accent;
  return brand.error;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type ConfidenceBarProps = { confidence: number };

const ConfidenceBar: React.FC<ConfidenceBarProps> = ({ confidence }) => {
  const fill = Math.round(confidence * 100);
  const color = confidenceColor(confidence);
  return (
    <View
      style={styles.barTrack}
      accessibilityRole="progressbar"
      accessibilityLabel={`Forecast confidence ${fill} percent`}
      accessibilityValue={{ min: 0, max: 100, now: fill }}
    >
      <View style={[styles.barFill, { width: `${fill}%` as `${number}%`, backgroundColor: color }]} />
    </View>
  );
};

type RecommendationRowProps = { rec: DemandRecommendation };

const RecommendationRow: React.FC<RecommendationRowProps> = ({ rec }) => {
  const visibleReasons = rec.reasons.slice(0, 2);
  const adjusted = rec.adjustedRequired;
  const base = rec.baseRequired;
  const changed = adjusted !== base;

  return (
    <View
      style={styles.recRow}
      accessibilityRole="text"
      accessibilityLabel={`${rec.date} ${rec.role}: ${base} to ${adjusted} workers`}
    >
      {/* Header row */}
      <View style={styles.recHeader}>
        <Text style={styles.recDate}>{rec.date}</Text>
        <Text style={styles.recRole}>{rec.role}</Text>
        <View style={styles.recHeadcount}>
          <Text style={styles.recBase}>{base}</Text>
          <Text style={styles.recArrow}>{' → '}</Text>
          <Text
            style={[
              styles.recAdjusted,
              changed && (adjusted > base ? styles.recUp : styles.recDown),
            ]}
          >
            {adjusted}
          </Text>
          <Text style={styles.recUnit}> workers</Text>
        </View>
      </View>

      {/* Confidence bar */}
      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceLabel}>
          {`Confidence: ${confidenceLabel(rec.confidence)}`}
        </Text>
        <ConfidenceBar confidence={rec.confidence} />
      </View>

      {/* Reasons */}
      {visibleReasons.map((reason, idx) => (
        <View key={idx} style={styles.reasonRow}>
          <Text style={styles.bullet}>{'• '}</Text>
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ForecastEnhancementsCardProps = {
  sales: PosSalesRow[];
  baseForecast: DemandForecast[];
  roster: Shift[];
  shiftTemplates: ShiftTemplate[];
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ForecastEnhancementsCard: React.FC<
  ForecastEnhancementsCardProps
> = ({ sales, baseForecast, roster, shiftTemplates }) => {
  const recommendations = useMemo<DemandRecommendation[]>(() => {
    if (sales.length === 0 || baseForecast.length === 0) return [];

    const scheduledHoursByDate = buildScheduledHoursByDate(roster, shiftTemplates);
    const base = baseForecast.map((f) => ({
      date: f.date,
      role: f.role,
      required: f.required,
    }));

    return applyForecastEnhancements(base, sales, scheduledHoursByDate);
  }, [sales, baseForecast, roster, shiftTemplates]);

  if (recommendations.length === 0) return null;

  const visible = recommendations.slice(0, MAX_VISIBLE);
  const overallConfidence = recommendations[0]?.confidence ?? 0;
  const lowConfidence = overallConfidence < MIN_CONFIDENCE_FOR_HIGH;
  const hidden = recommendations.length - MAX_VISIBLE;

  return (
    <View
      style={styles.card}
      accessibilityRole="none"
      accessibilityLabel="AI-Enhanced Forecast"
    >
      {/* Card header */}
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{'AI-Enhanced Forecast'}</Text>
        <View
          style={[
            styles.confidencePill,
            { backgroundColor: confidenceColor(overallConfidence) + '22' },
          ]}
        >
          <Text
            style={[
              styles.confidencePillText,
              { color: confidenceColor(overallConfidence) },
            ]}
          >
            {confidenceLabel(overallConfidence)}
          </Text>
        </View>
      </View>

      {/* Low-confidence disclaimer */}
      {lowConfidence && (
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            {
              '⚠ Limited sales history — add more POS data to improve forecast accuracy.'
            }
          </Text>
        </View>
      )}

      {/* Recommendation rows */}
      {visible.map((rec, idx) => (
        <React.Fragment key={`${rec.date}-${rec.role}`}>
          {idx > 0 && <View style={styles.divider} />}
          <RecommendationRow rec={rec} />
        </React.Fragment>
      ))}

      {/* Overflow note */}
      {hidden > 0 && (
        <Text style={styles.overflowNote}>
          {`+${hidden} more recommendation${hidden === 1 ? '' : 's'} not shown`}
        </Text>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const c = Colors.light;

const styles = StyleSheet.create({
  card: {
    backgroundColor: c.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    padding: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text,
  },
  confidencePill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  confidencePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  disclaimer: {
    backgroundColor: brand.warningSurface,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  disclaimerText: {
    fontSize: 12,
    color: brand.accentDark,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.border,
    marginVertical: 10,
  },
  recRow: {
    gap: 4,
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  recDate: {
    fontSize: 12,
    color: c.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  recRole: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text,
    flex: 1,
  },
  recHeadcount: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  recBase: {
    fontSize: 13,
    color: c.textSecondary,
  },
  recArrow: {
    fontSize: 13,
    color: c.textTertiary,
  },
  recAdjusted: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text,
  },
  recUp: {
    color: brand.error,
  },
  recDown: {
    color: brand.success,
  },
  recUnit: {
    fontSize: 11,
    color: c.textTertiary,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  confidenceLabel: {
    fontSize: 11,
    color: c.textTertiary,
    minWidth: 90,
  },
  barTrack: {
    flex: 1,
    height: 4,
    backgroundColor: c.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  reasonRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  bullet: {
    fontSize: 11,
    color: c.textTertiary,
    lineHeight: 16,
  },
  reasonText: {
    fontSize: 11,
    color: c.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  overflowNote: {
    fontSize: 11,
    color: c.textTertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});