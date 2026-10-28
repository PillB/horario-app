import { useCallback, useMemo } from 'react';

import {
  type AssignedShift,
  type AssignmentResult,
  type LaborConstraints as AssignmentConstraints,
} from '@/services/shiftAssigner';

import {
  type DemandForecast,
} from '@/services/demandForecast';

import {
  type Shift,
  type ShiftTemplate,
} from '@/utils/schedulerMetrics';

import type { Worker } from '@/types/scheduler';
import { runAutoAssign } from '@/services/optimizer/autoAssignClient';
import { autoAssignSettings } from '@/utils/autoAssignSettings';
import type { BusinessLocation } from '@/utils/locationValidation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StaffingStatus = 'ok' | 'understaffed' | 'overstaffed';

export type StaffingDetail = {
  assigned: number;
  required: number;
  status: StaffingStatus;
  gap: number;
};

export type StaffingMatrixRow = {
  date: string;
  role: string;
  required: number;
  assigned: number;
  gap: number;
  status: StaffingStatus;
};

export type DemandAwareAssignResult = {
  assignmentResult: AssignmentResult;
  staffingMatrix: StaffingMatrixRow[];
};

export type UseDemandAwareScheduleReturn = {
  getDemandForDate: (date: string, role: string) => number;
  getStaffingStatus: (
    date: string,
    role: string,
    roster: Shift[],
    shiftTemplates: ShiftTemplate[],
  ) => StaffingDetail;
  buildDailyStaffingMatrix: (
    dates: string[],
    roles: string[],
    roster: Shift[],
    shiftTemplates: ShiftTemplate[],
    demandTargets: DemandForecast[],
  ) => StaffingMatrixRow[];
  demandAwareAutoAssign: (
    date: string,
    shiftTemplates: ShiftTemplate[],
    workers: Worker[],
    roster: Shift[],
    demandTargets: DemandForecast[],
    /** The business's own limits; merged with the location's legal limits. */
    constraints?: AssignmentConstraints,
    /** Business location: legal limits and IANA zone (device zone without one). */
    location?: BusinessLocation | null,
  ) => Promise<DemandAwareAssignResult>;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const OVERSTAFFING_THRESHOLD_MULTIPLIER = 1.2;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveStaffingStatus(assigned: number, required: number): StaffingStatus {
  if (required === 0) {
    return assigned === 0 ? 'ok' : 'overstaffed';
  }
  if (assigned > Math.ceil(required * OVERSTAFFING_THRESHOLD_MULTIPLIER)) {
    return 'overstaffed';
  }
  if (assigned < required) {
    return 'understaffed';
  }
  return 'ok';
}

function countAssignedForDateRole(
  date: string,
  role: string,
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
): number {
  const templateIdsForRole = new Set(
    shiftTemplates.filter((t) => t.role === role).map((t) => t.id),
  );

  return roster.filter(
    (shift) =>
      shift.date === date &&
      templateIdsForRole.has(shift.templateId ?? ''),
  ).length;
}

function buildDemandLookup(
  demandTargets: DemandForecast[],
): Map<string, number> {
  const lookup = new Map<string, number>();
  demandTargets.forEach((target) => {
    lookup.set(`${target.date}::${target.role}`, target.required);
  });
  return lookup;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDemandAwareSchedule(
  demandTargets: DemandForecast[],
): UseDemandAwareScheduleReturn {

  const demandLookup = useMemo(
    () => buildDemandLookup(demandTargets),
    [demandTargets],
  );

  // -------------------------------------------------------------------------
  // getDemandForDate
  // -------------------------------------------------------------------------

  const getDemandForDate = useCallback(
    (date: string, role: string): number => {
      return demandLookup.get(`${date}::${role}`) ?? 0;
    },
    [demandLookup],
  );

  // -------------------------------------------------------------------------
  // getStaffingStatus
  // -------------------------------------------------------------------------

  const getStaffingStatus = useCallback(
    (
      date: string,
      role: string,
      roster: Shift[],
      shiftTemplates: ShiftTemplate[],
    ): StaffingDetail => {
      const required = getDemandForDate(date, role);
      const assigned = countAssignedForDateRole(date, role, roster, shiftTemplates);
      const status = resolveStaffingStatus(assigned, required);
      const gap = required - assigned;

      return { assigned, required, status, gap };
    },
    [getDemandForDate],
  );

  // -------------------------------------------------------------------------
  // buildDailyStaffingMatrix
  // -------------------------------------------------------------------------

  const buildDailyStaffingMatrix = useCallback(
    (
      dates: string[],
      roles: string[],
      roster: Shift[],
      shiftTemplates: ShiftTemplate[],
      overrideTargets: DemandForecast[],
    ): StaffingMatrixRow[] => {
      const lookup = buildDemandLookup(overrideTargets);

      const rows: StaffingMatrixRow[] = [];

      for (const date of dates) {
        for (const role of roles) {
          const required = lookup.get(`${date}::${role}`) ?? 0;
          const assigned = countAssignedForDateRole(
            date,
            role,
            roster,
            shiftTemplates,
          );
          const status = resolveStaffingStatus(assigned, required);
          const gap = required - assigned;

          rows.push({ date, role, required, assigned, gap, status });
        }
      }

      return rows.sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date);
        return dateCmp !== 0 ? dateCmp : a.role.localeCompare(b.role);
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // demandAwareAutoAssign
  // -------------------------------------------------------------------------

  const demandAwareAutoAssign = useCallback(
    async (
      date: string,
      shiftTemplates: ShiftTemplate[],
      workers: Worker[],
      roster: Shift[],
      overrideTargets: DemandForecast[],
      constraints?: AssignmentConstraints,
      location?: BusinessLocation | null,
    ): Promise<DemandAwareAssignResult> => {
      const lookup = buildDemandLookup(overrideTargets);

      const rolesOnDate = Array.from(
        new Set(shiftTemplates.map((t) => t.role).filter(Boolean)),
      );

      const coverageRequirements: Record<string, number> = {};
      for (const role of rolesOnDate) {
        const required = lookup.get(`${date}::${role}`) ?? 0;
        if (required > 0) {
          coverageRequirements[role] = required;
        }
      }

      const settings = autoAssignSettings(date, location, constraints);
      const assignmentResult: AssignmentResult = await runAutoAssign({
        date,
        templates: shiftTemplates,
        workers,
        existingRoster: roster,
        constraints: settings.constraints,
        timeZone: settings.timeZone,
      });

      const newShifts: Shift[] = assignmentResult.assignments.map(
        (a: AssignedShift): Shift => ({
          id: `${a.workerId}-${a.templateId}-${date}`,
          date,
          workerId: a.workerId,
          templateId: a.templateId,
          location: location?.id ?? '',
          status: 'Draft',
          notified: false,
        }),
      );

      const updatedRoster: Shift[] = [
        ...roster,
        ...newShifts,
      ];

      const staffingMatrix = buildDailyStaffingMatrix(
        [date],
        rolesOnDate,
        updatedRoster,
        shiftTemplates,
        overrideTargets,
      );

      return { assignmentResult, staffingMatrix };
    },
    [buildDailyStaffingMatrix],
  );

  return {
    getDemandForDate,
    getStaffingStatus,
    buildDailyStaffingMatrix,
    demandAwareAutoAssign,
  };
}