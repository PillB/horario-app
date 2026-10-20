/* eslint-disable import/first */
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ regionCode: null }]),
  getCalendars: jest.fn(() => [{ timeZone: null }]),
}));

jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));

jest.mock('@/contexts/LocaleContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { en } = require('@/locales/en');
  const resolve = (obj: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], obj);
  const t = (key: string, params?: Record<string, string>) => {
    let val = resolve(en, key);
    if (typeof val !== 'string') val = key;
    let out = val as string;
    if (params) Object.entries(params).forEach(([k, v]) => { out = out.replace(`{${k}}`, v); });
    return out;
  };
  return { useT: () => ({ t, langCode: 'en', locale: en, setLanguage: () => {}, isLoading: false }) };
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { getCalendars, getLocales } from 'expo-localization';

import { LocationSetupCard } from '@/components/locations/LocationSetupCard';
import { LocationsManager } from '@/components/locations/LocationsManager';
import type { BusinessLocation, LocationInput, LocationResult } from '@/services/locationService';

type GeoBody = { ipCountry: string | null; ipRegion: string | null; ipCity: string | null; ipTimeZone: string | null };
const NO_GEO: GeoBody = { ipCountry: null, ipRegion: null, ipCity: null, ipTimeZone: null };

const mockGeo = (geo: GeoBody) =>
  jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify(geo), { status: 200 }));

const setDevice = (region: string | null, zone: string | null) => {
  (getLocales as jest.Mock).mockReturnValue([{ regionCode: region }]);
  (getCalendars as jest.Mock).mockReturnValue([{ timeZone: zone }]);
};

const textOf = (tree: renderer.ReactTestRenderer, testID: string): string => {
  const node = tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string')[0];
  const flatten = (c: unknown): string => (Array.isArray(c) ? c.map(flatten).join('') : typeof c === 'string' ? c : '');
  return node ? flatten(node.props.children) : '';
};
const exists = (tree: renderer.ReactTestRenderer, testID: string) =>
  tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string').length > 0;
const press = async (tree: renderer.ReactTestRenderer, testID: string) => {
  const node = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0];
  if (!node) throw new Error(`No pressable ${testID}`);
  await act(async () => {
    await node.props.onPress();
  });
};
const type = async (tree: renderer.ReactTestRenderer, testID: string, value: string) => {
  const node = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onChangeText === 'function')[0];
  await act(async () => {
    node.props.onChangeText(value);
  });
};

const savedFrom = (input: LocationInput): BusinessLocation => ({
  id: input.id ?? '00000000-0000-0000-0000-0000000000aa',
  name: input.name,
  countryCode: input.countryCode,
  regionCode: input.regionCode ?? null,
  cityCode: input.cityCode ?? null,
  jurisdictionCode: input.jurisdictionCode,
  timeZone: input.timeZone,
  industry: input.industry,
  employerHeadcount: input.employerHeadcount ?? null,
  locationsCount: input.locationsCount ?? null,
  detectedHint: input.detectedHint ?? null,
  overrides: [],
  confirmedBy: 'user_a',
  confirmedAt: '2026-10-20T00:00:00Z',
});

const renderCard = async (props: Partial<React.ComponentProps<typeof LocationSetupCard>> = {}) => {
  const onSave = jest.fn(async (input: LocationInput): Promise<LocationResult<BusinessLocation>> => ({ ok: true, data: savedFrom(input) }));
  const onSaved = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LocationSetupCard onSave={onSave} onSaved={onSaved} {...props} />);
  });
  return { tree, onSave, onSaved };
};

