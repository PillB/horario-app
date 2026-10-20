import { useCallback, useState } from 'react';

import { log } from '@/services/logger';
import { trackEvent } from '@/services/analytics';
import {
  requiredSlots,
  type AssignedShift,
  type AssignmentResult as EngineResult,
  type CoverageShortfall,
  type LaborConstraints,
  type ShortfallReasonCode,
} from '@/services/shiftAssigner';
import {
  upsertRosterShift,
  type DbRosterShift,
  type UpsertRosterShiftResult,
} from '@/services/rosterService';
import type { ShiftTemplate, Shift } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';
import { runAutoAssign } from '@/services/optimizer/autoAssignClient';
import { autoAssignSettings } from '@/utils/autoAssignSettings';
import type { BusinessLocation } from '@/utils/locationValidation';
import { parseTimeToMinutes } from '@/utils/schedulerUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Human-readable explanation of why a specific worker was assigned to a
 * specific template on a given date.
 */
export type AssignmentExplanation = {
  templateId: string;
  templateName: string;
  workerId: string;
  workerName: string;
  /** Plain-English sentence surfaced in the manager UI. */
  reason: string;
};

/**
 * Coverage gap reported when a template received fewer workers than its
 * `coverage` requirement after auto-assign completes.
 */
export type CoverageGap = {
  templateId: string;
  templateName: string;
  required: number;
  assigned: number;
  shortfall: number;
  /**
   * Why the engine could not fill the remaining slots. Absent when the engine filled
   * every slot but some assignments failed to persist.
   */
  reasonCode?: ShortfallReasonCode;
};

export type AssignmentResult = {
  /** Shifts that were successfully persisted to the DB. */
  persisted: DbRosterShift[];
  /** Shifts that were produced by the algorithm but failed to persist. */
  failedToPersist: AssignedShift[];
  /** Templates that were not fully staffed. */
  coverageGaps: CoverageGap[];
  totalAssigned: number;
};

