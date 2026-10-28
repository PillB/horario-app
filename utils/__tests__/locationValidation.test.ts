import { validateLocationInput, type LocationInput } from '../locationValidation';

const base: LocationInput = {
  name: 'Lima Centro',
  countryCode: 'PE',
  jurisdictionCode: 'PE',
  timeZone: 'America/Lima',
  industry: 'food_service',
};

const check = (overrides: Record<string, unknown>) => validateLocationInput({ ...base, ...overrides });
const codeOf = (overrides: Record<string, unknown>) => {
  const r = check(overrides);
  return r.ok ? 'OK' : r.code;
};

describe('validateLocationInput', () => {
  it('accepts a valid location and normalizes it to columns', () => {
    const r = check({ name: '  Lima Centro ', employerHeadcount: 12, locationsCount: 1, detectedHint: { ipCountry: 'PE', deviceRegion: 'PE' } });
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Lima Centro',
        country_code: 'PE',
        region_code: null,
        city_code: null,
        jurisdiction_code: 'PE',
        time_zone: 'America/Lima',
        industry: 'food_service',
        employer_headcount: 12,
        locations_count: 1,
        detected_hint: { ipCountry: 'PE', deviceRegion: 'PE' },
      },
    });
  });

  it('accepts a US city with its own ordinance', () => {
    const r = check({ countryCode: 'us', regionCode: 'ca', cityCode: 'berkeley', jurisdictionCode: 'US-CA-BERKELEY', timeZone: 'America/Los_Angeles' });
    expect(r.ok && r.value).toMatchObject({ country_code: 'US', region_code: 'CA', city_code: 'BERKELEY', jurisdiction_code: 'US-CA-BERKELEY' });
  });

  it('accepts the EU and GENERIC fallbacks only when the country resolves to them', () => {
    expect(codeOf({ countryCode: 'AT', jurisdictionCode: 'EU', timeZone: 'Europe/Vienna' })).toBe('OK');
    expect(codeOf({ countryCode: 'JP', jurisdictionCode: 'GENERIC', timeZone: 'Asia/Tokyo' })).toBe('OK');
    expect(codeOf({ countryCode: 'ES', jurisdictionCode: 'EU' })).toBe('JURISDICTION_MISMATCH');
  });

  it('rejects a pack that does not match the place', () => {
    expect(codeOf({ jurisdictionCode: 'US-CA-SF' })).toBe('JURISDICTION_MISMATCH');
    expect(codeOf({ countryCode: 'US', regionCode: 'CA', jurisdictionCode: 'US' })).toBe('JURISDICTION_MISMATCH');
    expect(codeOf({ jurisdictionCode: 'PE-LIM' })).toBe('JURISDICTION_UNKNOWN');
    expect(codeOf({ jurisdictionCode: 42 })).toBe('JURISDICTION_UNKNOWN');
  });

  it('rejects bad names, countries, regions and cities', () => {
    expect(codeOf({ name: '   ' })).toBe('NAME_INVALID');
    expect(codeOf({ name: 'x'.repeat(81) })).toBe('NAME_INVALID');
    expect(codeOf({ name: 'x'.repeat(80) })).toBe('OK');
    expect(codeOf({ countryCode: 'PER' })).toBe('COUNTRY_INVALID');
    expect(codeOf({ countryCode: '' })).toBe('COUNTRY_INVALID');
    expect(codeOf({ regionCode: 'LIMA' })).toBe('REGION_INVALID');
    expect(codeOf({ regionCode: 5 })).toBe('REGION_INVALID');
    expect(codeOf({ cityCode: 'LIMA' })).toBe('CITY_INVALID');
    expect(codeOf({ id: 'not-a-uuid' })).toBe('LOCATION_REQUIRED');
    expect(validateLocationInput(null)).toMatchObject({ ok: false, code: 'LOCATION_REQUIRED' });
  });

  it('rejects bad time zones, industries and sizes', () => {
    expect(codeOf({ timeZone: 'America/Atlantis' })).toBe('TIME_ZONE_INVALID');
    expect(codeOf({ timeZone: '' })).toBe('TIME_ZONE_INVALID');
    expect(codeOf({ industry: 'casino' })).toBe('INDUSTRY_INVALID');
    expect(codeOf({ employerHeadcount: -1 })).toBe('HEADCOUNT_INVALID');
    expect(codeOf({ employerHeadcount: 2.5 })).toBe('HEADCOUNT_INVALID');
    expect(codeOf({ employerHeadcount: 0 })).toBe('OK');
    expect(codeOf({ locationsCount: 0 })).toBe('LOCATIONS_COUNT_INVALID');
    expect(codeOf({ detectedHint: { ipCity: 'x'.repeat(81) } })).toBe('HINT_INVALID');
    expect(codeOf({ detectedHint: 'PE' })).toBe('HINT_INVALID');
    expect(codeOf({ overrides: [1] })).toBe('OVERRIDES_INVALID');
    // CHG-089: overrides are typed and may only make the rules stricter.
    expect(codeOf({ overrides: [{ rule: 'maxDailyHours', value: 10, citation: 'CBA art. 4' }] })).toBe('OVERRIDES_INVALID');
    expect(codeOf({ overrides: [{ rule: 'daily.maxHours', value: 10, note: 'CBA art. 4' }] })).toBe('OK');
    expect(codeOf({ overrides: [{ rule: 'breaks.minMinutes', value: 30, afterHours: 6 }] })).toBe('OVERRIDE_NOT_STRICTER'); // Peru: 45 min after 6 h
  });

  it('checks overrides against the pack on the given date', () => {
    const es = { ...base, countryCode: 'ES', jurisdictionCode: 'ES', timeZone: 'Europe/Madrid' };
    const r = validateLocationInput({ ...es, overrides: [{ rule: 'rest.minHours', value: 11 }] }, { today: '2026-10-21' });
    expect(r).toMatchObject({ ok: false, code: 'OVERRIDE_NOT_STRICTER' });
    if (!r.ok) expect(r.message).toContain('in Spain on 2026-10-21');
    const okR = validateLocationInput({ ...es, overrides: [{ rule: 'rest.minHours', value: 13 }] }, { today: '2026-10-21' });
    expect(okR.ok && okR.value.overrides).toEqual([{ rule: 'rest.minHours', value: 13 }]);
    expect(() => validateLocationInput(es, { today: '2026-02-31' })).toThrow(RangeError);
  });

  it('keeps only known hint keys', () => {
    const r = check({ detectedHint: { ipCountry: 'PE', evil: '<script>' } });
    expect(r.ok && r.value.detected_hint).toEqual({ ipCountry: 'PE' });
  });
});
