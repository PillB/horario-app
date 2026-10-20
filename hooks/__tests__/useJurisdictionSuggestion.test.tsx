import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ regionCode: 'PE' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'America/Lima' }]),
}));

// eslint-disable-next-line import/first -- after the mock
import { getCalendars, getLocales } from 'expo-localization';
// eslint-disable-next-line import/first
import { suggestJurisdiction, useJurisdictionSuggestion } from '../useJurisdictionSuggestion';

const NO_GEO = { ipCountry: null, ipRegion: null, ipCity: null, ipTimeZone: null };

describe('suggestJurisdiction', () => {
  it('prefers the IP country and zone', () => {
    const s = suggestJurisdiction(
      { ipCountry: 'US', ipRegion: 'CA', ipCity: 'Berkeley', ipTimeZone: 'America/Los_Angeles' },
      { deviceRegion: 'US', deviceTimeZone: 'America/New_York' },
    );
    expect(s).toMatchObject({ status: 'detected', country: 'US', region: 'CA', choices: ['US'], timeZone: 'America/Los_Angeles' });
    expect(s.hint).toMatchObject({ ipCity: 'Berkeley', deviceRegion: 'US', status: 'detected' });
  });

  it('falls back to the device region and zone', () => {
    expect(suggestJurisdiction(NO_GEO, { deviceRegion: 'pe', deviceTimeZone: 'America/Lima' })).toMatchObject({
      status: 'detected', country: 'PE', region: null, choices: ['PE'], timeZone: 'America/Lima',
    });
  });

  it('falls back to the pack default zone', () => {
    expect(suggestJurisdiction(NO_GEO, { deviceRegion: 'ES', deviceTimeZone: null }).timeZone).toBe('Europe/Madrid');
    expect(suggestJurisdiction(NO_GEO, { deviceRegion: 'ES', deviceTimeZone: 'Not/AZone' }).timeZone).toBe('Europe/Madrid');
  });

  it('offers both countries when IP and device disagree', () => {
    expect(suggestJurisdiction({ ...NO_GEO, ipCountry: 'CL' }, { deviceRegion: 'PE', deviceTimeZone: null })).toMatchObject({
      status: 'conflict', country: 'CL', choices: ['CL', 'PE'], timeZone: 'America/Santiago',
    });
  });

  it('asks when nothing was detected', () => {
    expect(suggestJurisdiction(NO_GEO, { deviceRegion: null, deviceTimeZone: null })).toMatchObject({
      status: 'unknown', country: null, region: null, choices: [], timeZone: null,
    });
    expect(suggestJurisdiction({ ...NO_GEO, ipCountry: 'X1' }, { deviceRegion: '419', deviceTimeZone: null }).status).toBe('unknown');
  });

  it('only suggests a region that has its own pack, from the IP country', () => {
    expect(suggestJurisdiction({ ...NO_GEO, ipCountry: 'PE', ipRegion: 'LIM' }, { deviceRegion: null, deviceTimeZone: null }).region).toBeNull();
    expect(suggestJurisdiction({ ...NO_GEO, ipRegion: 'CA' }, { deviceRegion: 'US', deviceTimeZone: null }).region).toBeNull();
  });
});

describe('useJurisdictionSuggestion', () => {
  const render = async (enabled?: boolean) => {
    let state: ReturnType<typeof useJurisdictionSuggestion> | null = null;
    const Probe = () => {
      const hook = useJurisdictionSuggestion(enabled);
      useEffect(() => {
        state = hook;
      }, [hook]);
      return null;
    };
    await act(async () => {
      renderer.create(<Probe />);
    });
    return () => state!;
  };

  afterEach(() => jest.restoreAllMocks());

  it('combines the geo hint with the device settings', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ipCountry: 'US', ipRegion: 'NY', ipCity: null, ipTimeZone: 'America/New_York' }), { status: 200 }),
    );
    const state = await render();
    expect(state().loading).toBe(false);
    expect(state().suggestion).toMatchObject({ status: 'conflict', country: 'US', region: 'NY', choices: ['US', 'PE'], timeZone: 'America/New_York' });
  });

  it('uses the device when the geo hint is unavailable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const state = await render();
    expect(state().suggestion).toMatchObject({ status: 'detected', country: 'PE', timeZone: 'America/Lima' });
  });

  it('reports unknown when neither source knows the country', async () => {
    (getLocales as jest.Mock).mockReturnValueOnce([{ regionCode: null }]);
    (getCalendars as jest.Mock).mockReturnValueOnce([]);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('null', { status: 200 }));
    const state = await render();
    expect(state().suggestion?.status).toBe('unknown');
  });

  it('does nothing when disabled', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const state = await render(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state()).toEqual({ suggestion: null, loading: false });
  });
});
