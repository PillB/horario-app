import { locationNeedsReconfirm } from '@/utils/locationValidation';

const loc = (countryCode: string, regionCode: string | null, jurisdictionCode: string, cityCode: string | null = null) => ({
  countryCode,
  regionCode,
  cityCode,
  jurisdictionCode,
});

describe('locationNeedsReconfirm', () => {
  it('asks again for a Canadian location stored before provinces existed', () => {
    expect(locationNeedsReconfirm(loc('CA', null, 'CA'))).toBe(true);
    expect(locationNeedsReconfirm(loc('CA', 'AB', 'CA-OTHER'))).toBe(true);
    expect(locationNeedsReconfirm(loc('CA', 'BC', 'CA'))).toBe(true);
  });

  it('leaves alone a location whose stored rules are still the ones for its place', () => {
    expect(locationNeedsReconfirm(loc('CA', 'FED', 'CA'))).toBe(false);
    expect(locationNeedsReconfirm(loc('CA', 'AB', 'CA-AB'))).toBe(false);
    expect(locationNeedsReconfirm(loc('CA', 'MB', 'CA-OTHER'))).toBe(false);
    expect(locationNeedsReconfirm(loc('PE', null, 'PE'))).toBe(false);
    expect(locationNeedsReconfirm(loc('US', 'CA', 'US-CA-BERKELEY', 'BERKELEY'))).toBe(false);
  });
});
