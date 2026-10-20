/**
 * GET /api/geo-hint — where the request seems to come from, from Vercel's
 * IP geolocation headers (x-vercel-ip-*).
 *
 * Only a hint for pre-filling the location form: IP geolocation is often
 * wrong (VPNs, carriers, corporate proxies) and the law that applies follows
 * the work location, which the user confirms. No auth is needed because it
 * only echoes the caller's own request headers. Every field is null when the
 * headers are absent (local dev) or malformed.
 */
import { jsonResponse } from '@/server/http';
import type { GeoHint } from '@/services/locationService';
import { isValidTimeZone } from '@/utils/zonedTime';

export const runtime = 'nodejs';

const COUNTRY_RE = /^[A-Z]{2}$/;
const REGION_RE = /^[A-Z0-9]{1,3}$/;
const CITY_MAX = 80;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

const country = (raw: string | null): string | null => {
  const value = raw?.trim().toUpperCase();
  // "XX" is how some geo databases say "unknown".
  return value && COUNTRY_RE.test(value) && value !== 'XX' ? value : null;
};

const region = (raw: string | null): string | null => {
  const value = raw?.trim().toUpperCase();
  return value && REGION_RE.test(value) ? value : null;
};

const city = (raw: string | null): string | null => {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  return decoded.length > 0 && decoded.length <= CITY_MAX && !CONTROL_RE.test(decoded) ? decoded : null;
};

const timeZone = (raw: string | null): string | null => {
  const value = raw?.trim();
  return value && isValidTimeZone(value) ? value : null;
};

export function geoHintFromHeaders(headers: Headers): GeoHint {
  return {
    ipCountry: country(headers.get('x-vercel-ip-country')),
    ipRegion: region(headers.get('x-vercel-ip-country-region')),
    ipCity: city(headers.get('x-vercel-ip-city')),
    ipTimeZone: timeZone(headers.get('x-vercel-ip-timezone')),
  };
}

export function GET(request: Request): Response {
  return jsonResponse(geoHintFromHeaders(request.headers), 200, request.headers.get('origin'));
}
