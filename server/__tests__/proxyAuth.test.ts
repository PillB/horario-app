/**
 * @jest-environment node
 *
 * Authentication matrix for the server API routes (no database needed).
 */
import { installJwksFetch, signToken, TEST_ISSUER, TEST_JWKS_URL } from '../testUtils/testTokens';

type AuthModule = typeof import('../proxyAuth');
type Route = { POST: (req: Request) => Promise<Response>; OPTIONS: (req: Request) => Response };

const ENV_KEYS = [
  'CLERK_JWKS_URL', 'CLERK_ISSUER', 'CLERK_AUTHORIZED_PARTIES', 'HORARIO_INSECURE_DEV_AUTH', 'HORARIO_DEV_ACCOUNT_ID',
  'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'EXPO_PUBLIC_APP_ORIGIN',
  'VERCEL_ENV', 'EXPO_PUBLIC_APP_ENV',
];
const savedEnv: Record<string, string | undefined> = {};
const savedNodeEnv = process.env.NODE_ENV;

const setNodeEnv = (value: string | undefined) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

const loadAuth = (): AuthModule => {
  let mod!: AuthModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per test
    mod = require('../proxyAuth');
  });
  return mod;
};

const loadRoute = (): Route => {
  let mod!: Route;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per test
    mod = require('../../app/api/secure-proxy+api');
  });
  return mod;
};

