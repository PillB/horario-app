/**
 * The IANA time zone the business schedules in.
 *
 * Shift times are wall-clock times at the business, so the scheduler must
 * convert them with the business zone, not with a fixed UTC offset (a fixed
 * offset is wrong for every shift after a DST change).
 *
 * For now this is the device's zone. When locations carry their own zone this
 * is the single place that should read it.
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

/** The IANA zone used to place shifts on the timeline (currently the device zone). */
export const getBusinessTimeZone = (): string => getDeviceTimeZone();
