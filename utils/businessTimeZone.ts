/**
 * The IANA time zone the business schedules in.
 *
 * Shift times are wall-clock times at the business, so the scheduler must
 * convert them with the business zone, not with a fixed UTC offset (a fixed
 * offset is wrong for every shift after a DST change).
 *
 * A business location stores its own IANA zone (CHG-076); callers pass the
 * location that applies and fall back to the device zone without one.
 */
import { isValidTimeZone } from '@/utils/zonedTime';

/** The device's IANA zone, or 'UTC' when the runtime cannot report a valid one. */
export const getDeviceTimeZone = (): string => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Zones added to tzdata recently, with an older zone that keeps the same
 * clock from the date shown on (CHG-103). A location can store one of these
 * (the validator accepts it), but a browser or phone with older time-zone
 * data does not know it. Without this map the scheduler would fall back to
 * the device zone, which is wrong whenever the manager is somewhere else.
 * - America/Coyhaique (tzdata 2025b): Aysén has kept UTC-3 all year since
 *   2025-03-20, as Punta Arenas has since 2016.
 * - America/Ciudad_Juarez (tzdata 2022g): Mountain time with US daylight
 *   saving since 2022-11-30, as Denver.
 */
export const NEW_ZONE_FALLBACKS: Readonly<Record<string, string>> = {
  'America/Coyhaique': 'America/Punta_Arenas',
  'America/Ciudad_Juarez': 'America/Denver',
};

/**
 * The IANA zone used to place shifts on the timeline: the location's zone when
 * the runtime knows it, else a same-clock older zone for a zone newer than
 * the runtime's data, else the device zone.
 */
export const getBusinessTimeZone = (location?: { timeZone?: string | null } | null): string => {
  const zone = location?.timeZone;
  if (zone && isValidTimeZone(zone)) return zone;
  const older = zone ? NEW_ZONE_FALLBACKS[zone] : undefined;
  return older && isValidTimeZone(older) ? older : getDeviceTimeZone();
};
