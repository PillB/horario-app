/**
 * Validation for a business location (shared by the client form and the
 * secure proxy).
 *
 * Law follows the work location: a location's jurisdiction code must be the
 * one its confirmed country / region / city resolve to, so a client cannot
 * attach a rule pack that does not match the place. Its overrides may only
 * make the pack's rules stricter (services/labor/overrides.ts, CHG-089).
 */
import { resolvePack } from '@/services/labor/engine';
import { isJurisdictionCode, resolveJurisdiction } from '@/services/labor/jurisdictions';
import { validateOverrides, type LocationOverride } from '@/services/labor/overrides';
import { isDateKey, todayKey } from '@/utils/dateKeys';
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
  /** Stricter-only business limits (services/labor/overrides.ts). */
  overrides?: LocationOverride[];
};

/** A stored location as the proxy returns it. */
export type BusinessLocation = Required<Omit<LocationInput, 'overrides' | 'detectedHint'>> & {
  detectedHint: DetectedHint | null;
  /** As stored; read it with parseStoredOverrides. */
  overrides: Record<string, unknown>[];
  confirmedBy: string;
  confirmedAt: string;
  createdAt?: string;
  updatedAt?: string;
};

/** One row of a location's change history (public.location_history, CHG-089). */
export type LocationHistoryEntry = {
  id: number;
  locationId: string;
  locationName: string;
  action: 'insert' | 'update' | 'delete';
  /** Clerk user id; null when the change was made outside the app. */
  changedBy: string | null;
  changedAt: string;
  old: LocationHistoryValues | null;
  new: LocationHistoryValues | null;
};

export type LocationHistoryValues = {
  jurisdictionCode: string | null;
  timeZone: string | null;
  industry: string | null;
  employerHeadcount: number | null;
  overrides: unknown[] | null;
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
  | 'TIME_ZONE_COUNTRY_MISMATCH'
  | 'INDUSTRY_INVALID'
  | 'HEADCOUNT_INVALID'
  | 'LOCATIONS_COUNT_INVALID'
  | 'HINT_INVALID'
  | 'OVERRIDES_INVALID'
  | 'OVERRIDE_NOT_STRICTER';

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
  overrides?: LocationOverride[];
};

export type LocationValidation =
  | { ok: true; value: CleanLocation }
  | { ok: false; code: LocationErrorCode; message: string };

const COUNTRY_RE = /^[A-Z]{2}$/;
const REGION_RE = /^[A-Z0-9]{1,3}$/;
const CITY_RE = /^[A-Z0-9_]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * IANA zones of the countries that have a rule pack (tzdata zone.tab). The
 * zone sets the business day, week and night for the labor rules, so a device
 * zone from somewhere else (or UTC) must not be stored for these countries.
 */
const COUNTRY_ZONES: Readonly<Record<string, readonly string[]>> = {
  US: ['America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu'],
  CA: ['America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay', 'America/Blanc-Sablon', 'America/Toronto', 'America/Iqaluit', 'America/Atikokan', 'America/Winnipeg', 'America/Resolute', 'America/Rankin_Inlet', 'America/Regina', 'America/Swift_Current', 'America/Edmonton', 'America/Cambridge_Bay', 'America/Inuvik', 'America/Vancouver', 'America/Creston', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Whitehorse', 'America/Dawson'],
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana'],
  PE: ['America/Lima'],
  CO: ['America/Bogota'],
  CL: ['America/Santiago', 'America/Coyhaique', 'America/Punta_Arenas', 'Pacific/Easter'],
  AR: ['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Salta', 'America/Argentina/Jujuy', 'America/Argentina/Tucuman', 'America/Argentina/Catamarca', 'America/Argentina/La_Rioja', 'America/Argentina/San_Juan', 'America/Argentina/Mendoza', 'America/Argentina/San_Luis', 'America/Argentina/Rio_Gallegos', 'America/Argentina/Ushuaia'],
  BR: ['America/Noronha', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Araguaina', 'America/Maceio', 'America/Bahia', 'America/Sao_Paulo', 'America/Campo_Grande', 'America/Cuiaba', 'America/Santarem', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco'],
  GB: ['Europe/London'],
  IE: ['Europe/Dublin'],
  FR: ['Europe/Paris'],
  ES: ['Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary'],
  DE: ['Europe/Berlin', 'Europe/Busingen'],
  IT: ['Europe/Rome'],
  PT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
  NL: ['Europe/Amsterdam'],
  BE: ['Europe/Brussels'],
  PL: ['Europe/Warsaw'],
  AU: ['Australia/Lord_Howe', 'Antarctica/Macquarie', 'Australia/Hobart', 'Australia/Melbourne', 'Australia/Sydney', 'Australia/Broken_Hill', 'Australia/Brisbane', 'Australia/Lindeman', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Eucla'],
};

/** ICU's name for a zone, so aliases (US/Eastern, America/Buenos_Aires) compare equal. */
const canonicalZone = (zone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return zone;
  }
};

/**
 * Whether `zone` can be the local time of a business in `country`: never UTC
 * or an Etc/ offset, and one of the country's zones when it has a rule pack.
 */
export function zoneFitsCountry(zone: string, country: string): boolean {
  const canonical = canonicalZone(zone);
  if (/^(Etc\/|UTC$|UCT$|GMT$|Zulu$|Universal$|Greenwich$)/.test(canonical) || /^(Etc\/|UTC$|GMT$)/.test(zone)) return false;
  const zones = COUNTRY_ZONES[country];
  return !zones || zones.some((z) => z === zone || canonicalZone(z) === canonical);
}

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

export type LocationValidationOptions = {
  /** Date the overrides are checked against (default: today in the location's zone). */
  today?: string;
};

export function validateLocationInput(raw: unknown, options: LocationValidationOptions = {}): LocationValidation {
  if (!isRecord(raw)) return fail('LOCATION_REQUIRED', 'location is required');
  if (options.today !== undefined && !isDateKey(options.today)) throw new RangeError(`Invalid date key: "${options.today}"`);

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
  if (!zoneFitsCountry(timeZone, country)) {
    return fail('TIME_ZONE_COUNTRY_MISMATCH', 'timeZone must be a local time zone of the location country');
  }

  if (!isIndustry(raw.industry)) return fail('INDUSTRY_INVALID', 'industry is not supported');

  const headcount = optionalInt(raw.employerHeadcount, 0, MAX_EMPLOYER_HEADCOUNT);
  if (headcount === undefined) return fail('HEADCOUNT_INVALID', 'employerHeadcount must be a whole number ≥ 0');

  const locationsCount = optionalInt(raw.locationsCount, 1, MAX_LOCATIONS_COUNT);
  if (locationsCount === undefined) return fail('LOCATIONS_COUNT_INVALID', 'locationsCount must be a whole number ≥ 1');

  const hint = cleanHint(raw.detectedHint);
  if (hint === undefined) return fail('HINT_INVALID', 'detectedHint must be an object of short strings');

  let overrides: LocationOverride[] | undefined;
  if (raw.overrides !== undefined) {
    const date = options.today ?? todayKey(timeZone);
    const checked = validateOverrides(raw.overrides, resolvePack(resolved), date);
    if (!checked.ok) return fail(checked.code, checked.message);
    overrides = checked.value;
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
