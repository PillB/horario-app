/**
 * Turns a jurisdiction's hard limits into the auto-assigner's constraints, so
 * auto-assign never proposes a schedule the law forbids. Only rules whose
 * verdict is a violation become constraints; warnings and premiums are shown
 * by the engine but don't block.
 */
import type { LaborConstraints } from '@/services/shiftAssigner';
import { resolveDated, resolvePack } from './engine';
import type { DateKey } from './types';

const minDefined = (...values: (number | undefined)[]): number | undefined => {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length ? Math.min(...defined) : undefined;
};

export const legalConstraintsFor = (jurisdiction: string, date: DateKey): LaborConstraints => {
  const pack = resolvePack(jurisdiction);
  const rest = pack.restBetweenShifts;
  const ordinary = pack.dailyOrdinaryMax;
  const ordinaryHours = ordinary && ordinary.excess === 'violation' ? resolveDated(ordinary.hours, date) : undefined;
  return {
    minRestHoursBetweenShifts: rest && (rest.verdict ?? 'violation') === 'violation' ? resolveDated(rest.minHours, date) : undefined,
    maxDailyHours: minDefined(
      typeof ordinaryHours === 'number' ? ordinaryHours : undefined,
      pack.dailyTotalMax && (pack.dailyTotalMax.verdict ?? 'violation') === 'violation' ? pack.dailyTotalMax.hours : undefined,
    ),
    maxWeeklyHours: pack.weeklyMax && (pack.weeklyMax.verdict ?? 'violation') === 'violation' ? pack.weeklyMax.hours : undefined,
  };
};

/** The stricter of the business's own settings and the law, per field. */
export const mergeConstraints = (business: LaborConstraints | undefined, legal: LaborConstraints): LaborConstraints => ({
  maxDailyHours: minDefined(business?.maxDailyHours, legal.maxDailyHours),
  maxWeeklyHours: minDefined(business?.maxWeeklyHours, legal.maxWeeklyHours),
  minRestHoursBetweenShifts: [business?.minRestHoursBetweenShifts, legal.minRestHoursBetweenShifts]
    .filter((v): v is number => v !== undefined)
    .reduce<number | undefined>((a, b) => (a === undefined ? b : Math.max(a, b)), undefined),
});
