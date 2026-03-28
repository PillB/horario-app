import { DemandForecast } from '@/services/demandForecast';

export type ShiftTemplate = {
  id: string;
  name: string;
  role: string;
  start: string;
  end: string;
  coverage: number;
};

export type Shift = {
  id: string;
  date: string;
  workerId: string;
  templateId: string;
  location: string;
  status: 'Draft' | 'Published';
  notified?: boolean;
};

export const LOST_REVENUE_PER_UNCOVERED_ROLE = 325;

export const computeUncoveredLoss = (
  targets: DemandForecast[],
  roster: Shift[],
  shiftTemplates: ShiftTemplate[],
  lostRevenuePerUncoveredRole = LOST_REVENUE_PER_UNCOVERED_ROLE
) => {
  const coverageByDateRole = roster
    .filter((shift) => shift.status === 'Published')
    .reduce<Record<string, number>>((acc, shift) => {
      const template = shiftTemplates.find((candidate) => candidate.id === shift.templateId);
      if (!template) return acc;
      const key = `${shift.date}::${template.role}`;
      acc[key] = (acc[key] ?? 0) + (template.coverage ?? 1);
      return acc;
    }, {});

  return targets.reduce(
    (acc, target) => {
      const scheduled = coverageByDateRole[`${target.date}::${target.role}`] ?? 0;
      const gap = Math.max(0, target.required - scheduled);
      acc.totalGap += gap;
      acc.totalRequired += target.required;
      acc.loss += gap * lostRevenuePerUncoveredRole;
      return acc;
    },
    { loss: 0, totalGap: 0, totalRequired: 0 }
  );
};