describe('LocationSetupCard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('pre-fills a detected country and asks the user to confirm it', async () => {
    setDevice('PE', 'America/Lima');
    mockGeo({ ...NO_GEO, ipCountry: 'PE', ipTimeZone: 'America/Lima' });
    const { tree, onSave, onSaved } = await renderCard();

    expect(textOf(tree, 'location-detect-message')).toBe('We think this location is in Peru. Is that right?');
    expect(textOf(tree, 'location-country')).toBe('Peru');
    expect(exists(tree, 'location-country-picker')).toBe(false);
    expect(tree.root.findAll((n) => n.props.testID === 'location-timezone' && typeof n.type === 'string')[0].props.value).toBe('America/Lima');
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: Peru');

    await press(tree, 'industry-option-food_service');
    await type(tree, 'location-headcount', '12');
    await press(tree, 'location-save');

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Main location', countryCode: 'PE', regionCode: null, cityCode: null, jurisdictionCode: 'PE',
      timeZone: 'America/Lima', industry: 'food_service', employerHeadcount: 12,
      detectedHint: expect.objectContaining({ status: 'detected', ipCountry: 'PE', deviceRegion: 'PE' }),
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows the country picker first when detection failed, with a searchable full list', async () => {
    setDevice(null, null);
    mockGeo(NO_GEO);
    const { tree, onSave } = await renderCard();

    expect(textOf(tree, 'location-detect-message')).toBe("We couldn't detect the country. Where is this location?");
    expect(exists(tree, 'location-country-picker')).toBe(true);
    expect(exists(tree, 'industry-option-retail')).toBe(false);
    expect(exists(tree, 'country-option-PE')).toBe(true);
    expect(exists(tree, 'country-option-JP')).toBe(true);

    await type(tree, 'location-country-search', 'japa');
    expect(exists(tree, 'country-option-JP')).toBe(true);
    expect(exists(tree, 'country-option-PE')).toBe(false);

    await press(tree, 'country-option-JP');
    expect(exists(tree, 'location-country-picker')).toBe(false);
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: Generic baseline rules (Japan)');
    expect(exists(tree, 'location-baseline-note')).toBe(true);

    // No pack zone for Japan: the user must type one.
    await press(tree, 'industry-option-retail');
    await press(tree, 'location-save');
    expect(onSave).not.toHaveBeenCalled();
    expect(textOf(tree, 'location-error')).toMatch(/valid time zone/);

    await type(tree, 'location-timezone', 'Asia/Tokio');
    expect(tree.root.findAll((n) => typeof n.type === 'string' && n.props.children === 'Enter a valid time zone, for example America/Lima or Europe/Madrid.').length).toBeGreaterThan(0);
    await type(tree, 'location-timezone', 'Asia/Tokyo');
    await press(tree, 'location-save');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ countryCode: 'JP', jurisdictionCode: 'GENERIC', timeZone: 'Asia/Tokyo' }));
  });

  it('offers both countries when the IP and the device disagree', async () => {
    setDevice('PE', 'America/Lima');
    mockGeo({ ...NO_GEO, ipCountry: 'CL', ipTimeZone: 'America/Santiago' });
    const { tree } = await renderCard();

    expect(textOf(tree, 'location-detect-message')).toBe('Your connection suggests Chile, but this device is set to Peru. Where is this location?');
    await press(tree, 'choice-PE');
    expect(textOf(tree, 'location-country')).toBe('Peru');
    expect(tree.root.findAll((n) => n.props.testID === 'location-timezone' && typeof n.type === 'string')[0].props.value).toBe('America/Lima');
  });

  it('shows region and city pickers where a more specific pack exists', async () => {
    setDevice('US', 'America/Los_Angeles');
    mockGeo({ ...NO_GEO, ipCountry: 'US', ipRegion: 'CA', ipTimeZone: 'America/Los_Angeles' });
    const { tree, onSave } = await renderCard();

    expect(exists(tree, 'region-option-CA')).toBe(true);
    expect(exists(tree, 'region-option-other')).toBe(true);
    expect(exists(tree, 'city-option-BERKELEY')).toBe(true);
    expect(exists(tree, 'city-option-other')).toBe(true);
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: California, United States');

    await press(tree, 'city-option-BERKELEY');
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: Berkeley, California, United States');

    await press(tree, 'region-option-other');
    expect(exists(tree, 'city-option-BERKELEY')).toBe(false);
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: United States');

    await press(tree, 'region-option-CA');
    await press(tree, 'city-option-BERKELEY');
    await press(tree, 'industry-option-retail');
    await press(tree, 'location-save');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ regionCode: 'CA', cityCode: 'BERKELEY', jurisdictionCode: 'US-CA-BERKELEY' }));
  });

  it('flags EU baseline rules for member states without their own pack', async () => {
    setDevice('AT', 'Europe/Vienna');
    mockGeo(NO_GEO);
    const { tree } = await renderCard();
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: European Union (Working Time Directive) (Austria)');
    expect(exists(tree, 'location-baseline-note')).toBe(true);
  });

  it('edits an existing location without running detection and shows save errors', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const initial = savedFrom({ id: '00000000-0000-0000-0000-000000000001', name: 'Madrid', countryCode: 'ES', jurisdictionCode: 'ES', timeZone: 'Europe/Madrid', industry: 'hotel' });
    const onSave = jest.fn(async (): Promise<LocationResult<BusinessLocation>> => ({ ok: false, error: 'Only an admin of this business can do this' }));
    const { tree } = await renderCard({ initial, onSave });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(exists(tree, 'location-detect-message')).toBe(false);
    expect(textOf(tree, 'location-rules')).toBe('Rules applied: Spain');
    expect(exists(tree, 'location-baseline-note')).toBe(false);

    await press(tree, 'location-save');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: initial.id, name: 'Madrid', industry: 'hotel' }));
    expect(textOf(tree, 'location-error')).toBe("Couldn't save the location: Only an admin of this business can do this");
  });

  it('gives every pressable an accessibility role, label and hint', async () => {
    setDevice('US', 'America/New_York');
    mockGeo({ ...NO_GEO, ipCountry: 'US', ipRegion: 'NY' });
    const { tree } = await renderCard({ onCancel: () => {} });
    const pressables = tree.root.findAll((n) => typeof n.type !== 'string' && typeof n.props.onPress === 'function' && n.props.accessibilityRole);
    expect(pressables.length).toBeGreaterThan(5);
    for (const p of pressables) {
      expect(p.props.accessibilityLabel).toBeTruthy();
      expect(p.props.accessibilityHint).toBeTruthy();
    }
  });
});

