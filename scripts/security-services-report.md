# Security & Bug Analysis: Horario Client-Side Services

---

## Finding 1: Missing Request Timeout — All Fetch Calls Hang Indefinitely

**Severity: High**
**Files: `demandForecast.ts`, `onboardingProgress.ts`**

### Root Cause
Neither `handleSecureFetch` nor the inline fetch in `upsertOnboardingProgress` use an `AbortController` or any timeout mechanism. A slow or unresponsive server will leave promises pending indefinitely, blocking the UI and potentially exhausting React Native's JS thread resources. On mobile networks with TCP connections that silently stall, this is a realistic failure mode — not a theoretical one.

```typescript
// CURRENT — hangs forever
const response = await fetch(SECURE_PROXY_URL, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
});
```

### Fix — Shared timeout-aware fetch utility

Create `services/fetchWithTimeout.ts`:

```typescript
// services/fetchWithTimeout.ts
export class FetchTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = 'FetchTimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

Then in `demandForecast.ts`:

```typescript
import { fetchWithTimeout, FetchTimeoutError } from './fetchWithTimeout';

const handleSecureFetch = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const token = await getSessionToken();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(
    SECURE_PROXY_URL,
    { method: 'POST', headers, body: JSON.stringify(payload) },
    15_000,
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error?.error ?? `Secure proxy responded with status ${response.status}`);
  }

  return (await response.json()) as T;
};
```

---

## Finding 2: Unauthenticated Supabase Read in `fetchOnboardingProgress`

**Severity: High**
**File: `onboardingProgress.ts`**

### Root Cause
`fetchOnboardingProgress` uses the **anonymous** Supabase client (`getSupabaseClient()`) rather than an authenticated one. The `accountId` is passed in as a plain function argument and injected directly into an `.eq()` filter. This means:

1. The request reaches PostgREST with **no JWT** — the Authorization header is absent.
2. Any RLS policy predicated on `private.jwt_account_id()` returns NULL, potentially matching no rows or — worse — matching rows depending on how the policy is written.
3. An attacker who can call this function can query any `account_id` if the anon role has SELECT permission on the table.

```typescript
// CURRENT — anonymous client, no JWT
const client = getSupabaseClient();  // ← anon, no auth header
```

### Fix

```typescript
// onboardingProgress.ts
import { getAuthenticatedClient } from './supabaseClient';
import { getSessionToken } from '@/services/authToken';

export const fetchOnboardingProgress = async (
  accountId: string,
  userId?: string | null,
): Promise<OnboardingProgress | null> => {
  // Always use an authenticated client so RLS policies can scope by JWT claims.
  const token = await getSessionToken('supabase'); // use Supabase-compatible JWT
  const client = getAuthenticatedClient(token);
  if (!client) return null;

  const baseQuery = client
    .from(TABLE_NAME)
    .select('workers_completed, templates_completed, forecast_completed')
    .eq('account_id', accountId)
    .limit(1);

  const query = applyUserFilter(baseQuery, userId);
  const { data, error } = await query.maybeSingle();

  if (error) {
    console.warn('Unable to load onboarding progress', error.message);
    return null;
  }

  if (!data) return null;

  return normalize(data as OnboardingRow);
};
```

---

## Finding 3: Caller-Controlled `accountId` and `userId` Passed Directly to Proxy Without Server-Side Validation Trust Boundary

**Severity: High**
**File: `onboardingProgress.ts`**

### Root Cause
`upsertOnboardingProgress` sends `accountId` and `userId` in the POST body to the secure proxy:

```typescript
body: JSON.stringify({ action: 'upsertOnboarding', accountId, flags, userId }),
```

The secure proxy receives these values and should **derive** the account/user identities from the verified JWT, not trust them from the request body. If the proxy uses the body-supplied `accountId` directly (a common mistake when the proxy is written after the client), any authenticated user can supply an arbitrary `accountId` to overwrite another tenant's onboarding state, constituting a horizontal privilege escalation (IDOR).

This file cannot fix the server side, but the client **must not send** values the server can validate from the JWT itself, and a code comment must make this explicit. The server-side proxy must be audited to ensure it ignores body-supplied identity values.

### Fix (client hardening + explicit comment)

```typescript
export const upsertOnboardingProgress = async (
  _accountId: string,   // ← prefix with _ to signal: server MUST derive from JWT
  flags: OnboardingProgress,
  _userId?: string | null, // ← server MUST derive from JWT claims, not this value
) => {
  try {
    const token = await getSessionToken('supabase');
    if (!token) {
      console.warn('upsertOnboardingProgress: no auth token, skipping write');
      return null;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    // SECURITY: accountId and userId are intentionally omitted from the body.
    // The secure proxy MUST extract account_id and user_id exclusively from the
    // verified JWT claims — never from the request body — to prevent IDOR attacks.
    const response = await fetchWithTimeout(
      process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'upsertOnboarding', flags }),
      },
      15_000,
    );

    // ... rest of response handling
  }
};
```

---

## Finding 4: Authorization Header Sent Without Token — Silent Downgrade to Anon

**Severity: High**
**File: `demandForecast.ts`, `onboardingProgress.ts`**

### Root Cause
Both `handleSecureFetch` and the inline fetch in `onboardingProgress.ts` silently proceed **without an Authorization header** when `getSessionToken()` returns null:

```typescript
const token = await getSessionToken();

