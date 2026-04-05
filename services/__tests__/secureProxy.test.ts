// ─── crypto mock (must come before module imports) ────────────────────────────

const mockVerifierUpdate = jest.fn();
const mockVerifierVerify = jest.fn().mockReturnValue(true);
const mockCreateVerify = jest.fn(() => ({
  update: mockVerifierUpdate,
  verify: mockVerifierVerify,
}));
const mockCreatePublicKey = jest.fn(() => ({ type: 'public' }));

jest.mock('crypto', () => ({
  createPublicKey: (...args: unknown[]) => mockCreatePublicKey(...args),
  createVerify: (...args: unknown[]) => mockCreateVerify(...args),
}));

// ─── supabase mock ────────────────────────────────────────────────────────────

const mockSelect = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockGte = jest.fn();
const mockLte = jest.fn();
const mockEq = jest.fn();
const mockUpsert = jest.fn();
const mockFrom = jest.fn();

const chainable = {
  select: mockSelect,
  order: mockOrder,
  limit: mockLimit,
  gte: mockGte,
  lte: mockLte,
  eq: mockEq,
  upsert: mockUpsert,
};

// Each chainable method returns the same chainable object so queries can chain
Object.values(chainable).forEach((fn) => {
  (fn as jest.Mock).mockReturnValue(chainable);
});

mockFrom.mockReturnValue(chainable);

