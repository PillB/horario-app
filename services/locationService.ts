/**
 * Business locations through the secure proxy, which scopes every call to the
 * signed-in tenant and re-validates the jurisdiction server-side.
 */
import { getSessionToken } from '@/services/authToken';
import type { BusinessLocation, LocationInput } from '@/utils/locationValidation';

export type { BusinessLocation, LocationInput };

/** What GET /api/geo-hint returns (app/api/geo-hint+api.ts). */
export type GeoHint = {
  ipCountry: string | null;
  ipRegion: string | null;
  ipCity: string | null;
  ipTimeZone: string | null;
};

export type LocationResult<T> = { ok: true; data: T } | { ok: false; error: string };

const proxyUrl = () => process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

/** Same host as the secure proxy; relative on web when no proxy URL is set. */
export const geoHintUrl = (): string => proxyUrl().replace(/secure-proxy\/?$/, 'geo-hint');

const postToProxy = async <T>(body: Record<string, unknown>): Promise<LocationResult<T>> => {
  try {
    const token = await getSessionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(proxyUrl(), { method: 'POST', headers, body: JSON.stringify(body) });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      console.warn(`Location ${String(body.action)} failed`, payload?.error ?? response.status);
      return { ok: false, error: payload?.error ?? `Request failed (${response.status})` };
    }
    return { ok: true, data: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Location ${String(body.action)} failed`, message);
    return { ok: false, error: message };
  }
};

export const listLocations = async (): Promise<LocationResult<BusinessLocation[]>> => {
  const result = await postToProxy<{ locations?: BusinessLocation[] }>({ action: 'listLocations' });
  return result.ok ? { ok: true, data: result.data.locations ?? [] } : result;
};

export const upsertLocation = async (location: LocationInput): Promise<LocationResult<BusinessLocation>> => {
  const result = await postToProxy<{ location?: BusinessLocation }>({ action: 'upsertLocation', location });
  if (!result.ok) return result;
  return result.data.location ? { ok: true, data: result.data.location } : { ok: false, error: 'No location returned' };
};

export const deleteLocation = async (id: string): Promise<LocationResult<true>> => {
  const result = await postToProxy<{ success?: boolean }>({ action: 'deleteLocation', id });
  return result.ok ? { ok: true, data: true } : result;
};

const EMPTY_HINT: GeoHint = { ipCountry: null, ipRegion: null, ipCity: null, ipTimeZone: null };

/** IP-based hint; all nulls when unavailable (local dev, native without a proxy URL, offline). */
export const fetchGeoHint = async (): Promise<GeoHint> => {
  try {
    const response = await fetch(geoHintUrl(), { method: 'GET' });
    if (!response.ok) return EMPTY_HINT;
    const body = (await response.json()) as Partial<GeoHint> | null;
    const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
    return {
      ipCountry: str(body?.ipCountry),
      ipRegion: str(body?.ipRegion),
      ipCity: str(body?.ipCity),
      ipTimeZone: str(body?.ipTimeZone),
    };
  } catch {
    return EMPTY_HINT;
  }
};
