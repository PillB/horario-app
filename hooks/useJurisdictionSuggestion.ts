/**
 * Suggests where a new business location is, from the request IP (Vercel
 * geo headers via /api/geo-hint) and the device's region and time zone
 * (expo-localization). Only a pre-fill: law follows the work location and the
 * user always confirms. `status: 'unknown'` means "ask".
 */
import { useEffect, useState } from 'react';
import { getCalendars, getLocales } from 'expo-localization';

import { getJurisdiction, regionsFor, resolveJurisdiction } from '@/services/labor/jurisdictions';
import { fetchGeoHint, type GeoHint } from '@/services/locationService';
import type { DetectedHint } from '@/utils/locationValidation';
import { isValidTimeZone } from '@/utils/zonedTime';

export type SuggestionStatus = 'detected' | 'conflict' | 'unknown';

export type JurisdictionSuggestion = {
  status: SuggestionStatus;
  /** Suggested ISO 3166-1 alpha-2 country, or null when nothing was detected. */
  country: string | null;
  /** Suggested region code, only when it has its own rule pack. */
  region: string | null;
  /** Countries to offer first: IP country and device region when they differ. */
  choices: string[];
  timeZone: string | null;
  /** What was detected, stored on the location for audit. */
  hint: DetectedHint;
};

export type DeviceSignals = { deviceRegion: string | null; deviceTimeZone: string | null };

const COUNTRY_RE = /^[A-Z]{2}$/;
const toCountry = (v: string | null | undefined): string | null => {
  const value = v?.trim().toUpperCase();
  return value && COUNTRY_RE.test(value) ? value : null;
};
const toZone = (v: string | null | undefined): string | null => (v && isValidTimeZone(v) ? v : null);

/** Default zone of the most specific pack for a place, if that pack has one. */
export const defaultTimeZoneFor = (country: string, region?: string | null): string | null =>
  getJurisdiction(resolveJurisdiction({ country, region }))?.timeZone ?? null;

export function suggestJurisdiction(geo: GeoHint, device: DeviceSignals): JurisdictionSuggestion {
  const ipCountry = toCountry(geo.ipCountry);
  const deviceRegion = toCountry(device.deviceRegion);
  const country = ipCountry ?? deviceRegion;
  const choices = Array.from(new Set([ipCountry, deviceRegion].filter((c): c is string => c !== null)));
  const status: SuggestionStatus = !country ? 'unknown' : choices.length > 1 ? 'conflict' : 'detected';

  const ipRegion = geo.ipRegion?.trim().toUpperCase() ?? null;
  const region =
    country && ipCountry === country && ipRegion && regionsFor(country).some((r) => r.region === ipRegion)
      ? ipRegion
      : null;

  const timeZone =
    toZone(geo.ipTimeZone) ?? toZone(device.deviceTimeZone) ?? (country ? defaultTimeZoneFor(country, region) : null);

  return {
    status,
    country,
    region,
    choices,
    timeZone,
    hint: {
      status,
      ipCountry: geo.ipCountry,
      ipRegion: geo.ipRegion,
      ipCity: geo.ipCity,
      ipTimeZone: geo.ipTimeZone,
      deviceRegion: device.deviceRegion,
      deviceTimeZone: device.deviceTimeZone,
    },
  };
}

export const readDeviceSignals = (): DeviceSignals => {
  try {
    return {
      deviceRegion: getLocales()[0]?.regionCode ?? null,
      deviceTimeZone: getCalendars()[0]?.timeZone ?? null,
    };
  } catch {
    return { deviceRegion: null, deviceTimeZone: null };
  }
};

/** `enabled: false` skips detection (e.g. when editing a confirmed location). */
export const useJurisdictionSuggestion = (enabled = true) => {
  const [suggestion, setSuggestion] = useState<JurisdictionSuggestion | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const device = readDeviceSignals();
    void fetchGeoHint().then((geo) => {
      if (active) setSuggestion(suggestJurisdiction(geo, device));
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return { suggestion, loading: enabled && suggestion === null };
};