const mockCreateClient = jest.fn(() => ({ from: mockFrom }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

// ─── env setup (before dynamic require) ──────────────────────────────────────

const FAKE_JWKS_URL = 'https://clerk.example.com/.well-known/jwks.json';

// We set env vars before requiring the module so AUTH_ENABLED evaluates correctly.
// Individual tests override as needed then reset in afterEach.
const originalEnv = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  Object.assign(process.env, overrides);
}

function resetEnv() {
  // Restore original env
  Object.keys(process.env).forEach((k) => {
    if (!(k in originalEnv)) delete process.env[k];
  });
  Object.assign(process.env, originalEnv);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

type FetchMockImpl = (url: string, init?: RequestInit) => Promise<Partial<Response>>;

function setFetchMock(impl: FetchMockImpl) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockImplementation(impl);
}

/**
 * Build a minimal JWT (base64url encoded, unsigned or custom signature).
 * payload.exp is in seconds since epoch.
 */
function buildJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signature = 'fakesig'
): string {
  const enc = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc(header)}.${enc(payload)}.${signature}`;
}

/** A JWKS response with a single RSA-like key */
const FAKE_JWKS = {
  keys: [
    { kid: 'key1', kty: 'RSA', n: 'modulus1', e: 'AQAB', alg: 'RS256', use: 'sig' },
    { kid: 'key2', kty: 'RSA', n: 'modulus2', e: 'AQAB', alg: 'RS256', use: 'sig' },
  ],
};

function makeFetchWithJwks(
  jwks: typeof FAKE_JWKS = FAKE_JWKS,
  forecastApiResponse?: { ok: boolean; status?: number; body?: unknown }
): FetchMockImpl {
  return (url: string) => {
    if (url === FAKE_JWKS_URL) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(jwks),
      });
    }
    if (forecastApiResponse !== undefined) {
      return Promise.resolve({
        ok: forecastApiResponse.ok,
        status: forecastApiResponse.status ?? 200,
        json: () => Promise.resolve(forecastApiResponse.body ?? []),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  };
}

/** Build a Request object as used by the Expo API route handler */
function makeRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>
): Request {
  return new Request('http://localhost/api/secure-proxy', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── module loader ────────────────────────────────────────────────────────────

/**
 * Dynamically require the route module AFTER env vars are set.
 * We use jest.isolateModules so each call gets a fresh module instance
 * (important for AUTH_ENABLED and the JWKS cache which are module-level singletons).
 */
async function loadRoute(envOverrides: Record<string, string | undefined> = {}): Promise<{
  GET?: (req: Request) => Promise<Response>;
  POST?: (req: Request) => Promise<Response>;
  OPTIONS?: (req: Request) => Promise<Response>;
}> {
  setEnv({
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
    CLERK_JWKS_URL: FAKE_JWKS_URL,
    EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.example.com',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    EXPO_PUBLIC_FORECAST_API_URL: '',
    ...envOverrides,
  });

  let route: {
    GET?: (req: Request) => Promise<Response>;
    POST?: (req: Request) => Promise<Response>;
    OPTIONS?: (req: Request) => Promise<Response>;
  } = {};

  await new Promise<void>((resolve) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      route = require('../../app/api/secure-proxy+api');
      resolve();
    });
  });

  return route;
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('secure-proxy API route — auth/security logic', () => {
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifierVerify.mockReturnValue(true);
    // Reset chainable query mock return values
    Object.values(chainable).forEach((fn) => {
      (fn as jest.Mock).mockReturnValue(chainable);
    });
    mockFrom.mockReturnValue(chainable);
    // Default limit resolution (no data, no error)
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockUpsert.mockResolvedValue({ data: [], error: null });

    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    resetEnv();
  });

  // ─── 1. OPTIONS returns CORS headers ──────────────────────────────────────

  it('OPTIONS request returns 200 with CORS headers', async () => {
    setFetchMock(makeFetchWithJwks());
    const route = await loadRoute();
    const req = makeRequest('OPTIONS');

    expect(route.OPTIONS).toBeDefined();
    const response = await route.OPTIONS!(req);

    expect(response.status).toBe(204);
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
    expect(allowOrigin).not.toBeNull();
  });

  // ─── 2. POST without Authorization when AUTH_ENABLED=true → 401 ───────────

  it('POST without Authorization header when AUTH_ENABLED returns 401', async () => {
    setFetchMock(makeFetchWithJwks());
    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const req = makeRequest('POST', { action: 'onboarding/get' });
    const response = await route.POST!(req);

    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  // ─── 3. POST with malformed JWT (not 3 parts) → 401 ──────────────────────

  it('POST with malformed JWT (fewer than 3 parts) returns 401', async () => {
    setFetchMock(makeFetchWithJwks());
    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const req = makeRequest(
      'POST',
      { action: 'onboarding/get' },
      { Authorization: 'Bearer notavalidjwt' }
    );
    const response = await route.POST!(req);

    expect(response.status).toBe(401);
  });

  // ─── 4. POST with expired JWT → 401 ──────────────────────────────────────

  it('POST with expired JWT returns 401', async () => {
    setFetchMock(makeFetchWithJwks());
    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const expiredPayload = {
      sub: 'user_expired',
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    };
    const token = buildJwt({ kid: 'key1', alg: 'RS256' }, expiredPayload);

    const req = makeRequest(
      'POST',
      { action: 'onboarding/get' },
      { Authorization: `Bearer ${token}` }
    );
    const response = await route.POST!(req);

    expect(response.status).toBe(401);
  });

  // ─── 5. POST with valid-looking JWT but wrong signature → 401 ────────────

  it('POST with JWT that fails signature verification returns 401', async () => {
    setFetchMock(makeFetchWithJwks());
    // Override verifier to return false (bad sig)
    mockVerifierVerify.mockReturnValue(false);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const payload = {
      sub: 'user_badsig',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = buildJwt({ kid: 'key1', alg: 'RS256' }, payload, 'badsignature');

    const req = makeRequest(
      'POST',
      { action: 'onboarding/get' },
      { Authorization: `Bearer ${token}` }
    );
    const response = await route.POST!(req);

    expect(response.status).toBe(401);
  });

  // ─── 6. POST with missing action field → 400 ─────────────────────────────

  it('POST with missing action field returns 400', async () => {
    setFetchMock(makeFetchWithJwks());
    const route = await loadRoute({
      // AUTH_ENABLED = false so we skip auth and reach action validation
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      CLERK_JWKS_URL: '',
    });

    const req = makeRequest('POST', { notAction: 'something' });
    const response = await route.POST!(req);

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/action/i);
  });

  // ─── 7. POST with unknown action → 400 ───────────────────────────────────

  it('POST with unrecognised action returns 400', async () => {
    setFetchMock(makeFetchWithJwks());
    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      CLERK_JWKS_URL: '',
    });

    const req = makeRequest('POST', { action: 'totally/unknown' });
    const response = await route.POST!(req);

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  // ─── 8. POST with missing Supabase credentials → 500 ─────────────────────

  it('POST returns 500 when Supabase service credentials are missing', async () => {
    setFetchMock(makeFetchWithJwks());

    // Loading with empty Supabase credentials is sufficient — getServiceClient()
    // throws before createClient is reached, so no mockImplementationOnce needed.
    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      CLERK_JWKS_URL: '',
      EXPO_PUBLIC_SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    });

    const req = makeRequest('POST', { action: 'onboarding/get' });
    const response = await route.POST!(req);

    expect(response.status).toBe(500);
  });

  // ─── 9. verifyClerkToken: correct kid selects the right JWK ──────────────

  it('uses the JWK matching the JWT kid header when verifying', async () => {
    setFetchMock(makeFetchWithJwks());
    // verifier returns true for valid sig
    mockVerifierVerify.mockReturnValue(true);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const payload = {
      sub: 'user_correct_kid',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    // Use kid: 'key2' — it should pick the second key from FAKE_JWKS
    const token = buildJwt({ kid: 'key2', alg: 'RS256' }, payload, 'validsig');

    const req = makeRequest(
      'POST',
      { action: 'onboarding/get' },
      { Authorization: `Bearer ${token}` }
    );

    await route.POST!(req);

    // createPublicKey should have been called with the key whose kid === 'key2'
    expect(mockCreatePublicKey).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({ kid: 'key2', n: 'modulus2' }),
      })
    );
  });

  // ─── 10. verifyClerkToken: no kid falls back to first key ─────────────────

  it('falls back to the first JWK when JWT header has no kid', async () => {
    setFetchMock(makeFetchWithJwks());
    mockVerifierVerify.mockReturnValue(true);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const payload = {
      sub: 'user_no_kid',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    // No kid in header
    const token = buildJwt({ alg: 'RS256' }, payload, 'validsig');

    const req = makeRequest(
      'POST',
      { action: 'onboarding/get' },
      { Authorization: `Bearer ${token}` }
    );

    await route.POST!(req);

    // Should have used the FIRST key (kid: 'key1', n: 'modulus1')
    expect(mockCreatePublicKey).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({ kid: 'key1', n: 'modulus1' }),
      })
    );
  });

  // ─── 11. JWKS cache: second call within TTL does not refetch ─────────────

  it('does not refetch JWKS on a second request within the cache TTL', async () => {
    const fetchImpl = jest.fn().mockImplementation(makeFetchWithJwks());
    (global as unknown as { fetch: jest.Mock }).fetch = fetchImpl;

    mockVerifierVerify.mockReturnValue(true);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const makeAuthReq = () => {
      const payload = {
        sub: 'user_cache',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = buildJwt({ kid: 'key1', alg: 'RS256' }, payload, 'validsig');
      return makeRequest(
        'POST',
        { action: 'onboarding/get' },
        { Authorization: `Bearer ${token}` }
      );
    };

    await route.POST!(makeAuthReq());
    await route.POST!(makeAuthReq());

    // fetch is called for JWKS URL; with caching it should only be called once
    const jwksCalls = fetchImpl.mock.calls.filter(
      (args: unknown[]) => args[0] === FAKE_JWKS_URL
    );
    expect(jwksCalls.length).toBe(1);
  });

  // ─── 12. JWKS cache: expired TTL causes a refetch ─────────────────────────

  it('refetches JWKS after cache TTL expires', async () => {
    jest.useFakeTimers();

    const fetchImpl = jest.fn().mockImplementation(makeFetchWithJwks());
    (global as unknown as { fetch: jest.Mock }).fetch = fetchImpl;

    mockVerifierVerify.mockReturnValue(true);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const makeAuthReq = () => {
      const payload = {
        sub: 'user_ttl',
        exp: Math.floor(Date.now() / 1000) + 7200,
      };
      const token = buildJwt({ kid: 'key1', alg: 'RS256' }, payload, 'validsig');
      return makeRequest(
        'POST',
        { action: 'onboarding/get' },
        { Authorization: `Bearer ${token}` }
      );
    };

    // First request — populates cache
    await route.POST!(makeAuthReq());

    // Advance time past the 5-minute TTL
    jest.advanceTimersByTime(6 * 60 * 1000);

    // Second request — cache expired, should refetch
    await route.POST!(makeAuthReq());

    jest.useRealTimers();

    const jwksCalls = fetchImpl.mock.calls.filter(
      (args: unknown[]) => args[0] === FAKE_JWKS_URL
    );
    expect(jwksCalls.length).toBe(2);
  });

  // ─── 13. POST onboarding/get returns onboarding data when auth passes ──────

  it('POST loadTargets returns 200 with data when authentication passes', async () => {
    setFetchMock(makeFetchWithJwks());
    mockVerifierVerify.mockReturnValue(true);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const jwtPayload = {
      sub: 'user_loadtargets',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = buildJwt({ kid: 'key1', alg: 'RS256' }, jwtPayload, 'validsig');

    const req = makeRequest(
      'POST',
      { action: 'loadTargets' },
      { Authorization: `Bearer ${token}` }
    );

    const response = await route.POST!(req);

    expect(response.status).toBe(200);
    const body = await response.json() as unknown;
    expect(body).toBeDefined();
  });

  // ─── 14. POST onboarding/upsert with invalid body → 400 ──────────────────

  it('POST onboarding/upsert with invalid/empty body returns 400', async () => {
    setFetchMock(makeFetchWithJwks());
    mockVerifierVerify.mockReturnValue(true);

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_realkey',
    });

    const payload = {
      sub: 'user_upsert',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = buildJwt({ kid: 'key1', alg: 'RS256' }, payload, 'validsig');

    // Send action but no valid onboarding payload (empty object for data)
    const req = makeRequest(
      'POST',
      { action: 'onboarding/upsert' }, // missing required fields
      { Authorization: `Bearer ${token}` }
    );

    const response = await route.POST!(req);

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  // ─── 15. Rate limiting absent — all rapid requests succeed (no 429) ────────

  it('documents absence of rate limiting: rapid repeated requests all return non-429', async () => {
    /**
     * KNOWN GAP: The secure-proxy route does not implement rate limiting.
     * This test documents that behaviour — all rapid requests succeed without
     * receiving HTTP 429 Too Many Requests.  A future implementation should
     * add rate limiting and this test should be updated accordingly.
     */
    setFetchMock(makeFetchWithJwks());

    const route = await loadRoute({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      CLERK_JWKS_URL: '',
    });

    const requestCount = 20;
    const responses = await Promise.all(
      Array.from({ length: requestCount }, () =>
        route.POST!(
          makeRequest('POST', { action: 'getStatus' }, {})
        )
      )
    );

    // None should be 429 — rate limiting is not implemented yet
    const statuses = await Promise.all(responses.map((r) => r.status));
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });
});