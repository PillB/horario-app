/**
 * Validation for a business location (shared by the client form and the
 * secure proxy).
 *
 * Law follows the work location: a location's jurisdiction code must be the
 * one its confirmed country / region / city resolve to, so a client cannot
 * attach a rule pack that does not match the place.
 */
import { isJurisdictionCode, resolveJurisdiction } from '@/services/labor/jurisdictions';
import { isValidTimeZone } from '@/utils/zonedTime';

export const INDUSTRIES = [
  'retail',
  'food_service',
  'fast_food',
  'full_service_restaurant',
  'hospitality',
  'hotel',
  'warehouse',
  'manufacturing',
  'healthcare',
  'building_services',
  'other',
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export const LOCATION_NAME_MAX = 80;
export const MAX_EMPLOYER_HEADCOUNT = 10_000_000;
export const MAX_LOCATIONS_COUNT = 100_000;
const MAX_OVERRIDES = 50;
const MAX_OVERRIDES_JSON = 16_000;
const HINT_KEYS = ['status', 'ipCountry', 'ipRegion', 'ipCity', 'ipTimeZone', 'deviceRegion', 'deviceTimeZone'] as const;

export type DetectedHint = Partial<Record<(typeof HINT_KEYS)[number], string | null>>;

/** A location as the client sends it. */
export type LocationInput = {
  id?: string;
  name: string;
  countryCode: string;
  regionCode?: string | null;
  cityCode?: string | null;
  jurisdictionCode: string;
  timeZone: string;
  industry: Industry;
  employerHeadcount?: number | null;
  locationsCount?: number | null;
  detectedHint?: DetectedHint | null;
  overrides?: Record<string, unknown>[];
};

/** A stored location as the proxy returns it. */
export type BusinessLocation = Required<Omit<LocationInput, 'overrides' | 'detectedHint'>> & {
  detectedHint: DetectedHint | null;
  overrides: Record<string, unknown>[];
  confirmedBy: string;
  confirmedAt: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LocationErrorCode =
  | 'LOCATION_REQUIRED'
  | 'NAME_INVALID'
  | 'COUNTRY_INVALID'
  | 'REGION_INVALID'
  | 'CITY_INVALID'
  | 'JURISDICTION_UNKNOWN'
  | 'JURISDICTION_MISMATCH'
  | 'TIME_ZONE_INVALID'
  | 'INDUSTRY_INVALID'
  | 'HEADCOUNT_INVALID'
  | 'LOCATIONS_COUNT_INVALID'
  | 'HINT_INVALID'
  | 'OVERRIDES_INVALID';

/** Normalized values ready for the database (snake_case columns). */
export type CleanLocation = {
  id?: string;
  name: string;
  country_code: string;
  region_code: string | null;
  city_code: string | null;
  jurisdiction_code: string;
  time_zone: string;
  industry: Industry;
  employer_headcount: number | null;
  locations_count: number | null;
  detected_hint: DetectedHint | null;
  /** Undefined when the client sent none (keeps the stored value on update). */
  overrides?: Record<string, unknown>[];
};

export type LocationValidation =
  | { ok: true; value: CleanLocation }
  | { ok: false; code: LocationErrorCode; message: string };

const COUNTRY_RE = /^[A-Z]{2}$/;
const REGION_RE = /^[A-Z0-9]{1,3}$/;
const CITY_RE = /^[A-Z0-9_]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isIndustry = (v: unknown): v is Industry => (INDUSTRIES as readonly unknown[]).includes(v);

export const isCountryCode = (v: unknown): v is string => typeof v === 'string' && COUNTRY_RE.test(v);

/** Trims and upper-cases an optional code; empty → null; non-string → undefined (invalid). */
const optionalCode = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
};

const optionalInt = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === undefined || v === null) return null;
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined;
};

