# Security Analysis: `app/api/secure-proxy+api.ts`

---

## Finding 1: Authentication Bypass via `AUTH_ENABLED` Flag — Critical

### Root Cause

```typescript
const AUTH_ENABLED = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');
```

`AUTH_ENABLED` is a **module-level constant** evaluated once at cold-start. Because it derives from an `EXPO_PUBLIC_*` variable, it is **bundled into the client-side bundle** by Expo as well. If the environment variable is absent or misconfigured in the Vercel deployment, `AUTH_ENABLED` silently becomes `false` and the entire authentication layer is skipped.

```typescript
async function getAuthorizedAccountId(request: Request): Promise<string | null> {
  if (!AUTH_ENABLED) return null;   // ← returns null = "no verified user"
  ...
}

// In POST:
const authorizedAccountId = await getAuthorizedAccountId(request);
if (AUTH_ENABLED && !authorizedAccountId) {
  return err('Unauthorized', 401);
}
```

When `AUTH_ENABLED === false`, `authorizedAccountId` is `null` and the 401 gate is skipped entirely. The proxy then proceeds to `resolveAccountId(null, payload.accountId)` which accepts the **attacker-supplied** `accountId` from the request body verbatim.

### Exploitation Scenario

1. Attacker calls the production endpoint without any `Authorization` header.
2. If `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing from the Vercel environment (common during CI deploys, staging, or rotation), `AUTH_ENABLED` is `false`.
3. Attacker sends `{ "action": "listWorkers", "accountId": "victim-org-uuid" }` and receives all workers.
4. Attacker can read, write, and delete **any tenant's data** using the service-role Supabase client (which bypasses RLS entirely).

### Fix

```typescript
// ❌ Remove — do not derive auth state from a public/client-visible env var
// const AUTH_ENABLED = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

// ✅ Use a server-only variable; fail CLOSED (deny) rather than open
const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY; // already in .env.example

// Auth is enabled when the server has the credentials it needs.
// If misconfigured, the route refuses all traffic — never silently opens.
const AUTH_ENABLED: boolean = Boolean(CLERK_JWKS_URL && CLERK_SECRET_KEY);

// In POST handler — fail closed:
if (!AUTH_ENABLED) {
  console.error('AUTH_ENABLED is false — refusing all traffic (check CLERK_JWKS_URL / CLERK_SECRET_KEY)');
  return err('Service unavailable', 503);
}

const authorizedAccountId = await getAuthorizedAccountId(request);
if (!authorizedAccountId) {
  return err('Unauthorized', 401);
}
```

---

## Finding 2: Broken Object-Level Authorization — Horizontal Privilege Escalation — Critical

### Root Cause

```typescript
const resolveAccountId = (authorizedId: string | null, bodyId: string): string =>
  authorizedId ?? bodyId;
