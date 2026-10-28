/**
 * Which stored business location a scheduled shift belongs to.
 *
 * Labor law follows the work location, so the scheduler never guesses a
 * jurisdiction: a shift uses the location its roster entry names (by id, or by
 * name when exactly one location has that name), else the account's only
 * location, else none.
 */
import type { BusinessLocation } from '@/utils/locationValidation';

/** The stored location a roster entry's free-text `location` names, if any. */
export const findStoredLocation = (
  locations: readonly BusinessLocation[],
  rosterLocation: string | null | undefined,
): BusinessLocation | undefined => {
  const wanted = rosterLocation?.trim();
  if (!wanted) return undefined;
  const byId = locations.find((l) => l.id === wanted);
  if (byId) return byId;
  const byName = locations.filter((l) => l.name.trim().toLowerCase() === wanted.toLowerCase());
  return byName.length === 1 ? byName[0] : undefined;
};

/** The location whose rules apply to a shift, or null when it cannot be told. */
export const resolveShiftLocation = (
  locations: readonly BusinessLocation[],
  rosterLocation?: string | null,
): BusinessLocation | null =>
  findStoredLocation(locations, rosterLocation) ?? (locations.length === 1 ? locations[0] : null);
