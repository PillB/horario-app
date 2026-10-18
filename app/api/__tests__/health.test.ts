/**
 * @jest-environment node
 */
import { GET, buildHealthPayload } from '../health+api';

const ENV_KEYS = [
  'VERCEL_ENV',
  'NODE_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'CLERK_JWKS_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
] as const;

const SECRET_VALUES = {
  CLERK_JWKS_URL: 'https://secret-instance.clerk.accounts.dev/.well-known/jwks.json',
  EXPO_PUBLIC_SUPABASE_URL: 'https://secretproject.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_DO_NOT_LEAK_123',
};

describe('buildHealthPayload', () => {
  it('reports development with nothing configured', () => {
    expect(buildHealthPayload({})).toEqual({
      status: 'ok',
      environment: 'development',
      commit: null,
      authConfigured: false,
      databaseConfigured: false,
    });
  });

  it('prefers VERCEL_ENV over NODE_ENV', () => {
    expect(buildHealthPayload({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }).environment).toBe(
      'preview',
    );
    expect(buildHealthPayload({ VERCEL_ENV: 'production' }).environment).toBe('production');
  });

  it('falls back to NODE_ENV and maps unknown values to development', () => {
    expect(buildHealthPayload({ NODE_ENV: 'production' }).environment).toBe('production');
    expect(buildHealthPayload({ NODE_ENV: 'test' }).environment).toBe('development');
  });

  it('shortens the commit SHA to 7 characters', () => {
    const payload = buildHealthPayload({
      VERCEL_GIT_COMMIT_SHA: 'dffcc5d2b441d3a8fa27952404b8be9e03def227',
    });
    expect(payload.commit).toBe('dffcc5d');
  });

  it('requires both the Supabase URL and a server key for databaseConfigured', () => {
    expect(
      buildHealthPayload({ EXPO_PUBLIC_SUPABASE_URL: SECRET_VALUES.EXPO_PUBLIC_SUPABASE_URL })
        .databaseConfigured,
    ).toBe(false);
    expect(
      buildHealthPayload({ SUPABASE_SERVICE_ROLE_KEY: SECRET_VALUES.SUPABASE_SERVICE_ROLE_KEY })
        .databaseConfigured,
    ).toBe(false);
    expect(
      buildHealthPayload({
        EXPO_PUBLIC_SUPABASE_URL: SECRET_VALUES.EXPO_PUBLIC_SUPABASE_URL,
        SUPABASE_SERVICE_KEY: 'legacy-key',
      }).databaseConfigured,
    ).toBe(true);
  });

  it('treats blank values as not configured', () => {
    const payload = buildHealthPayload({
      CLERK_JWKS_URL: '  ',
      EXPO_PUBLIC_SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
    });
    expect(payload.authConfigured).toBe(false);
    expect(payload.databaseConfigured).toBe(false);
  });
});

describe('GET /api/health', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('returns 200 JSON with Cache-Control no-store and never leaks secret values', async () => {
    Object.assign(process.env, SECRET_VALUES, {
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
    });

    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      environment: 'production',
      commit: 'abcdef1',
      authConfigured: true,
      databaseConfigured: true,
    });
    for (const secret of Object.values(SECRET_VALUES)) {
      expect(text).not.toContain(secret);
    }
  });
});
