import { useMemo, useEffect, useRef } from 'react';
import {
  useCapacityForecast,
  type CapacityGap,
  type BurnoutRisk,
  type CapacityTrend,
} from '@/hooks/useCapacityForecast';
import {
  useSchedulerInsights,
  type SchedulerInsight,
} from '@/hooks/useSchedulerInsights';
import { trackEvent } from '@/services/analytics';

// ─── Public types ─────────────────────────────────────────────────────────────

export type RecommendationCategory =
  | 'staffing'
  | 'scheduling'
  | 'compliance'
  | 'retention';

export type RecommendationEffort = 'low' | 'medium' | 'high';

export type RecommendationTimeframe =
  | 'immediate'
  | 'this_week'
  | 'this_month';

export type TacticalRecommendation = {
  id: string;
  priority: number;
  category: RecommendationCategory;
  title: string;
  description: string;
  action: string;
  estimatedRevenueImpact: number;
  effort: RecommendationEffort;
  timeframe: RecommendationTimeframe;
};

export type StrategicCategory =
  | 'hiring'
  | 'training'
  | 'process'
  | 'technology';

export type StrategicTimeframe = 'month' | 'quarter' | 'half_year';

export type StrategicRecommendation = {
  id: string;
  category: StrategicCategory;
  title: string;
  insight: string;
  evidence: string;
  recommendedAction: string;
  projectedImpactPct: number;
  timeframe: StrategicTimeframe;
};

export type UseLeaderInsightsReturn = {
  tactical: TacticalRecommendation[];
  strategic: StrategicRecommendation[];
  loading: boolean;
};

// ─── Revenue estimation constants ────────────────────────────────────────────

/**
 * Average revenue per uncovered shift unit.
 * Adjust per business type; used when demandTarget.revenuePerUnit is absent.
 */
const DEFAULT_REVENUE_PER_SHIFT_UNIT = 180;

// ─── Pure computation: tactical recommendations ────────────────────────────────