const cleanHint = (v: unknown): DetectedHint | null | undefined => {
  if (v === undefined || v === null) return null;
  if (!isRecord(v)) return undefined;
  const hint: DetectedHint = {};
  for (const key of HINT_KEYS) {
    const value = v[key];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== 'string' || value.length > 80)) return undefined;
    hint[key] = value;
  }
  return hint;
};

const fail = (code: LocationErrorCode, message: string): LocationValidation => ({ ok: false, code, message });

export function validateLocationInput(raw: unknown): LocationValidation {
  if (!isRecord(raw)) return fail('LOCATION_REQUIRED', 'location is required');

  if (raw.id !== undefined && (typeof raw.id !== 'string' || !UUID_RE.test(raw.id))) {
    return fail('LOCATION_REQUIRED', 'id must be a UUID');
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length < 1 || name.length > LOCATION_NAME_MAX) {
    return fail('NAME_INVALID', `name is required (max ${LOCATION_NAME_MAX} chars)`);
  }

  const country = typeof raw.countryCode === 'string' ? raw.countryCode.trim().toUpperCase() : '';
  if (!COUNTRY_RE.test(country)) return fail('COUNTRY_INVALID', 'countryCode must be an ISO 3166-1 alpha-2 code');

  const region = optionalCode(raw.regionCode);
  if (region === undefined || (region !== null && !REGION_RE.test(region))) {
    return fail('REGION_INVALID', 'regionCode must be up to 3 letters or digits');
  }

  const city = optionalCode(raw.cityCode);
  if (city === undefined || (city !== null && (!CITY_RE.test(city) || region === null))) {
    return fail('CITY_INVALID', 'cityCode must be a short code and needs a regionCode');
  }

  if (!isJurisdictionCode(raw.jurisdictionCode)) return fail('JURISDICTION_UNKNOWN', 'jurisdictionCode is not a known jurisdiction');
  const resolved = resolveJurisdiction({ country, region, city });
  if (raw.jurisdictionCode !== resolved) {
    return fail('JURISDICTION_MISMATCH', 'jurisdictionCode does not match the location country, region and city');
  }

  const timeZone = typeof raw.timeZone === 'string' ? raw.timeZone.trim() : '';
  if (!isValidTimeZone(timeZone)) return fail('TIME_ZONE_INVALID', 'timeZone must be an IANA time zone');

  if (!isIndustry(raw.industry)) return fail('INDUSTRY_INVALID', 'industry is not supported');

  const headcount = optionalInt(raw.employerHeadcount, 0, MAX_EMPLOYER_HEADCOUNT);
  if (headcount === undefined) return fail('HEADCOUNT_INVALID', 'employerHeadcount must be a whole number ≥ 0');

  const locationsCount = optionalInt(raw.locationsCount, 1, MAX_LOCATIONS_COUNT);
  if (locationsCount === undefined) return fail('LOCATIONS_COUNT_INVALID', 'locationsCount must be a whole number ≥ 1');

  const hint = cleanHint(raw.detectedHint);
  if (hint === undefined) return fail('HINT_INVALID', 'detectedHint must be an object of short strings');

  let overrides: Record<string, unknown>[] | undefined;
  if (raw.overrides !== undefined) {
    if (
      !Array.isArray(raw.overrides) ||
      raw.overrides.length > MAX_OVERRIDES ||
      !raw.overrides.every(isRecord) ||
      JSON.stringify(raw.overrides).length > MAX_OVERRIDES_JSON
    ) {
      return fail('OVERRIDES_INVALID', `overrides must be an array of up to ${MAX_OVERRIDES} objects`);
    }
    overrides = raw.overrides as Record<string, unknown>[];
  }

  return {
    ok: true,
    value: {
      ...(raw.id !== undefined ? { id: raw.id as string } : {}),
      name,
      country_code: country,
      region_code: region,
      city_code: city,
      jurisdiction_code: resolved,
      time_zone: timeZone,
      industry: raw.industry,
      employer_headcount: headcount,
      locations_count: locationsCount,
      detected_hint: hint,
      ...(overrides !== undefined ? { overrides } : {}),
    },
  };
}