type AutoAssignState = {
  assigning: boolean;
  result: AssignmentResult | null;
  explanations: AssignmentExplanation[];
  /** Top-level error message, e.g. when the algorithm itself throws. */
  error: string | null;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Generates a human-readable explanation string for a single assignment.
 *
 * Example:
 *   "Alice Chen: role match (Barista), covers 09:00–17:00, fairness score 0.92"
 */
const buildExplanation = (
  assigned: AssignedShift,
  worker: Worker,
  template: ShiftTemplate,
): AssignmentExplanation => {
  // ShiftTemplate uses `start`/`end` in the UI layer; handle both shapes.
  const displayStart =
    (template as unknown as { start: string }).start ??
    (template as unknown as { startTime: string }).startTime ??
    '??:??';
  const displayEnd =
    (template as unknown as { end: string }).end ??
    (template as unknown as { endTime: string }).endTime ??
    '??:??';

  // Compute a naive fairness score proxy from the assigned shift's own window.
  // The shiftAssigner internally scores on cumulative hours; we re-derive a
  // simplified normalised score here solely for display purposes.
  const templateStart = parseTimeToMinutes(displayStart);
  const templateEnd = parseTimeToMinutes(displayEnd);
  const durationHours =
    templateStart >= 0 && templateEnd > templateStart
      ? (templateEnd - templateStart) / 60
      : 0;

  // Score in [0, 1]: shorter existing commitment → higher score proxy.
  // We don't have the exact existing hours here, so we use a display
  // placeholder if not embedded in the AssignedShift.
  const fairnessScore =
    'fairnessScore' in assigned &&
    typeof (assigned as unknown as { fairnessScore: number }).fairnessScore === 'number'
      ? ((assigned as unknown as { fairnessScore: number }).fairnessScore).toFixed(2)
      : (1 / (1 + durationHours * 0.1)).toFixed(2);

  const reason =
    `${worker.name}: role match (${template.role}), ` +
    `covers ${displayStart}–${displayEnd}, ` +
    `fairness score ${fairnessScore}`;

  return {
    templateId: assigned.templateId,
    templateName: template.name,
    workerId: assigned.workerId,
    workerName: worker.name,
    reason,
  };
};

/**
 * Identifies templates whose total required coverage exceeds the number of
 * assignments that were successfully persisted. Partial coverage counts as a gap;
 * the engine's shortfall reason is attached when it reported one.
 */
const computeCoverageGaps = (
  templates: ShiftTemplate[],
  persisted: DbRosterShift[],
  shortfalls: CoverageShortfall[],
): CoverageGap[] => {
  return templates.reduce<CoverageGap[]>((acc, template) => {
    const assigned = persisted.filter((s) => s.templateId === template.id).length;
    const required = requiredSlots(template);
    if (assigned < required) {
      const engineShortfall = shortfalls.find((s) => s.templateId === template.id);
      acc.push({
        templateId: template.id,
        templateName: template.name,
        required,
        assigned,
        shortfall: required - assigned,
        ...(engineShortfall ? { reasonCode: engineShortfall.reasonCode } : {}),
      });
    }
    return acc;
  }, []);
};

// ─── Unique ID generator ──────────────────────────────────────────────────────

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useAutoAssign
 *
 * Provides a single `autoAssign` action that:
 *   1. Calls `runAutoAssign` (HiGHS ILP in a Web Worker on web, never worse than the
 *      greedy + 2-opt `assignShifts`; the greedy alone on native)
 *   2. Persists each produced assignment via `upsertRosterShift`
 *   3. Builds human-readable `AssignmentExplanation` objects for the UI
 *   4. Surfaces `CoverageGap` entries for any under-staffed templates
 *   5. Emits an analytics event (`auto_assign_used`)
 */
export const useAutoAssign = (accountId: string) => {
  const [state, setState] = useState<AutoAssignState>({
    assigning: false,
    result: null,
    explanations: [],
    error: null,
  });

  // ── autoAssign ─────────────────────────────────────────────────────────────

  const autoAssign = useCallback(
    async (
      date: string,
      templates: ShiftTemplate[],
      workers: Worker[],
      existingRoster: Shift[],
      /** The business's own limits; merged with the location's legal limits. */
      constraints?: LaborConstraints,
      /** Optional default location string applied to all persisted shifts. */
      location?: string,
      /**
       * The business location the shifts are for. Its jurisdiction's hard limits are
       * merged into `constraints` (stricter wins) and its IANA zone places the shifts.
       * Persisted shifts name it when `location` is not given.
       */
      businessLocation?: BusinessLocation | null,
    ): Promise<AssignmentResult> => {
      setState((prev) => ({
        ...prev,
        assigning: true,
        error: null,
      }));

      log.info('ROSTER', 'Starting auto-assign', {
        date,
        templateCount: templates.length,
        workerCount: workers.length,
        hasConstraints: !!constraints,
        jurisdiction: businessLocation?.jurisdictionCode ?? null,
      });

      // ── 1. Run the assignment algorithm ─────────────────────────────────

      let assignResult: EngineResult;
      try {
        const settings = autoAssignSettings(date, businessLocation, constraints);
        const optimized = await runAutoAssign({
          date,
          templates,
          workers,
          existingRoster,
          constraints: settings.constraints,
          timeZone: settings.timeZone,
        });
        assignResult = optimized;
        log.info('ROSTER', 'Auto-assign engine', {
          engine: optimized.solver.engine,
          fallbackReason: optimized.solver.fallbackReason ?? null,
          solveMs: optimized.solver.solveMs,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Auto-assign algorithm failed unexpectedly.';

        log.error('ROSTER', 'Algorithm threw', { date, error: message });

        setState((prev) => ({
          ...prev,
          assigning: false,
          error: message,
        }));

        trackEvent('auto_assign_used', {
          accountId,
          date,
          success: false,
          error: message,
          templateCount: templates.length,
        });

        return {
          persisted: [],
          failedToPersist: [],
          coverageGaps: [],
          totalAssigned: 0,
        };
      }

      // ── 2. Persist each assignment ───────────────────────────────────────

      const persisted: DbRosterShift[] = [];
      const failedToPersist: AssignedShift[] = [];

      await Promise.all(
        assignResult.assignments.map(async (shift) => {
          const result: UpsertRosterShiftResult = await upsertRosterShift({
            id: generateId(),
            date: shift.date,
            workerId: shift.workerId,
            templateId: shift.templateId,
            accountId,
            status: 'Draft',
            notified: false,
            location: location ?? businessLocation?.id ?? '',
          });
          if (result.success && result.shift) {
            persisted.push(result.shift);
          } else {
            failedToPersist.push(shift);
            log.warn('ROSTER', 'Failed to persist shift', {
              workerId: shift.workerId,
              templateId: shift.templateId,
              error: result.error,
            });
          }
        }),
      );

      // ── 3. Build explanations ────────────────────────────────────────────

      const explanations: AssignmentExplanation[] = assignResult.assignments.reduce<AssignmentExplanation[]>(
        (acc, shift) => {
          const worker = workers.find((w) => w.id === shift.workerId);
          const template = templates.find((tpl) => tpl.id === shift.templateId);
          if (worker && template) {
            acc.push(buildExplanation(shift, worker, template));
          }
          return acc;
        },
        [],
      );

      // ── 4. Identify coverage gaps ────────────────────────────────────────

      const coverageGaps = computeCoverageGaps(templates, persisted, assignResult.unassigned);

      // ── 5. Update state and return ───────────────────────────────────────

      const finalResult: AssignmentResult = {
        persisted,
        failedToPersist,
        coverageGaps,
        totalAssigned: persisted.length,
      };

      setState({
        assigning: false,
        result: finalResult,
        explanations,
        error: null,
      });

      log.info('ROSTER', 'Completed', {
        date,
        persisted: persisted.length,
        failed: failedToPersist.length,
        gaps: coverageGaps.length,
      });

      trackEvent('auto_assign_used', {
        accountId,
        date,
        success: true,
        templateCount: templates.length,
        assigned: persisted.length,
        gaps: coverageGaps.length,
      });

      return finalResult;
    },
    [accountId],
  );

  const reset = useCallback(() => {
    setState({ assigning: false, result: null, explanations: [], error: null });
  }, []);

  return {
    ...state,
    autoAssign,
    reset,
  };
};

