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
 * The IANA zone used to place shifts on the timeline: the location's zone when
 * it is valid, else the device zone.
 */
export const getBusinessTimeZone = (location?: { timeZone?: string | null } | null): string =>
  location?.timeZone && isValidTimeZone(location.timeZone) ? location.timeZone : getDeviceTimeZone();