export function generateTacticalRecommendations(
  gaps: CapacityGap[],
  burnoutRisks: BurnoutRisk[],
  insights: SchedulerInsight[],
  uncoveredRevenue: number,
): TacticalRecommendation[] {
  const recommendations: TacticalRecommendation[] = [];
  let priorityCounter = 1;

  // ── Rule 1: Critical capacity gaps → cover role on date ──────────────────
  const criticalGaps = gaps.filter((g) => g.risk === 'critical');
  for (const gap of criticalGaps) {
    const revenueImpact = Math.round(gap.gap * DEFAULT_REVENUE_PER_SHIFT_UNIT);
    recommendations.push({
      id: `tac-critical-gap-${gap.date}-${gap.role}`,
      priority: priorityCounter++,
      category: 'staffing',
      title: `Cover ${gap.role} gap on ${gap.date}`,
      description:
        `You need ${gap.required} ${gap.role}(s) on ${gap.date} but only ` +
        `${gap.available} are available — a shortfall of ${gap.gap}. ` +
        `This leaves an estimated $${revenueImpact.toLocaleString()} in revenue at risk.`,
      action: `Assign ${gap.gap} additional ${gap.role} shift(s) for ${gap.date} immediately.`,
      estimatedRevenueImpact: revenueImpact,
      effort: gap.gap === 1 ? 'low' : gap.gap <= 3 ? 'medium' : 'high',
      timeframe: 'immediate',
    });
  }

  // ── Rule 2: Warning-level gaps ────────────────────────────────────────────
  const warningGaps = gaps.filter((g) => g.risk === 'warning');
  for (const gap of warningGaps) {
    const revenueImpact = Math.round(gap.gap * DEFAULT_REVENUE_PER_SHIFT_UNIT * 0.6);
    recommendations.push({
      id: `tac-warning-gap-${gap.date}-${gap.role}`,
      priority: priorityCounter++,
      category: 'staffing',
      title: `Partial ${gap.role} shortage on ${gap.date}`,
      description:
        `Coverage for ${gap.role} on ${gap.date} is below target by ${gap.gap} ` +
        `shift unit(s). Service quality may be impacted.`,
      action: `Schedule at least ${gap.gap} more ${gap.role} shift(s) before end of week.`,
      estimatedRevenueImpact: revenueImpact,
      effort: 'low',
      timeframe: 'this_week',
    });
  }

  // ── Rule 3: High burnout risk → redistribute worker shifts ───────────────
  const highBurnout = burnoutRisks.filter((b) => b.risk === 'high');
  for (const worker of highBurnout) {
    recommendations.push({
      id: `tac-burnout-${worker.workerId}`,
      priority: priorityCounter++,
      category: 'retention',
      title: `Redistribute ${worker.workerName}'s shifts`,
      description:
        `${worker.workerName} is at ${worker.utilizationPct.toFixed(1)}% utilization ` +
        `(${worker.assignedHours}h assigned of ${worker.availableHours}h available). ` +
        `Workers above 90% utilization are at high risk of burnout and unplanned absence.`,
      action:
        `Move 1–2 of ${worker.workerName}'s upcoming shifts to lower-utilization team members ` +
        `to bring their load below 80%.`,
      estimatedRevenueImpact: Math.round(worker.assignedHours * 25),
      effort: 'medium',
      timeframe: 'this_week',
    });
  }

  // ── Rule 4: Medium burnout risk → monitor ────────────────────────────────
  const mediumBurnout = burnoutRisks.filter((b) => b.risk === 'medium');
  if (mediumBurnout.length >= 3) {
    const names = mediumBurnout
      .slice(0, 3)
      .map((b) => b.workerName)
      .join(', ');
    recommendations.push({
      id: 'tac-burnout-medium-group',
      priority: priorityCounter++,
      category: 'retention',
      title: `Monitor utilization for ${mediumBurnout.length} workers`,
      description:
        `${mediumBurnout.length} workers (including ${names}) are between 70–90% utilization. ` +
        `Left unaddressed, high load may increase turnover.`,
      action:
        'Review upcoming shift assignments and consider offering voluntary shift swaps.',
      estimatedRevenueImpact: mediumBurnout.length * 300,
      effort: 'low',
      timeframe: 'this_week',
    });
  }

  // ── Rule 5: Many draft shifts → publish pending shifts ───────────────────
  const manyDraftsInsight = insights.find((i) => i.id === 'many-drafts');
  if (manyDraftsInsight) {
    recommendations.push({
      id: 'tac-publish-drafts',
      priority: priorityCounter++,
      category: 'scheduling',
      title: 'Publish pending draft shifts',
      description:
        'Several shifts remain in Draft and are not visible to workers or counted toward ' +
        'coverage. Publishing them will immediately improve your coverage metrics.',
      action:
        'Open the Scheduler, filter by Draft status, and bulk-publish all ready shifts.',
      estimatedRevenueImpact: Math.round(manyDraftsInsight.impactPct * 20),
      effort: 'low',
      timeframe: 'immediate',
    });
  }

  // ── Rule 6: High uncovered revenue → trigger auto-assign ─────────────────
  if (uncoveredRevenue > 1000) {
    recommendations.push({
      id: 'tac-auto-assign-high-revenue',
      priority: priorityCounter++,
      category: 'scheduling',
      title: 'Run auto-assign to recover revenue',
      description:
        `$${uncoveredRevenue.toLocaleString()} in revenue is exposed due to uncovered shifts. ` +
        `Auto-assign can fill eligible gaps using workers' availability and role constraints.`,
      action:
        'Navigate to Scheduler → Auto-Assign and run the optimizer for the current week.',
      estimatedRevenueImpact: Math.round(uncoveredRevenue * 0.7),
      effort: 'low',
      timeframe: 'immediate',
    });
  }

  // ── Rule 7: No workers on roster ─────────────────────────────────────────
  const noWorkersInsight = insights.find((i) => i.id === 'no-workers');
  if (noWorkersInsight) {
    recommendations.push({
      id: 'tac-add-workers',
      priority: priorityCounter++,
      category: 'staffing',
      title: 'Add workers to enable scheduling',
      description:
        'Your roster has no workers. Auto-assign, coverage tracking, and fairness scoring ' +
        'are all unavailable until at least one worker is added.',
      action: 'Go to Scheduler → Workers and add your team members.',
      estimatedRevenueImpact: 500,
      effort: 'medium',
      timeframe: 'immediate',
    });
  }

  // ── Rule 8: Low coverage (non-zero) → fill coverage gaps ─────────────────
  const lowCoverageInsight = insights.find((i) => i.id === 'low-coverage');
  if (lowCoverageInsight) {
    recommendations.push({
      id: 'tac-fill-low-coverage',
      priority: priorityCounter++,
      category: 'scheduling',
      title: 'Fill open coverage gaps this week',
      description: lowCoverageInsight.body,
      action: 'Review unassigned demand slots in the Scheduler and assign available workers.',
      estimatedRevenueImpact: Math.round(lowCoverageInsight.impactPct * 500),
      effort: 'medium' as const,
      timeframe: 'this_week' as const,
    });
  }

  return recommendations.sort((a, b) => a.priority - b.priority);
}