const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (token) {                              // ← silent downgrade if null
  headers['Authorization'] = `Bearer ${token}`;
}
```

For **mutating** operations (`upsertDemandTarget`, `upsertOnboardingProgress`), this means an unauthenticated request reaches the proxy. If the proxy does not strictly validate the presence of the Authorization header, the mutation proceeds without identity verification.

### Fix

```typescript
const handleSecureFetch = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const token = await getSessionToken('supabase');

  // For all secure-proxy calls, authentication is mandatory.
  // If no token is available the user is signed out; surface an error
  // rather than silently sending an unauthenticated request.
  if (!token) {
    throw new Error('Authentication required: no active session token available.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetchWithTimeout(
    SECURE_PROXY_URL,
    { method: 'POST', headers, body: JSON.stringify(payload) },
    15_000,
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error?.error ?? `Secure proxy responded with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};
```

---

## Finding 5: Environment Variable for Proxy URL Used Without Validation

**Severity: Medium**
**Files: `demandForecast.ts`, `onboardingProgress.ts`**

### Root Cause
```typescript
const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';
```

The fallback `/api/secure-proxy` is a relative URL. In React Native (non-web), relative URLs are meaningless to `fetch()` — the runtime has no base URL. If `EXPO_PUBLIC_SECURE_PROXY_URL` is unset in a native build, every fetch silently fails or throws a hard-to-diagnose error. Additionally, no validation checks that the URL uses HTTPS in production, allowing a misconfiguration to send tokens over HTTP.

### Fix

```typescript
// demandForecast.ts (module-level)
const resolveProxyUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_SECURE_PROXY_URL;

  if (!url) {
    // In native builds there is no meaningful relative URL fallback.
    throw new Error(
      '[demandForecast] EXPO_PUBLIC_SECURE_PROXY_URL is not set. ' +
      'Configure it in your .env file before using forecast features.',
    );
  }

  // Enforce HTTPS in production to prevent token leakage over plaintext HTTP.
  if (
    process.env.NODE_ENV === 'production' &&
    !url.startsWith('https://')
  ) {
    throw new Error(
      `[demandForecast] EXPO_PUBLIC_SECURE_PROXY_URL must use HTTPS in production. Got: ${url}`,
    );
  }

  return url;
};

const SECURE_PROXY_URL = resolveProxyUrl();
```

---

## Finding 6: JSON Parse Error Swallowed — Error Body Lost When Response Is Not JSON

**Severity: Medium**
**Files: `demandForecast.ts`, `onboardingProgress.ts`**

### Root Cause
When the proxy returns a non-JSON error response (e.g. an HTML 502 from a gateway, or a plain-text error), the `.catch(() => ({ error: 'Unknown error' }))` silently discards the real body, making incidents very hard to diagnose:

```typescript
const error = await response.json().catch(() => ({ error: 'Unknown error' }));
throw new Error(error?.error ?? `Secure proxy responded with status ${response.status}`);
```

### Fix

```typescript
const parseErrorResponse = async (response: Response): Promise<string> => {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body = await response.json();
      return body?.error ?? body?.message ?? `HTTP ${response.status}`;
    } catch {
      // JSON parse failed despite content-type header
    }
  }

  // Capture raw text for non-JSON error bodies (HTML gateway errors, etc.)
  const text = await response.text().catch(() => '');
  const preview = text.slice(0, 200); // truncate to avoid huge log lines
  return `HTTP ${response.status}${preview ? `: ${preview}` : ''}`;
};

// In handleSecureFetch:
if (!response.ok) {
  const message = await parseErrorResponse(response);
  throw new Error(message);
}
```

---

## Finding 7: `upsertDemandTarget` Input Not Validated Before Transmission

**Severity: Medium**
**File: `demandForecast.ts`**

### Root Cause
`upsertDemandTarget` accepts a `DemandForecast` object from the caller and sends it directly to the proxy after only coercing `required` to a number. There is no validation of:
- `required` being a finite, non-negative number (e.g. `NaN`, `Infinity`, `-1` are all passed through)
- `date` being a valid ISO date string
- `role` being non-empty
- `confidence`, `lowerBound`, `upperBound` being in sensible ranges

```typescript
// CURRENT — only coerces, does not validate
const normalized = { ...target, required: Number(target.required), source: target.source ?? 'override' };
```

`Number(undefined)` → `NaN`, `Number("drop table")` → `NaN`, both silently sent.

### Fix

```typescript
class ValidationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid field "${field}": ${reason}`);
    this.name = 'ValidationError';
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROLE_LENGTH = 100;

const validateDemandForecast = (target: DemandForecast): void => {
  if (!target.date || !ISO_DATE_RE.test(target.date)) {
    throw new ValidationError('date', 'must be a valid ISO date string (YYYY-MM-DD)');
  }

  if (!target.role || typeof target.role !== 'string' || target.role.trim().length === 0) {
    throw new ValidationError('role', 'must be a non-empty string');
  }

  if (target.role.length > MAX_ROLE_LENGTH) {
    throw new ValidationError('role', `must not exceed ${MAX_ROLE_LENGTH} characters`);
  }

  const required = Number(target.required);
  if (!Number.isFinite(required) || required < 0) {
    throw new ValidationError('required', 'must be a finite non-negative number');
  }

  if (target.confidence !== undefined) {
    if (!Number.isFinite(target.confidence) || target.confidence < 0 || target.confidence > 1) {
      throw new ValidationError('confidence', 'must be a number between 0 and 1');
    }
  }

  if (target.source !== undefined && target.source !== 'model' && target.source !== 'override') {
    throw new ValidationError('source', 'must be "model" or "override"');
  }
};

export const upsertDemandTarget = async (target: DemandForecast): Promise<UpsertDemandTargetResult> => {
  let normalized: DemandForecast;
  try {
    validateDemandForecast(target);
    normalized = {
      ...target,
      date: target.date.trim(),
      role: target.role.trim(),
      required: Number(target.required),
      source: target.source ?? 'override',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid forecast target';
    return { success: false, target, error: message };
  }

  try {
    const result = await handleSecureFetch<{ success: boolean; targets: DemandForecast[]; error?: string }>({
      action: 'upsertTargets',
      targets: [normalized],
    });

    if (!result.success) {
      return { success: false, target: normalized, error: result.error ?? 'Unable to save override' };
    }

    return { success: true, target: normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save override';
    return { success: false, target: normalized, error: message };
  }
};
```

---

## Finding 8: Token Provider Race Condition — `getSessionToken` Called Before `setTokenProvider`

**Severity: Medium**
**File: `authToken.ts`**

### Root Cause
`tokenProvider` is a module-level nullable variable set by `setTokenProvider`, which must be called from a React component after Clerk initialises. Any service function called during app startup (before the root component mounts and calls `setTokenProvider`) silently returns `null`. In `handleSecureFetch`, prior to the fix in Finding 4, this caused a silent auth downgrade. After that fix it throws — but the race is still a source of intermittent errors when services are eagerly called.

There is also no protection against `setTokenProvider` being called multiple times with different functions, which could cause subtle token mismatches if a component tree remounts.

```typescript
// CURRENT — no initialisation guard, no duplicate-call protection
let tokenProvider: ((options?: GetTokenOptions) => Promise<string | null>) | null = null;

export function setTokenProvider(fn: ...): void {
  tokenProvider = fn;  // ← overwrites silently on remount
}
```

### Fix

```typescript
// authToken.ts
let tokenProvider: ((options?: GetTokenOptions) => Promise<string | null>) | null = null;
let providerSetCount = 0;

export function setTokenProvider(fn: (options?: GetTokenOptions) => Promise<string | null>): void {
  if (providerSetCount > 0) {
    // Warn in development if a new provider reference is being registered —
    // this typically indicates a component remount or hot-reload; it is
    // generally safe but worth surfacing during development.
    if (__DEV__) {
      console.warn(
        '[authToken] setTokenProvider called more than once. ' +
        'This is expected during hot-reload but may indicate a component lifecycle issue.',
      );
    }
  }

  tokenProvider = fn;
  providerSetCount += 1;
}

/**
 * Returns true when the token provider has been registered.
 * Use this to guard eager service calls during app initialisation.
 */
export function isTokenProviderReady(): boolean {
  return tokenProvider !== null;
}

export async function getSessionToken(template?: string): Promise<string | null> {
  if (!AUTH_ENABLED) return null;

  if (tokenProvider === null) {
    if (__DEV__) {
      console.warn(
        '[authToken] getSessionToken called before setTokenProvider. ' +
        'Ensure setTokenProvider is called at app root before any service invocation.',
      );
    }
    return null;
  }

  return tokenProvider(template ? { template } : undefined);
}
```

---

## Finding 9: `any` Type Escape Hatches Bypass Type Safety in Query Builder

**Severity: Medium**
**File: `onboardingProgress.ts`**

### Root Cause
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

const applyUserFilter = (
  query: AnyQuery,      // ← complete type erasure
  userId?: string | null
) => {
```

Typing the Supabase query as `any` means:
- The compiler cannot catch mismatched column names (e.g. `eq('user_idd', ...)` compiles fine)
- Return type of `applyUserFilter` is inferred as `any`, spreading unsafety to all callers
- The eslint suppression comment indicates this was a deliberate workaround, not an intentional design

### Fix

Use the Supabase `PostgrestFilterBuilder` type directly:

```typescript
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

type OnboardingQueryBuilder = PostgrestFilterBuilder<
  any,          // Schema — replace with Database['public'] once Database type is generated
  OnboardingRow,
  OnboardingRow[]
>;

const applyUserFilter = (
  query: OnboardingQueryBuilder,
  userId?: string | null,
): OnboardingQueryBuilder => {
  if (userId) {
    return query.eq('user_id', userId);
  }
  return query.is('user_id', null);
};
```

Or, if the Database generic type is available:

```typescript
import type { Database } from '@/types/supabase';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

type Schema = Database['public'];
type OnboardingQueryBuilder = PostgrestFilterBuilder<
  Schema,
  Schema['Tables']['onboarding_progress']['Row'],
  Schema['Tables']['onboarding_progress']['Row'][]
>;
```

---

## Finding 10: Supabase Anon Key Exposed in Client Bundle — Expected but Should Be Documented

**Severity: Low / Informational**
**File: `supabaseClient.ts`**

### Root Cause
`EXPO_PUBLIC_SUPABASE_ANON_KEY` is deliberately public (hence the `EXPO_PUBLIC_` prefix, which Expo bakes into the JS bundle at build time). However, there is no explicit comment in the code stating that the **service-role key must never appear** here, and no runtime assertion guards against a misconfiguration where a developer accidentally uses the wrong key.

```typescript
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
```

If someone accidentally sets `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the service-role key in `.env`, the service-role key would be baked into the app binary and distributed to all users — granting full RLS bypass to anyone who extracts it.

### Fix

```typescript
const resolveCredentials = (): SupabaseCredentials | null => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  // SECURITY: Detect if a service-role key has been accidentally set as the
  // anon key. Service-role keys are base64url JWT tokens with a specific
  // payload; anon keys are also JWTs but have role: 'anon'.
  // This is a best-effort check — the definitive guard is CI secret scanning.
  if (__DEV__ && supabaseAnonKey.length > 200) {
    // Both key types are JWTs; check the decoded role claim.
    try {
      const [, payloadB64] = supabaseAnonKey.split('.');
      const payload = JSON.parse(atob(payloadB64));
      if (payload?.role === 'service_role') {
        throw new Error(
          '[supabaseClient] CRITICAL: EXPO_PUBLIC_SUPABASE_ANON_KEY contains ' +
          'a service-role key. This key grants full RLS bypass and must NEVER ' +
          'be used client-side. Replace it with the anon key immediately.',
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('CRITICAL')) throw e;
      // Ignore parse errors — key format is opaque, best-effort only.
    }
  }

  return { url: supabaseUrl, anonKey: supabaseAnonKey };
};
```

---

## Finding 11: `loadDemandTargets` — Client-Side Filter After Remote Fetch

**Severity: Low**
**File: `demandForecast.ts`**

### Root Cause
```typescript
return (result.targets ?? []).filter((target) => target.source === 'override');
```

The client fetches all targets