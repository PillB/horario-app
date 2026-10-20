/**
 * The jurisdictions Horario has labor-rule packs for, and how a business
 * location's confirmed country / region / city resolves to them.
 *
 * Law follows the work location, so a jurisdiction is stored per business
 * location (never per user or device). Detection only suggests; the user
 * confirms. Codes: ISO 3166-1 alpha-2 country, then ISO 3166-2 subdivision,
 * then an upper-case city slug: "US", "US-CA", "US-CA-BERKELEY".
 *
 * A country with no pack of its own resolves to its regional floor (EU member
 * states → "EU", the Working Time Directive) or to "GENERIC", a conservative
 * pack flagged as unverified that asks the business to review its rules.
 */

export type JurisdictionCode = string;

export type JurisdictionInfo = {
  code: JurisdictionCode;
  /** English name; the UI localizes country names with Intl.DisplayNames. */
  name: string;
  country: string;
  region?: string;
  city?: string;
  /** Parent in the rule chain; child rules add to or tighten the parent's. */
  parent?: JurisdictionCode;
  /** Default IANA zone suggested for a new location (user can change it). */
  timeZone?: string;
};

const J = (info: JurisdictionInfo): JurisdictionInfo => info;

export const JURISDICTIONS: readonly JurisdictionInfo[] = [
  J({ code: 'GENERIC', name: 'Other country (generic rules)', country: '' }),
  J({ code: 'EU', name: 'European Union (Working Time Directive)', country: '' }),

  // United States
  J({ code: 'US', name: 'United States (federal)', country: 'US', timeZone: 'America/New_York' }),
  J({ code: 'US-CA', name: 'California', country: 'US', region: 'CA', parent: 'US', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-CA-SF', name: 'San Francisco', country: 'US', region: 'CA', city: 'SF', parent: 'US-CA', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-CA-LA', name: 'Los Angeles (city)', country: 'US', region: 'CA', city: 'LA', parent: 'US-CA', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-CA-BERKELEY', name: 'Berkeley', country: 'US', region: 'CA', city: 'BERKELEY', parent: 'US-CA', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-CA-EMERYVILLE', name: 'Emeryville', country: 'US', region: 'CA', city: 'EMERYVILLE', parent: 'US-CA', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-NY', name: 'New York State', country: 'US', region: 'NY', parent: 'US', timeZone: 'America/New_York' }),
  J({ code: 'US-NY-NYC', name: 'New York City', country: 'US', region: 'NY', city: 'NYC', parent: 'US-NY', timeZone: 'America/New_York' }),
  J({ code: 'US-OR', name: 'Oregon', country: 'US', region: 'OR', parent: 'US', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-WA', name: 'Washington', country: 'US', region: 'WA', parent: 'US', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-WA-SEATTLE', name: 'Seattle', country: 'US', region: 'WA', city: 'SEATTLE', parent: 'US-WA', timeZone: 'America/Los_Angeles' }),
  J({ code: 'US-IL', name: 'Illinois', country: 'US', region: 'IL', parent: 'US', timeZone: 'America/Chicago' }),
  J({ code: 'US-IL-CHICAGO', name: 'Chicago', country: 'US', region: 'IL', city: 'CHICAGO', parent: 'US-IL', timeZone: 'America/Chicago' }),
  J({ code: 'US-IL-EVANSTON', name: 'Evanston', country: 'US', region: 'IL', city: 'EVANSTON', parent: 'US-IL', timeZone: 'America/Chicago' }),
  J({ code: 'US-PA', name: 'Pennsylvania', country: 'US', region: 'PA', parent: 'US', timeZone: 'America/New_York' }),
  J({ code: 'US-PA-PHILADELPHIA', name: 'Philadelphia', country: 'US', region: 'PA', city: 'PHILADELPHIA', parent: 'US-PA', timeZone: 'America/New_York' }),

  // Latin America
  J({ code: 'PE', name: 'Peru', country: 'PE', timeZone: 'America/Lima' }),
  J({ code: 'MX', name: 'Mexico', country: 'MX', timeZone: 'America/Mexico_City' }),
  J({ code: 'CO', name: 'Colombia', country: 'CO', timeZone: 'America/Bogota' }),
  J({ code: 'CL', name: 'Chile', country: 'CL', timeZone: 'America/Santiago' }),
  J({ code: 'BR', name: 'Brazil', country: 'BR', timeZone: 'America/Sao_Paulo' }),
  J({ code: 'AR', name: 'Argentina', country: 'AR', timeZone: 'America/Argentina/Buenos_Aires' }),

  // Europe
  J({ code: 'ES', name: 'Spain', country: 'ES', parent: 'EU', timeZone: 'Europe/Madrid' }),
  J({ code: 'FR', name: 'France', country: 'FR', parent: 'EU', timeZone: 'Europe/Paris' }),
  J({ code: 'DE', name: 'Germany', country: 'DE', parent: 'EU', timeZone: 'Europe/Berlin' }),
  J({ code: 'IT', name: 'Italy', country: 'IT', parent: 'EU', timeZone: 'Europe/Rome' }),
  J({ code: 'PT', name: 'Portugal', country: 'PT', parent: 'EU', timeZone: 'Europe/Lisbon' }),
  J({ code: 'NL', name: 'Netherlands', country: 'NL', parent: 'EU', timeZone: 'Europe/Amsterdam' }),
  J({ code: 'BE', name: 'Belgium', country: 'BE', parent: 'EU', timeZone: 'Europe/Brussels' }),
  J({ code: 'IE', name: 'Ireland', country: 'IE', parent: 'EU', timeZone: 'Europe/Dublin' }),
  J({ code: 'PL', name: 'Poland', country: 'PL', parent: 'EU', timeZone: 'Europe/Warsaw' }),
  J({ code: 'GB', name: 'United Kingdom', country: 'GB', timeZone: 'Europe/London' }),

  // Canada and Australia
  J({ code: 'CA', name: 'Canada (federal)', country: 'CA', timeZone: 'America/Toronto' }),
  J({ code: 'CA-ON', name: 'Ontario', country: 'CA', region: 'ON', timeZone: 'America/Toronto' }),
  J({ code: 'CA-QC', name: 'Quebec', country: 'CA', region: 'QC', timeZone: 'America/Toronto' }),
  J({ code: 'AU', name: 'Australia', country: 'AU', timeZone: 'Australia/Sydney' }),
];

/** EU member states without a pack of their own fall back to the Directive. */
export const EU_MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

const BY_CODE = new Map(JURISDICTIONS.map((j) => [j.code, j]));

export const getJurisdiction = (code: JurisdictionCode): JurisdictionInfo | undefined => BY_CODE.get(code);

export const isJurisdictionCode = (code: unknown): code is JurisdictionCode =>
  typeof code === 'string' && BY_CODE.has(code);

/** Regions with their own pack, per country (for the confirm form). */
export const regionsFor = (country: string): JurisdictionInfo[] =>
  JURISDICTIONS.filter((j) => j.country === country && j.region && !j.city);

/** Cities with their own ordinance, per country + region. */
export const citiesFor = (country: string, region: string): JurisdictionInfo[] =>
  JURISDICTIONS.filter((j) => j.country === country && j.region === region && j.city);

/**
 * Most specific jurisdiction for a confirmed location. Unknown regions and
 * cities fall back to the nearest level that has a pack.
 */
export const resolveJurisdiction = (place: { country: string; region?: string | null; city?: string | null }): JurisdictionCode => {
  const country = place.country.trim().toUpperCase();
  const region = place.region?.trim().toUpperCase();
  const city = place.city?.trim().toUpperCase();
  if (region && city && BY_CODE.has(`${country}-${region}-${city}`)) return `${country}-${region}-${city}`;
  if (region && BY_CODE.has(`${country}-${region}`)) return `${country}-${region}`;
  if (BY_CODE.has(country)) return country;
  if (EU_MEMBER_STATES.has(country)) return 'EU';
  return 'GENERIC';
};

/** Rule chain from the broadest pack to the most specific, e.g. ['US', 'US-CA', 'US-CA-BERKELEY']. */
export const jurisdictionChain = (code: JurisdictionCode): JurisdictionCode[] => {
  const chain: JurisdictionCode[] = [];
  let current = BY_CODE.get(code);
  while (current) {
    chain.unshift(current.code);
    current = current.parent ? BY_CODE.get(current.parent) : undefined;
  }
  return chain;
};
