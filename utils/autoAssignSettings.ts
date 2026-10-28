/**
 * Constraints and time zone for one auto-assign run.
 *
 * With a location, the jurisdiction's hard limits (legalConstraintsFor) are
 * merged with the business's own settings, the stricter value winning, and
 * shifts are placed in the location's IANA zone. Without one, only the
 * business's settings apply and the device zone is used: the scheduler never
 * guesses a jurisdiction. The location's overrides (stricter-only) are applied
 * to the legal limits first.
 */
import { legalConstraintsFor, mergeConstraints } from '@/services/labor/assignerConstraints';
import { parseStoredOverrides } from '@/services/labor/overrides';
import type { LaborConstraints } from '@/services/shiftAssigner';
import { getBusinessTimeZone } from '@/utils/businessTimeZone';
import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';

/** `overrides` is the stored `locations.overrides` (stricter-only business limits, CHG-089). */
export type AutoAssignLocation = { jurisdictionCode: string; timeZone: string; overrides?: readonly unknown[] };

/** Monday of the ISO week containing `date` (the assigner counts ISO weeks). */
export const isoWeekStart = (date: string): string => addDaysToKey(date, -((weekdayOfKey(date) + 6) % 7));

export const autoAssignSettings = (
  date: string,
  location: AutoAssignLocation | null | undefined,
  business?: LaborConstraints,
): { constraints: LaborConstraints | undefined; timeZone: string } => ({
  constraints: location
    ? mergeConstraints(
      business,
      legalConstraintsFor(location.jurisdictionCode, isoWeekStart(date), parseStoredOverrides(location.overrides)),
    )
    : business,
  timeZone: getBusinessTimeZone(location),
});
