import { useMemo } from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';

export type InsightSeverity = 'critical' | 'warning' | 'tip';

export type InsightAction = {
  label: string;
  href: '/(tabs)/scheduler' | '/(tabs)/scheduler?section=demand' | '/(tabs)/scheduler?section=workers' | '/(tabs)/scheduler?section=templates';
};

export type SchedulerInsight = {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  action: InsightAction;
  impactEstimate: 'high' | 'medium' | 'low';
  impactPct: number;
};

export type UseSchedulerInsightsReturn = {
  insights: SchedulerInsight[];
  loading: boolean;
};

export function useSchedulerInsights(accountId: string): UseSchedulerInsightsReturn {
  const summary = useAnalytics(accountId);

  const insights = useMemo<SchedulerInsight[]>(() => {
    if (summary.loading) {
      return [];
    }

    const {
      coverageRate,
      draftShifts,
      publishedShifts,
      workerHours,
      fairnessScore,
      uncoveredRevenue,
    } = summary;

    const collected: SchedulerInsight[] = [];
    let hasNoCoverage = false;

    // no-coverage: coverageRate === 0
    if (coverageRate === 0) {
      hasNoCoverage = true;
      collected.push({
        id: 'no-coverage',
        severity: 'critical',
        title: 'No shifts published',
        body: 'Publish at least one shift to start tracking coverage and revenue exposure.',
        action: {
          label: 'Publish a shift',
          href: '/(tabs)/scheduler',
        },
        impactEstimate: 'high',
        impactPct: 100,
      });
    }

    // low-coverage: coverageRate < 70 (suppressed if no-coverage fires)
    if (!hasNoCoverage && coverageRate < 70) {
      const missedShifts = Math.round((70 - coverageRate) * 0.8);
      collected.push({
        id: 'low-coverage',
        severity: 'critical',
        title: 'Coverage below 70%',
        body: `Only ${coverageRate}% of demand is covered — likely to cause ${missedShifts} missed shifts this week.`,
        action: {
          label: 'Fill gaps now',
          href: '/(tabs)/scheduler',
        },
        impactEstimate: 'high',
        impactPct: 30,
      });
    }

    // high-uncovered-revenue: uncoveredRevenue > 500
    if (uncoveredRevenue > 500) {
      collected.push({
        id: 'high-uncovered-revenue',
        severity: 'critical',
        title: 'High uncovered revenue',
        body: `~$${uncoveredRevenue.toLocaleString()} in uncovered revenue exposure. Add demand targets and assign shifts.`,
        action: {
          label: 'Review demand targets',
          href: '/(tabs)/scheduler?section=demand',
        },
        impactEstimate: 'high',
        impactPct: 40,
      });
    }

    // fairness-risk: fairnessScore >= 8
    if (fairnessScore >= 8) {
      collected.push({
        id: 'fairness-risk',
        severity: 'warning',
        title: 'Scheduling fairness risk',
        body: `Hours spread is ${fairnessScore.toFixed(1)} (std dev). High variance may reduce worker satisfaction — try auto-assign.`,
        action: {
          label: 'Balance hours',
          href: '/(tabs)/scheduler',
        },
        impactEstimate: 'medium',
        impactPct: 20,
      });
    }

    // many-drafts: draftShifts >= 5
    if (draftShifts >= 5) {
      collected.push({
        id: 'many-drafts',
        severity: 'warning',
        title: '5+ draft shifts pending',
        body: `${draftShifts} shifts are in Draft status. Publish them to lock coverage.`,
        action: {
          label: 'Review drafts',
          href: '/(tabs)/scheduler',
        },
        impactEstimate: 'medium',
        impactPct: 15,
      });
    }

    // no-workers: workerHours.length === 0
    if (workerHours.length === 0) {
      collected.push({
        id: 'no-workers',
        severity: 'warning',
        title: 'No workers on roster',
        body: 'Add workers to enable auto-assign and coverage tracking.',
        action: {
          label: 'Add workers',
          href: '/(tabs)/scheduler?section=workers',
        },
        impactEstimate: 'high',
        impactPct: 50,
      });
    }

    // no-templates: publishedShifts === 0 && workerHours.length > 0
    if (publishedShifts === 0 && workerHours.length > 0) {
      collected.push({
        id: 'no-templates',
        severity: 'tip',
        title: 'No shifts assigned yet',
        body: 'You have workers but no published shifts. Create a shift template to get started.',
        action: {
          label: 'Create a template',
          href: '/(tabs)/scheduler?section=templates',
        },
        impactEstimate: 'medium',
        impactPct: 25,
      });
    }

    // good-coverage: coverageRate >= 90 && fairnessScore < 4
    if (coverageRate >= 90 && fairnessScore < 4) {
      collected.push({
        id: 'good-coverage',
        severity: 'tip',
        title: 'Coverage looks great',
        body: `Coverage at ${coverageRate}% with balanced hours. Consider inviting more workers to build depth.`,
        action: {
          label: 'Invite workers',
          href: '/(tabs)/scheduler?section=workers',
        },
        impactEstimate: 'low',
        impactPct: 5,
      });
    }

    const severityOrder: Record<InsightSeverity, number> = {
      critical: 0,
      warning: 1,
      tip: 2,
    };

    return collected.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
    );
  }, [summary]);

  return {
    insights,
    loading: summary.loading,
  };
}