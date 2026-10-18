import { isDiagnosticsEnabled, isProductionApp } from '../appEnv';

describe('appEnv', () => {
  const original = process.env.EXPO_PUBLIC_APP_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = original;
  });

  it('treats an unset EXPO_PUBLIC_APP_ENV as non-production', () => {
    delete process.env.EXPO_PUBLIC_APP_ENV;
    expect(isProductionApp()).toBe(false);
    expect(isDiagnosticsEnabled()).toBe(true);
  });

  it.each(['preview', 'development', 'staging', 'Production'])(
    'enables diagnostics when EXPO_PUBLIC_APP_ENV=%s',
    (value) => {
      process.env.EXPO_PUBLIC_APP_ENV = value;
      expect(isDiagnosticsEnabled()).toBe(true);
    },
  );

  it('disables diagnostics when EXPO_PUBLIC_APP_ENV=production', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    expect(isProductionApp()).toBe(true);
    expect(isDiagnosticsEnabled()).toBe(false);
  });
});