// ─── Pure computation: strategic recommendations ────────────────────────────

export function generateStrategicRecommendations(
  trends: CapacityTrend[],
  burnoutRisks: BurnoutRisk[],
): StrategicRecommendation[] {
  const recommendations: StrategicRecommendation[] = [];

  const risingTrends = trends.filter((t) => t.direction === 'degrading');
  if (risingTrends.length > 0) {
    recommendations.push({
      id: 'str-hire-for-demand',
      category: 'hiring',
      title: 'Hire ahead of rising demand',
      insight:
        `Demand is trending upward for ${risingTrends.length} role(s). ` +
        `Without additional headcount you risk chronic understaffing.`,
      evidence: risingTrends.map((t) => `${t.role}: +${t.projectedGapIn14Days.toFixed(0)} projected gap`).join(', '),
      recommendedAction:
        'Post open roles for the high-demand positions. Aim for a 4-week lead time before peak.',
      projectedImpactPct: 15,
      timeframe: 'month',
    });
  }

  const highBurnoutCount = burnoutRisks.filter((b) => b.risk === 'high').length;
  if (highBurnoutCount >= 2) {
    recommendations.push({
      id: 'str-cross-train',
      category: 'training',
      title: 'Cross-train workers to reduce key-person risk',
      insight:
        `${highBurnoutCount} workers are at high burnout risk, indicating concentrated workloads. ` +
        `Cross-training builds resilience and reduces single-points of failure.`,
      evidence:
        `${highBurnoutCount} workers above 90% utilization.`,
      recommendedAction:
        'Identify 1–2 backup workers per high-demand role and schedule cross-training shifts.',
      projectedImpactPct: 10,
      timeframe: 'quarter',
    });
  }

  return recommendations;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLeaderInsights(): UseLeaderInsightsReturn {
  const accountId = process.env.EXPO_PUBLIC_ACCOUNT_ID ?? '';

  const {
    gaps,
    burnoutRisks,
    trends,
    loading: capacityLoading,
  } = useCapacityForecast(accountId);

  const { insights, loading: insightsLoading } = useSchedulerInsights(accountId);

  const lastEventRef = useRef<string | null>(null);

  const tactical = useMemo(
    () => generateTacticalRecommendations(gaps, burnoutRisks, insights, 0),
    [gaps, burnoutRisks, insights],
  );

  const strategic = useMemo(
    () => generateStrategicRecommendations(trends, burnoutRisks),
    [trends, burnoutRisks],
  );

  const loading = capacityLoading || insightsLoading;

  // Emit analytics only when the top recommendation changes
  useEffect(() => {
    if (loading || tactical.length === 0) return;
    const topId = tactical[0].id;
    if (lastEventRef.current === topId) return;
    lastEventRef.current = topId;
    void (trackEvent as (e: string, p: Record<string, unknown>) => Promise<void>)(
      'leader_insights_generated',
      { tacticalCount: tactical.length, strategicCount: strategic.length, topRecommendationId: topId },
    );
  }, [loading, tactical, strategic]);

  return { tactical, strategic, loading };
}