/**
 * Time-zone data drift (CHG-103). Horario stores IANA zones and the runtime
 * converts them with its own copy of tzdata (ICU in Node and browsers,
 * Hermes on phones). That copy changes under the code: zones get renamed
 * (Europe/Kiev → Europe/Kyiv), added (America/Coyhaique, 2025b) and
 * canonicalised to older names by ICU (America/Argentina/Buenos_Aires →
 * America/Buenos_Aires). These tests fail, naming the zone and the runtime's
 * tz version, when the runtime and Horario's zone lists disagree.
 */
import { getBusinessTimeZone, NEW_ZONE_FALLBACKS } from '@/utils/businessTimeZone';
import { COUNTRY_ZONES, zoneFitsCountry } from '@/utils/locationValidation';
import { zonedShiftSpan } from '@/utils/zonedTime';

const RUNTIME = `ICU ${process.versions.icu ?? '?'}, tz ${process.versions.tz ?? '?'}`;
const canonical = (z: string) => new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone;

describe(`time-zone data (${RUNTIME})`, () => {
  it('every zone a location may store is known to this runtime', () => {
    const unknown: string[] = [];
    for (const [country, zones] of Object.entries(COUNTRY_ZONES)) {
      for (const z of zones) {
        try {
          canonical(z);
        } catch {
          unknown.push(`${country} ${z}: unknown to ${RUNTIME}${NEW_ZONE_FALLBACKS[z] ? ` (falls back to ${NEW_ZONE_FALLBACKS[z]})` : '; add a same-clock fallback in NEW_ZONE_FALLBACKS or drop it'}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('every listed zone is accepted for its own country, and for no other country with a list', () => {
    const problems: string[] = [];
    const countries = Object.keys(COUNTRY_ZONES);
    for (const [country, zones] of Object.entries(COUNTRY_ZONES)) {
      for (const z of zones) {
        if (!zoneFitsCountry(z, country)) problems.push(`${z} is refused for its own country ${country}`);
        const others = countries.filter((c) => c !== country && zoneFitsCountry(z, c));
        if (others.length) problems.push(`${z} (${country}) is also accepted for ${others.join(', ')}: ICU links it to a zone of another country`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('accepts the names ICU uses for a listed zone, and refuses UTC and fixed offsets', () => {
    expect(zoneFitsCountry('America/Buenos_Aires', 'AR')).toBe(true); // ICU's name for America/Argentina/Buenos_Aires
    expect(zoneFitsCountry('US/Eastern', 'US')).toBe(true);
    expect(zoneFitsCountry('Europe/Kyiv', 'PL')).toBe(false);
    for (const z of ['UTC', 'Etc/GMT+5', 'GMT', 'Etc/UTC']) expect(zoneFitsCountry(z, 'PE')).toBe(false);
  });

  it('each fallback for a new zone keeps the same clock today and in a year, in winter and in summer', () => {
    const problems: string[] = [];
    const year = new Date().getUTCFullYear();
    for (const [zone, older] of Object.entries(NEW_ZONE_FALLBACKS)) {
      let known = true;
      try {
        canonical(zone);
      } catch {
        known = false;
      }
      if (!known) continue; // this runtime cannot compare; the fallback is what it will use
      for (const date of [`${year}-01-15`, `${year}-07-15`, `${year + 1}-01-15`, `${year + 1}-07-15`]) {
        const a = zonedShiftSpan(date, '09:00', '17:00', zone);
        const b = zonedShiftSpan(date, '09:00', '17:00', older);
        if (a.start !== b.start) problems.push(`${zone} and ${older} differ by ${(a.start - b.start) / 60000} min on ${date}: the fallback is no longer the same clock`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('a stored zone the runtime does not know', () => {
  // Simulates a phone or browser whose tz data predates the zone.
  const zonedTime = jest.requireActual('@/utils/zonedTime');
  afterEach(() => jest.restoreAllMocks());

  it.each(Object.entries(NEW_ZONE_FALLBACKS))('%s falls back to %s, not to the device zone', (zone, older) => {
    const real = zonedTime.isValidTimeZone;
    jest.spyOn(zonedTime, 'isValidTimeZone').mockImplementation((z: unknown) => z !== zone && real(z));
    expect(getBusinessTimeZone({ timeZone: zone })).toBe(older);
  });

  it('an unknown zone with no fallback still uses the device zone', () => {
    expect(getBusinessTimeZone({ timeZone: 'Mars/Olympus_Mons' })).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