const request = (token?: string, body: unknown = { action: 'listWorkers' }, origin?: string) =>
  new Request('http://localhost/api/secure-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('proxy authentication', () => {
  let fetchSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    fetchSpy = installJwksFetch();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
    setNodeEnv(savedNodeEnv);
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('accepts a valid personal-session token; tenant is the user', async () => {
    const result = await loadAuth().authenticate(request(signToken('user_1')));
    expect(result).toEqual({ ok: true, ctx: { userId: 'user_1', accountId: 'user_1', canManage: true, insecureDev: false } });
  });

  it('uses the active organization as tenant (v2 o.id and v1 org_id)', async () => {
    const auth = loadAuth();
    const v2 = await auth.authenticate(request(signToken('user_1', { claims: { o: { id: 'org_9' } } })));
    const v1 = await auth.authenticate(request(signToken('user_1', { claims: { org_id: 'org_8' } })));
    expect(v2.ok && v2.ctx.accountId).toBe('org_9');
    expect(v1.ok && v1.ctx.accountId).toBe('org_8');
  });

  it('never trusts the account id sent by the client when auth is configured', async () => {
    const result = await loadAuth().authenticate(request(signToken('user_1'), { action: 'listWorkers', accountId: 'victim' }));
    expect(result.ok && result.ctx.accountId).toBe('user_1');
  });

  it.each([
    ['no token', undefined],
    ['malformed token', 'not.a-jwt'],
    ['two-part token', 'abc.def'],
    ['expired token', signToken('u', { claims: { exp: Math.floor(Date.now() / 1000) - 60 } })],
    ['token without exp', signToken('u', { claims: { exp: undefined } })],
    ['not-yet-valid token', signToken('u', { claims: { nbf: Math.floor(Date.now() / 1000) + 600 } })],
    ['wrong issuer', signToken('u', { claims: { iss: 'https://evil.example' } })],
    ['missing issuer', signToken('u', { claims: { iss: undefined } })],
    ['alg none', signToken('u', { header: { alg: 'none' } })],
    ['alg HS256 (confusion)', signToken('u', { header: { alg: 'HS256' } })],
    ['unknown kid', signToken('u', { header: { kid: 'rotated-away' } })],
    ['signed by another key', signToken('u', { foreignKey: true })],
    ['no sub', signToken('', {})],
  ])('rejects %s with 401', async (_label, token) => {
    const result = await loadAuth().authenticate(request(token as string | undefined));
    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('rejects a tampered payload', async () => {
    const [h, , s] = signToken('user_1').split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iss: TEST_ISSUER, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
    const result = await loadAuth().authenticate(request(`${h}.${forged}.${s}`));
    expect(result.ok).toBe(false);
  });

  it('enforces the azp allow-list when configured', async () => {
    process.env.CLERK_AUTHORIZED_PARTIES = 'https://horario.app';
    const auth = loadAuth();
    expect((await auth.authenticate(request(signToken('u', { claims: { azp: 'https://evil.example' } })))).ok).toBe(false);
    expect((await auth.authenticate(request(signToken('u', { claims: { azp: 'https://horario.app' } })))).ok).toBe(true);
  });

  it('rejects a browser token without azp once the allow-list is set; native may omit it', async () => {
    process.env.CLERK_AUTHORIZED_PARTIES = 'https://horario.app';
    const auth = loadAuth();
    expect((await auth.authenticate(request(signToken('u'), undefined, 'https://horario.app'))).ok).toBe(false);
    expect((await auth.authenticate(request(signToken('u')))).ok).toBe(true);
  });

  it.each(['VERCEL_ENV', 'EXPO_PUBLIC_APP_ENV'])('requires the azp allow-list in production (%s)', async (key) => {
    process.env[key] = 'production';
    const result = await loadAuth().authenticate(request(signToken('u', { claims: { azp: 'https://horario.app' } })));
    expect(result).toEqual({ ok: false, status: 503, error: 'Authentication is not configured' });
  });

  it('lets personal accounts and org admins manage, not other org members', async () => {
    const auth = loadAuth();
    const roleOf = async (claims: Record<string, unknown>) => {
      const r = await auth.authenticate(request(signToken('u', { claims })));
      return r.ok && r.ctx.canManage;
    };
    expect(await roleOf({})).toBe(true);
    expect(await roleOf({ o: { id: 'org_1', rol: 'admin' } })).toBe(true);
    expect(await roleOf({ org_id: 'org_1', org_role: 'org:admin' })).toBe(true);
    expect(await roleOf({ o: { id: 'org_1', rol: 'member' } })).toBe(false);
    expect(await roleOf({ org_id: 'org_1', org_role: 'org:member' })).toBe(false);
    expect(await roleOf({ o: { id: 'org_1' } })).toBe(false);
  });

  it('fails closed with 503 when no verifier is configured', async () => {
    delete process.env.CLERK_JWKS_URL;
    const result = await loadAuth().authenticate(request());
    expect(result).toEqual({ ok: false, status: 503, error: 'Authentication is not configured' });
  });

  it('allows the insecure dev mode only outside production builds', async () => {
    delete process.env.CLERK_JWKS_URL;
    process.env.HORARIO_INSECURE_DEV_AUTH = '1';

    process.env.HORARIO_DEV_ACCOUNT_ID = 'acct_dev';

    setNodeEnv('development');
    const dev = await loadAuth().authenticate(request(undefined, { action: 'listWorkers', accountId: 'someone_else' }));
    expect(dev).toEqual({ ok: true, ctx: { userId: 'acct_dev', accountId: 'acct_dev', canManage: true, insecureDev: true } });

    setNodeEnv('production');
    const prod = await loadAuth().authenticate(request());
    expect(prod).toEqual({ ok: false, status: 503, error: 'Authentication is not configured' });
  });

  it('caches the key set between requests', async () => {
    const auth = loadAuth();
    await auth.authenticate(request(signToken('a')));
    await auth.authenticate(request(signToken('b')));
    const jwksCalls = fetchSpy.mock.calls.filter(([url]) => url === TEST_JWKS_URL);
    expect(jwksCalls).toHaveLength(1);
  });
});

describe('secure proxy route', () => {
  let fetchSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    fetchSpy = installJwksFetch();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.CLERK_JWKS_URL;
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('rejects invalid JSON and a missing action with 400', async () => {
    const route = loadRoute();
    expect((await route.POST(request(signToken('u'), '{nope'))).status).toBe(400);
    expect((await route.POST(request(signToken('u'), { foo: 1 }))).status).toBe(400);
  });

  it('rejects unauthenticated requests before touching the database', async () => {
    const res = await loadRoute().POST(request(undefined));
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 503 without leaking details when the database is not configured', async () => {
    const res = await loadRoute().POST(request(signToken('u')));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Database is not configured' });
  });

  it.each(['deleteWorker', 'deleteRosterShift', 'cancelSubscription'])(
    'forbids %s for an org member who is not an admin',
    async (action) => {
      const member = signToken('u', { claims: { o: { id: 'org_1', rol: 'member' } } });
      const res = await loadRoute().POST(request(member, { action, id: 'x' }));
      expect(res.status).toBe(403);
    },
  );

  it('answers CORS preflight only for allowed origins', () => {
    process.env.EXPO_PUBLIC_APP_ORIGIN = 'https://horario.app';
    const route = loadRoute();
    const allowed = route.OPTIONS(new Request('http://localhost/api/secure-proxy', { method: 'OPTIONS', headers: { origin: 'https://horario.app' } }));
    const denied = route.OPTIONS(new Request('http://localhost/api/secure-proxy', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://horario.app');
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBe('null');
    delete process.env.EXPO_PUBLIC_APP_ORIGIN;
  });
});