```

Even when auth is enabled and a valid JWT is verified, `authorizedId` is the JWT `sub` (a **user ID**), not an **account/organisation ID**. The proxy uses it as if it were the account ID:

```typescript
case 'listWorkers': {
  const result = await dbListWorkers(
    client,
    resolveAccountId(authorizedAccountId, payload.accountId)  // ← uses JWT sub as account ID
  );
```

A legitimate user's JWT `sub` will never match any `account_id` in the `workers` table (they are different namespaces), so the fallback `payload.accountId` from the request body is used. This means **every authenticated user can query any account's data** by supplying an arbitrary `accountId`.

Additionally, several mutation operations accept IDs with **no account scoping**:

```typescript
const dbDeleteWorker = async (client: SupabaseClient, id: string) => {
  const { error } = await client.from('workers').delete().eq('id', id);
  // ← No .eq('account_id', accountId) — deletes any row by id
};

const dbUpdateShiftStatus = async (client: SupabaseClient, id: string, status: string) => {
  const { error } = await client.from('roster').update({ status }).eq('id', id);
  // ← No account scope — updates any roster row
};
```

### Exploitation Scenario

1. Authenticated user A (accountId: `org-A`) calls `deleteWorker` with `id` of a worker belonging to `org-B`.
2. Because the service-role client bypasses RLS, the delete succeeds.
3. Attacker can enumerate and destroy any tenant's data.

### Fix

```typescript
// Step 1: Store user→account membership in a table (or in the JWT via Clerk custom claims)
// This example assumes the JWT carries an `org_id` custom claim set in Clerk's session token

type ClerkPayload = {
  sub?: string;
  exp?: number;
  org_id?: string;   // Set via Clerk "Custom session token" in dashboard
};

async function verifyClerkToken(token: string): Promise<{ userId: string; accountId: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { kid?: string; alg?: string };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as ClerkPayload;

    if (!payload.sub || !payload.org_id) return null;  // require both claims
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    const jwks = await fetchJwks();
    const jwk = header.kid ? jwks.keys.find(k => k.kid === header.kid) : jwks.keys[0];
    if (!jwk) return null;

    const publicKey = createPublicKey({ key: jwk as unknown as CryptoJWK, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(publicKey, parts[2], 'base64url');

    return valid ? { userId: payload.sub, accountId: payload.org_id } : null;
  } catch {
    return null;
  }
}

// Step 2: Scope ALL mutations to the verified accountId
const dbDeleteWorker = async (client: SupabaseClient, id: string, accountId: string) => {
  const { error, count } = await client
    .from('workers')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('account_id', accountId);   // ← mandatory account scope
  if (error) return { success: false as const, error: error.message };
  if (count === 0) return { success: false as const, error: 'Not found' };
  return { success: true as const };
};

const dbUpdateShiftStatus = async (
  client: SupabaseClient,
  id: string,
  status: string,
  accountId: string  // ← add this param everywhere
) => {
  if (!isShiftStatus(status)) return { success: false as const, error: 'status must be Draft or Published' };
  const { error, count } = await client
    .from('roster')
    .update({ status })
    .eq('id', id)
    .eq('account_id', accountId);
  if (error) return { success: false as const, error: error.message };
  if (count === 0) return { success: false as const, error: 'Not found' };
  return { success: true as const };
};

// Step 3: Remove resolveAccountId entirely — always use the JWT-derived accountId
// In POST handler:
const authResult = await getAuthorizedAccountId(request);
if (!authResult) return err('Unauthorized', 401);
const { userId: verifiedUserId, accountId: verifiedAccountId } = authResult;

// All subsequent calls use verifiedAccountId — never payload.accountId
case 'listWorkers': {
  const result = await dbListWorkers(client, verifiedAccountId);
  return result.success ? ok({ workers: result.workers }) : err(result.error, 400);
}
```

---

## Finding 3: JWT Algorithm Confusion Attack — High

### Root Cause

```typescript
const header = JSON.parse(
  Buffer.from(parts[0], 'base64url').toString()
) as { kid?: string; alg?: string };
// header.alg is parsed but NEVER validated

const publicKey = createPublicKey({ key: jwk as unknown as CryptoJWK, format: 'jwk' });
const verifier = createVerify('RSA-SHA256');  // ← algorithm hardcoded, not checked against header.alg
```

The `alg` field from the JWT header is completely ignored. While the verifier is hardcoded to `RSA-SHA256`, the JWKS `kty` and `alg` fields on the selected key are also not validated. An attacker who can influence JWKS content (via cache poisoning — see Finding 5) or who finds a `none`-algorithm path could bypass signature validation.

Additionally, if Clerk ever adds an EC key to their JWKS (e.g., for `ES256`), the code will select it and call `createVerify('RSA-SHA256')` against an EC key, producing a verification error that is silently caught and returns `null` — denying legitimate users.

### Exploitation Scenario

1. Attacker crafts a token with `"alg": "none"` in the header and no signature.
2. `parts[2]` is empty string, `verifier.verify(publicKey, '', 'base64url')` throws or returns false — currently safe.
3. However, if a JWKS cache-poisoning attack (Finding 5) replaces the RSA key with an attacker-controlled one, a forged token with matching `kid` and valid RSA signature under the attacker's key passes verification.

### Fix

```typescript
const SUPPORTED_ALGORITHMS = new Set(['RS256']);

async function verifyClerkToken(token: string): Promise<{ userId: string; accountId: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString()
    ) as { kid?: string; alg?: string };

    // ✅ Reject unsupported algorithms before doing anything else
    if (!header.alg || !SUPPORTED_ALGORITHMS.has(header.alg)) {
      console.warn('JWT rejected: unsupported algorithm', header.alg);
      return null;
    }
    // ✅ Require a kid — Clerk always provides one; absence is suspicious
    if (!header.kid) {
      console.warn('JWT rejected: missing kid');
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString()
    ) as ClerkPayload;

    if (!payload.sub) return null;
    if (!payload.exp || Date.now() / 1000 > payload.exp) return null;

    // ✅ Validate issuer
    const expectedIssuer = process.env.CLERK_ISSUER_URL; // e.g. https://YOUR.clerk.accounts.dev
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      console.warn('JWT rejected: issuer mismatch', payload.iss);
      return null;
    }

    const jwks = await fetchJwks();
    // ✅ Always match by kid; never fall back to jwks.keys[0]
    const jwk = jwks.keys.find(k => k.kid === header.kid);
    if (!jwk) {
      console.warn('JWT rejected: no matching kid in JWKS', header.kid);
      return null;
    }

    // ✅ Validate key algorithm matches header
    if (jwk.alg && jwk.alg !== header.alg) {
      console.warn('JWT rejected: alg mismatch between header and JWK');
      return null;
    }
    // ✅ Validate key type
    if (jwk.kty !== 'RSA') {
      console.warn('JWT rejected: unexpected key type', jwk.kty);
      return null;
    }

    const publicKey = createPublicKey({ key: jwk as unknown as CryptoJWK, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(publicKey, parts[2], 'base64url');

    if (!valid) return null;

    if (!payload.org_id) {
      console.warn('JWT rejected: missing org_id claim');
      return null;
    }

    return { userId: payload.sub, accountId: payload.org_id };
  } catch {
    return null;
  }
}
```

---

## Finding 4: Missing Clock Skew Tolerance + No `nbf`/`iat` Validation — High

### Root Cause

```typescript
if (payload.exp && Date.now() / 1000 > payload.exp) return null;
```

Three problems:
1. **`exp` is optional** — if absent the check is skipped entirely (`if (payload.exp && ...)`), allowing tokens with no expiry to remain valid forever.
2. **No `nbf` (not before) check** — a future-dated token is accepted immediately.
3. **No clock skew buffer** — in distributed environments (Vercel edge cold starts, NTP drift) a token that expired 1 second ago is rejected even though it is cryptographically valid.

### Fix

```typescript
const CLOCK_SKEW_SECONDS = 30;

function validateTokenTiming(payload: ClerkPayload): boolean {
  const now = Date.now() / 1000;

  // ✅ exp is REQUIRED
  if (!payload.exp) {
    console.warn('JWT rejected: missing exp claim');
    return false;
  }
  if (now > payload.exp + CLOCK_SKEW_SECONDS) {
    return false;
  }

  // ✅ Check nbf if present
  if (payload.nbf !== undefined && now < payload.nbf - CLOCK_SKEW_SECONDS) {
    console.warn('JWT rejected: token not yet valid');
    return false;
  }

  // ✅ Sanity-check iat — reject tokens issued far in the future
  if (payload.iat !== undefined && payload.iat > now + CLOCK_SKEW_SECONDS) {
    console.warn('JWT rejected: iat is in the future');
    return false;
  }

  return true;
}

// In verifyClerkToken:
if (!validateTokenTiming(payload)) return null;
```

---

## Finding 5: SSRF via Unvalidated `FORECAST_API_URL` + JWKS URL — High

### Root Cause

```typescript
const FORECAST_API_URL = process.env.EXPO_PUBLIC_FORECAST_API_URL;
// ...
const response = await fetch(FORECAST_API_URL, {  // ← no URL validation
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(inputs),
});
```

And:

```typescript
const res = await fetch(CLERK_JWKS_URL!);  // ← no URL validation, no timeout
```

**`FORECAST_API_URL`** is an `EXPO_PUBLIC_*` variable — it is bundled into the client bundle. A compromised client build pipeline or misconfigured environment could point it at `http://169.254.169.254/latest/meta-data/` (AWS IMDS), internal Vercel infrastructure endpoints, or other cloud metadata URLs.

**`CLERK_JWKS_URL`** has no timeout. A slow or hanging upstream causes the Lambda to timeout, creating a denial-of-service vector against the JWKS endpoint.

### Exploitation Scenario

1. Attacker compromises the Vercel environment variable `EXPO_PUBLIC_FORECAST_API_URL=http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
2. Every `forecast` action exfiltrates AWS instance credentials via the response handling path.
3. Alternatively: point at an internal Redis or Postgres port to probe internal network topology.

### Fix

```typescript
// ✅ Validate URLs at startup — fail fast if misconfigured
function validateServerUrl(raw: string | undefined, name: string): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL: ${raw}`);
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error(`${name} must use http(s): ${raw}`);
  }
  // Block link-local, loopback, and private ranges in production
  if (process.env.NODE_ENV === 'production') {
    const BLOCKED = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,
      /^fc00:/i,
    ];
    if (BLOCKED.some(re => re.test(url.hostname))) {
      throw new Error(`${name} points to a blocked address: ${raw}`);
    }
  }
  return url;
}

// Validate at module load — throws before serving any request if misconfigured
const FORECAST_API_URL_PARSED = FORECAST_API_URL
  ? validateServerUrl(FORECAST_API_URL, 'FORECAST_API_URL')
  : null;

validateServerUrl(CLERK_JWKS_URL, 'CLERK_JWKS_URL');  // throws on bad config

// ✅ Add timeout to all outbound fetches
const FETCH_TIMEOUT_MS = 5000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchJwks(): Promise<JWKSet> {
  if (jwksCache && Date.now() < jwksCacheExpiry) return jwksCache;
  const res = await fetchWithTimeout(CLERK_JWKS_URL!);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  // ✅ Limit response size to prevent memory exhaustion
  const text = await res.text();
  if (text.length > 64 * 1024) throw new Error('JWKS response too large');
  jwksCache = JSON.parse(text) as JWKSet;
  jwksCacheExpiry = Date.now() + 5 * 60 * 1000;
  return jwksCache;
}

const callForecastApi = async (inputs: { ... }): Promise<ForecastApiOutcome> => {
  if (!FORECAST_API_URL_PARSED) {
    return { forecasts: [], attempted: false, failed: false };
  }
  try {
    const response = await fetchWithTimeout(FORECAST_API_URL_PARSED.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    // ... rest of handler
  }
};
```

---

## Finding 6: No Rate Limiting — High

### Root Cause

The route has no rate limiting whatsoever. Every action — including compute-heavy operations — is unthrottled:

- `forecast` triggers three parallel Supabase queries + an external HTTP call.
- `uploadPosSales` can insert 1,000 rows per request.
- `incrementAutoAssign` contains a non-atomic check-then-update (race condition).
- The JWKS fetch is cached but every cache miss makes an outbound HTTP call.

The `incrementAutoAssign` race condition is a separate TOCTOU issue: two concurrent requests can both read `count = 0`, both decide `canAutoAssign = true`, and both increment — doubling the allowed usage.

### Fix

```typescript
// ✅ Option A: Vercel KV-based sliding window rate limiter (recommended for Vercel)
import { kv } from '@vercel/kv';

async function checkRateLimit(
  identifier: string,  // e.g. verifiedUserId or IP
  action: string,
  limitPerMinute: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rl:${action}:${identifier}:${Math.floor(Date.now() / 60000)}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, 60);
  const remaining = Math.max(0, limitPerMinute - count);
  return { allowed: count <= limitPerMinute, remaining };
}

// Per-action limits (tune as needed)
const RATE_LIMITS: Partial<Record<ProxyRequest['action'], number>> = {
  forecast: 10,         // expensive — 10/min
  uploadPosSales: 20,
  incrementAutoAssign: 5,
  upsertTargets: 30,
};

// In POST, after auth:
const actionLimit = RATE_LIMITS[payload.action];
if (actionLimit) {
  const rl = await checkRateLimit(verifiedUserId, payload.action, actionLimit);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
        'X-RateLimit-Remaining': '0',
        ...corsH,
      },
    });
  }
}

// ✅ Fix incrementAutoAssign race condition with a Postgres function
// Instead of the upsert-then-update pattern, use a single atomic SQL call:
const dbIncrementAutoAssign = async (client: SupabaseClient, userId: string, accountId: string) => {
  if (!isNonEmptyString(userId, 200) || !isNonEmptyString(accountId, 200)) {
    return { success: false as const, error: 'userId and accountId are required' };
  }
  // Create this function once in Supabase:
  // CREATE OR REPLACE FUNCTION increment_auto_assign(p_user_id TEXT, p_account_id TEXT)
  // RETURNS INTEGER LANGUAGE plpgsql AS $$
  // DECLARE new_count INTEGER;
  // BEGIN
  //   INSERT INTO usage_limits (user_id, account_id, auto_assign_count)
  //   VALUES (p_user_id, p_account_id, 1)
  //   ON CONFLICT (user_id, account_id)
  //   DO UPDATE SET auto_assign_count = usage_limits.auto_assign_count + 1
  //   RETURNING auto_assign_count INTO new_count;
  //   RETURN new_count;
  // END; $$;
  const { data, error } = await client.rpc('increment_auto_assign', {
    p_user_id: userId,
    p_account_id: accountId,
  });
  if (error) return { success: false as const, error: error.message };
  return { success: true as const, count: data as number };
};
```

---

## Finding 7: Error Information Leakage — High

### Root Cause

```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error('Secure proxy request failed', error);
  return err(message, 500);  // ← raw error message sent to client
}
```

And in individual DB helpers:

```typescript
if (error) return { success: false as const, error: error.message };
// These are returned directly:
return err(result.error, 400);  // ← Supabase error message to client
```

Supabase error messages routinely contain table names, column names, constraint names, and query fragments. Example real Supabase errors that would be leaked:

- `duplicate key value violates unique constraint "workers_account_id_name_key"`
- `insert or update on table "roster" violates foreign key constraint "roster_worker_id_fkey"`
- `permission denied for table usage_limits` (reveals RLS misconfiguration)

### Fix

```typescript
// ✅ Centralized error sanitizer
type SafeError = { userMessage: string; internalMessage: string; code?: string };

function sanitizeDbError(error: { message: string; code?: string }): SafeError {
  const internalMessage = error.message;
  const code = error.code;

  // Map known Postgres/Supabase error codes to safe user messages
  const userMessage = (() => {
    switch (code) {
      case '23505': return 'A record with these details already exists.';
      case '23503': return 'Referenced record does not exist.';
      case '23502': return 'A required field is missing.';
      case '42501': return 'Database permission error.';
      case 'PGRST116': return 'No record found.';
      default: return 'A database error occurred.';
    }
  })();

  return { userMessage, internalMessage, code };
}

// ✅ Updated DB helper pattern
const dbDeleteWorker = async (client: SupabaseClient, id: string, accountId: string) => {
  const { error } = await client
    .from('workers')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId);
  if (error) {
    const { userMessage, internalMessage, code } = sanitizeDbError(error);
    console.error('dbDeleteWorker failed', { code, internalMessage, id, accountId });
    return { success: false as const, error: userMessage };  // ← safe message only
  }
  return { success: true as const };
};

// ✅ Updated top-level catch
} catch (error) {
  const internalMessage = error instanceof Error ? error.message : String(error);
  console.error('Secure proxy unhandled error', {
    action: (payload as ProxyRequest | undefined)?.action,
    error: internalMessage,
    stack: error instanceof Error ? error.stack : undefined,
  });
  // Never echo internal error to client
  return err('An internal error occurred. Please try again.', 500);
}
```

---

## Finding 8: Missing Request Body Size Limit — High

### Root Cause

```typescript
payload = (await request.json()) as ProxyRequest;
```

There is no body size validation. The `uploadPosSales` action advertises a 1,000-row limit checked _after_ parsing, but an attacker can send a 100 MB JSON body before hitting any validation. On Vercel, the default function payload is 4.5 MB (Serverless) or 4 MB (Edge), but it's better to be explicit and defend against forged `Content-Type` bodies.

The `notes` and `source` fields in `PosRow` have no length caps:

```typescript
type PosRow = {
  date: string;
  revenue: number;
  covers?: number | null;
  notes?: string | null;   // ← unbounded
  source: 'upload' | 'manual';
};
```

### Fix

```typescript
// ✅ Check Content-Length before reading body
export async function POST(request: Request) {
  const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return err('Request too large', 413);
  }

  // ✅ Read as text first, then parse, to enforce size on actual body
  let rawBody: string;
  try {
    // Wrap in a size-limited reader
    const reader = request.body?.getReader();
    if (!reader) return err('Empty body', 400);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        reader.cancel();
        return err('Request too large', 413);
      }
      chunks.push(value);
    }
    rawBody = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array())
    );
  } catch {
    return err('Failed to read request body', 400);
  }

  let payload: ProxyRequest;
  try {
    payload = JSON.parse(rawBody) as ProxyRequest;
  } catch {
    return err('Invalid request payload', 400);
  }

  // ✅ Validate PosRow fields
  const isValidPosRow = (r: unknown): r is PosRow => {
    if (typeof r !== 'object' || r === null) return false;
    const row = r as Record<string, unknown>;
    if (!VALID_DATE_RE.test(row.date as string)) return false;
    if (typeof row.revenue !== 'number' || row.revenue < 0 || row.revenue > 1_000_000) return false;
    if (row.notes !== undefined && row.notes !== null) {
      if (typeof row.notes !== 'string' || row.notes.length > 500) return false;
    }
    if (row.source !== 'upload' && row.source !== 'manual') return false;
    return true;
  };
```

---

## Finding 9: JWKS Cache Poisoning / No JWKS Integrity Validation — Medium

### Root Cause

```typescript
let jwksCache: JWKSet | null = null;
let jwksCacheExpiry = 0;

async function fetchJwks(): Promise<JWKSet> {
  if (jwksCache && Date.now() < jwksCacheExpiry) return jwksCache;
  const res = await fetch(CLERK_JWKS_URL!);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  jwksCache = (await res.json()) as JWKSet;
  jwksCacheExpiry = Date.now() + 5 * 60 * 1000;
  return jwksCache;
}
```

The in-memory cache is stored at **module level**. On Vercel Serverless Functions, each Lambda instance has independent memory — there is no shared cache across instances. This means:

1. Every new Lambda cold-start re-fetches JWKS from Clerk on the first request.
2. The cache is lost on every function instance termination.
3. Under traffic spikes, hundreds of simultaneous JWKS fetches occur (thundering herd).
4. No validation of JWKS structure — an attacker who performs DNS spoofing or MITM against the Clerk endpoint (possible if Clerk's CDN is compromised) can inject arbitrary keys.

### Fix

```typescript
// ✅ Validate JWKS structure before caching
function validateJwks(raw: unknown):