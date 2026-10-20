/**
 * @jest-environment node
 */
import { GET, geoHintFromHeaders } from '../geo-hint+api';

const hint = (headers: Record<string, string>) => geoHintFromHeaders(new Headers(headers));

describe('geo-hint', () => {
  it('returns all nulls when the Vercel headers are absent (local dev)', () => {
    expect(hint({})).toEqual({ ipCountry: null, ipRegion: null, ipCity: null, ipTimeZone: null });
  });

  it('reads and decodes the Vercel IP headers', () => {
    expect(
      hint({
        'x-vercel-ip-country': 'US',
        'x-vercel-ip-country-region': 'CA',
        'x-vercel-ip-city': 'San%20Francisco',
        'x-vercel-ip-timezone': 'America/Los_Angeles',
      }),
    ).toEqual({ ipCountry: 'US', ipRegion: 'CA', ipCity: 'San Francisco', ipTimeZone: 'America/Los_Angeles' });
    expect(hint({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' }).ipCity).toBe('São Paulo');
    expect(hint({ 'x-vercel-ip-country': 'pe', 'x-vercel-ip-country-region': 'lim' })).toMatchObject({ ipCountry: 'PE', ipRegion: 'LIM' });
  });

  it('drops malformed values instead of echoing them', () => {
    expect(hint({ 'x-vercel-ip-country': 'USA' }).ipCountry).toBeNull();
    expect(hint({ 'x-vercel-ip-country': 'X1' }).ipCountry).toBeNull();
    expect(hint({ 'x-vercel-ip-country': 'XX' }).ipCountry).toBeNull();
    expect(hint({ 'x-vercel-ip-country-region': 'ABCD' }).ipRegion).toBeNull();
    expect(hint({ 'x-vercel-ip-country-region': 'C-A' }).ipRegion).toBeNull();
    expect(hint({ 'x-vercel-ip-city': '%E0%A4%A' }).ipCity).toBeNull();
    expect(hint({ 'x-vercel-ip-city': 'a'.repeat(81) }).ipCity).toBeNull();
    expect(hint({ 'x-vercel-ip-city': 'Lima%0Aevil' }).ipCity).toBeNull();
    expect(hint({ 'x-vercel-ip-timezone': 'Mars/Olympus' }).ipTimeZone).toBeNull();
  });

  it('GET responds with JSON and no-store', async () => {
    const res = GET(new Request('http://localhost/api/geo-hint', { headers: { 'x-vercel-ip-country': 'PE', 'x-vercel-ip-timezone': 'America/Lima' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ ipCountry: 'PE', ipRegion: null, ipCity: null, ipTimeZone: 'America/Lima' });
  });
});