describe('LocationsManager', () => {
  afterEach(() => jest.restoreAllMocks());

  const lima = savedFrom({ id: '00000000-0000-0000-0000-000000000001', name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'retail' });

  it('lists locations, confirms deletes and opens the form', async () => {
    const calls: string[] = [];
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { action: string }) : { action: 'geo' };
      calls.push(body.action);
      if (body.action === 'listLocations') return new Response(JSON.stringify({ locations: [lima] }), { status: 200 });
      if (body.action === 'deleteLocation') return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify(NO_GEO), { status: 200 });
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LocationsManager accountId="acc" />);
    });
    expect(exists(tree, `location-row-${lima.id}`)).toBe(true);

    await press(tree, `location-delete-${lima.id}`);
    expect(calls).not.toContain('deleteLocation');
    expect(tree.root.findAll((n) => typeof n.type === 'string' && n.props.children === 'Tap again to delete').length).toBeGreaterThan(0);
    await press(tree, `location-delete-${lima.id}`);
    expect(calls).toContain('deleteLocation');
    expect(exists(tree, `location-row-${lima.id}`)).toBe(false);

    await press(tree, 'location-add');
    expect(exists(tree, 'location-setup-card')).toBe(true);
  });

  it('does not crash when the proxy refuses (no auth configured)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'Authentication is not configured' }), { status: 503 }));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LocationsManager accountId="acc" />);
    });
    expect(tree.root.findAll((n) => typeof n.type === 'string' && n.props.children === "Couldn't load your locations.").length).toBeGreaterThan(0);
    expect(exists(tree, 'location-add')).toBe(false);
  });
});
