# Horario — Compliance Audit Report

**Date:** 2026-04-02  
**Scope:** Vercel deployment, Clerk auth, Supabase RLS  
**Auditor:** Automated differential analysis  
**Baseline files:**
- `app/api/secure-proxy+api.ts` (lines 1–200 shown)
- `services/authToken.ts`
- `services/demandForecast.ts`

---

## Executive Summary

| Area | Findings | Critical | High | Medium | Low |
|------|----------|----------|------|--------|-----|
| Vercel | 6 | 1 | 2 | 2 | 1 |
| Clerk | 7 | 1 | 3 | 2 | 1 |
| Supabase | 8 | 2 | 3 | 2 | 1 |
| **Total** | **21** | **4** | **8** | **6** | **3** |

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| 🔴 CRITICAL | Exploitable now; data breach or auth bypass possible |
| 🟠 HIGH | Significant risk; must fix before production |
| 🟡 MEDIUM | Degrades security posture; fix in next sprint |
| 🟢 LOW | Best-practice gap; fix when convenient |

---

## Section 1 — Vercel

### Findings Table

| # | Area | Finding | Severity | Status | Action |
|---|------|---------|----------|--------|--------|
| V1 | Env var exposure | `EXPO_PUBLIC_SUPABASE_URL` is referenced in the proxy at line 12 (`process.env.EXPO_PUBLIC_SUPABASE_URL`). The `EXPO_PUBLIC_` prefix causes Expo to bundle this value into the client-side JS bundle at build time. While the URL alone is not secret, combining it with any accidentally exposed key creates a full attack surface. More importantly, the naming convention signals to future developers that it is safe to use on the client, increasing the risk that `serviceRoleKey` logic is accidentally moved client-side. | 🟠 HIGH | Open | Rename to `SUPABASE_URL` (no `EXPO_PUBLIC_` prefix) inside the proxy. Keep a separate `EXPO_PUBLIC_SUPABASE_URL` only if the Supabase JS client is also used on the client side with the anon key. |
| V2 | Service-role key fallback | Line 13: `process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY`. Two different env var names are accepted as fallbacks. If the primary var is missing Vercel will silently fall back, meaning misconfigured deployments succeed with an unexpected key rather than failing fast. | 🟡 MEDIUM | Open | Remove the fallback alias. Accept only `SUPABASE_SERVICE_ROLE_KEY`. Add a startup assertion that throws if the value is absent. |
| V3 | No CORS headers | The proxy route (`+api.ts`) does not set `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, or `Access-Control-Allow-Headers`. Expo web and any future web client will be blocked by browser CORS preflight, and no explicit origin allowlist prevents cross-origin abuse. | 🟠 HIGH | Open | Add a CORS handler at the top of the route that (a) responds to `OPTIONS` preflight with explicit allowed origins from an env var allowlist, and (b) rejects origins not in the allowlist with 403. |
| V4 | Edge runtime not declared | The file uses Node.js built-ins (`crypto.createPublicKey`, `crypto.createVerify`, `Buffer`). These are unavailable in the Vercel Edge Runtime. No `export const runtime = 'nodejs'` declaration is present, so Vercel may auto-select Edge on some configurations, causing silent 500 errors. | 🟡 MEDIUM | Open | Add `export const runtime = 'nodejs';` at the top of `secure-proxy+api.ts`. Document why Edge is not suitable for this route. |
| V5 | No request size limit | The proxy accepts arbitrary POST bodies. An attacker could send a multi-MB payload to exhaust serverless function memory or trigger timeout-based DoS. | 🟢 LOW | Open | Add a body-size guard: read `Content-Length` header and reject with 413 if it exceeds a configured threshold (e.g. 64 KB for normal operations, 5 MB if POS CSV upload is supported). |
| V6 | FORECAST_API_URL not validated | Line 11: `const FORECAST_API_URL = process.env.EXPO_PUBLIC_FORECAST_API_URL`. The `EXPO_PUBLIC_` prefix again embeds this URL in the client bundle. More critically, the URL is consumed server-side in the proxy without any allowlist validation, meaning a compromised env var could redirect forecast calls to an attacker-controlled endpoint (SSRF). | 🔴 CRITICAL | Open | (a) Rename to `FORECAST_API_URL` (no `EXPO_PUBLIC_` prefix) in the proxy. (b) Validate the URL at startup against an expected hostname prefix. (c) Expose only a boolean `EXPO_PUBLIC_FORECAST_ENABLED` to the client bundle. |

### Detailed Notes — Vercel

**V1 — `EXPO_PUBLIC_SUPABASE_URL` in server-only file**

// secure-proxy+api.ts line 12
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
Expo's Metro bundler performs a compile-time text substitution of all
`process.env.EXPO_PUBLIC_*` references. When the proxy is built as a Vercel
function the substitution still occurs, meaning the literal URL value is
compiled into the function bundle. This is harmless for the URL but establishes
a dangerous pattern.

**V3 — Missing CORS**

Recommended handler pattern (to be added to the proxy):

```typescript
export const runtime = 'nodejs'; // V4 fix also applied here

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
```

---

## Section 2 — Clerk

### Findings Table

| # | Area | Finding | Severity | Status | Action |
|---|------|---------|----------|--------|--------|
| C1 | `AUTH_ENABLED` dev bypass is permanent | `secure-proxy+api.ts` line ~57: when `AUTH_ENABLED` is false, `getAuthorizedAccountId` returns `null`. All downstream proxy actions must then decide whether `null` means "unauthenticated — reject" or "dev mode — allow". If any action accepts `null` userId without rejecting, unauthenticated production requests succeed if the Clerk key is ever missing from env. | 🔴 CRITICAL | Open | Change `getAuthorizedAccountId` to return a discriminated union `{ userId: string } \| { bypass: true } \| null`. Actions must explicitly handle the bypass case and reject in production. Add `NODE_ENV === 'production'` guard: if production and `!AUTH_ENABLED`, throw immediately. |
| C2 | JWKS fetched without timeout | `fetchJwks()` calls `fetch(CLERK_JWKS_URL!)` with no timeout. A slow or unresponsive Clerk JWKS endpoint causes the serverless function to hang until the platform's 30 s timeout, resulting in a DoS-like condition for all authenticated requests. | 🟠 HIGH | Open | Wrap the fetch in an `AbortController` with a 5-second timeout. Serve the stale cache if the refresh fails and the cache is not yet expired. |
| C3 | JWKS cache is module-level (not distributed) | `jwksCache` / `jwksCacheExpiry` are module-level variables (lines ~18–19). Each Vercel serverless invocation may be a cold-start with an empty cache, or a warm instance with a stale cache from a previous invocation. There is no distributed cache (e.g. KV or Edge Config), so key rotation may take up to 5 min × N instances to propagate. | 🟡 MEDIUM | Open | Accept the trade-off for now but document it. For key-rotation events, add an environment variable `CLERK_JWKS_CACHE_TTL_SECONDS` to allow operators to reduce TTL to 60 s. |
| C4 | `alg` field not validated | `verifyClerkToken` (line ~43) reads `header.alg` but never validates it against an allowlist. An attacker who can influence the JWK or token header could specify `alg: "none"` or a symmetric algorithm, potentially bypassing signature verification depending on Node.js `crypto` behaviour. | 🟠 HIGH | Open | Add `if (header.alg && header.alg !== 'RS256') return null;` before the verify call. Only RS256 is supported by Clerk. |
| C5 | `nbf` (not-before) claim not checked | The JWT payload check (line ~44) validates `exp` but does not validate `nbf`. A replayed token with a future `nbf` would be accepted. | 🟡 MEDIUM | Open | Add: `if (payload.nbf && Date.now() / 1000 < payload.nbf) return null;` |
| C6 | `iss` and `aud` claims not validated | Industry-standard JWT validation (RFC 7519) requires validating `iss` (issuer) and `aud` (audience). Neither is checked. A token issued by a different Clerk instance (e.g. a staging tenant) would be accepted in production. | 🟠 HIGH | Open | Validate `payload.iss` against `process.env.CLERK_ISSUER_URL`. Validate `payload.azp` (Clerk's authorized party) against the expected frontend origin. |
| C7 | `tokenProvider` never cleaned up | `services/authToken.ts` — `setTokenProvider` stores a reference to `useAuth().getToken`. If the component that calls `setTokenProvider` unmounts (e.g. during sign-out and re-mount), the old provider reference is retained and may return a token for the previous session until `setTokenProvider` is called again. | 🟢 LOW | Open | Export `clearTokenProvider(): void` that sets `tokenProvider = null`. Call it during sign-out lifecycle (e.g. Clerk's `<SignOutButton>` `onPress`). |

### Detailed Notes — Clerk

**C1 — Production auth bypass**

```typescript
// Current — insecure pattern in proxy actions:
const userId = await getAuthorizedAccountId(request);
// If !AUTH_ENABLED, userId is null.
// If the action does not check userId, it proceeds unauthenticated.

// Required — explicit production guard:
if (process.env.NODE_ENV === 'production' && !AUTH_ENABLED) {
  return new Response(JSON.stringify({ error: 'Auth misconfigured' }), { status: 500 });
}
```

**C4 — Algorithm confusion**

```typescript
// Add immediately after header parsing:
const ALLOWED_ALGORITHMS = ['RS256'];
if (header.alg && !ALLOWED_ALGORITHMS.includes(header.alg)) {
  return null;
}
```

**C6 — Issuer validation**

```typescript
// Add after exp/nbf checks:
const expectedIssuer = process.env.CLERK_ISSUER_URL; // e.g. https://clerk.your-domain.com
if (expectedIssuer && payload.iss !== expectedIssuer) return null;
```

---

## Section 3 — Supabase

### Findings Table

| # | Area | Finding | Severity | Status | Action |
|---|------|---------|----------|--------|--------|
| S1 | Service-role client created per-request | `getServiceClient()` is called inside request handlers, creating a new `SupabaseClient` on every invocation. Each client opens a new connection pool. Under load this exhausts Supabase's connection limit (default 60 for free tier, 200 for pro). | 🔴 CRITICAL | Open | Hoist the client to module scope with lazy initialisation (create once, reuse). Guard with `if (!_client) _client = createClient(...)`. |
| S2 | No RLS policies documented or verified | The audit found no migration files asserting RLS is enabled on `shifts`, `demand_targets`, `external_signals`, or `pos_sales`. The proxy uses the service-role key (bypasses RLS), which is correct for server-side operations, but if the anon key is ever used client-side against these tables the absence of RLS means full table access. | 🔴 CRITICAL | Open | Add a migration that explicitly enables RLS on all tables and defines at minimum a deny-all policy for the anon role. Verify with `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`. |
| S3 | Query builder mutations not chained correctly | `fetchHistoricalShifts` lines ~105–108: conditional filters are applied as side-effecting calls on `query` without re-assignment (`query.gte(...).lte(...)` returns a new builder but `query` is not reassigned). The filters are silently dropped. Same pattern in `fetchExternalSignals` and `fetchExistingTargets`. | 🟠 HIGH | Open | Use `let query = client.from(...).select(...)` and reassign: `if (filters?.date) { query = query.gte('date', filters.date); }` |
| S4 | `limit(500)` / `limit(200)` hardcoded without pagination | All fetch helpers apply a hard limit. If the dataset exceeds the limit, silently truncated results flow into the forecast algorithm, producing incorrect demand targets without any warning. | 🟠 HIGH | Open | (a) Add a `count: 'exact'` option and log a warning if `count > limit`. (b) Implement cursor-based pagination for large datasets or increase the limit with documentation of the trade-off. |
| S5 | `upsert` uses `onConflict: 'date,role'` without schema verification | `persistForecasts` line ~185 assumes a unique constraint on `(date, role)` in `demand_targets`. If the constraint does not exist, `upsert` degrades to `insert`, creating duplicates. | 🟠 HIGH | Open | Add a migration assertion: `ALTER TABLE demand_targets ADD CONSTRAINT demand_targets_date_role_key UNIQUE (date, role);` if it does not already exist. |
| S6 | Errors are `console.warn` only — no structured error propagation | All Supabase error paths (lines ~115, ~135, ~155, ~185) log a warning and return empty arrays or silently continue. The calling action returns a 200 OK with empty/partial data. Callers cannot distinguish a database error from genuinely empty results. | 🟡 MEDIUM | Open | Propagate errors as thrown exceptions or return a typed `{ data, error }` result. Let the HTTP handler translate database errors to 500/503 status codes. |
| S7 | No query timeout configured | `createClient` does not set a `db.schema` or request timeout. A slow query blocks the serverless function thread for the full platform timeout (30 s on Vercel). | 🟡 MEDIUM | Open | Add `global.fetch` wrapper with `AbortController` timeout, or use the `options.db.schema` and PostgREST `Prefer: respond-async` header for long-running queries. For now, add `statement_timeout` via a `rpc('set_config', ...)` call or configure it at the Supabase project level. |
| S8 | `pos_sales` table has no proxy actions | Migration 5 created `pos_sales` but the proxy has no `uploadPosSales` or `listPosSales` actions. Any direct client-side access would bypass RLS (if anon key is used) or require the service-role key on the client (catastrophic). | 🟢 LOW | Open | Implement `uploadPosSales` and `listPosSales` proxy actions before building any client-side POS UI. Block all direct client queries to `pos_sales`. |

### Detailed Notes — Supabase

**S1 — Singleton client pattern**

```typescript
// Replace getServiceClient() with:
let _serviceClient: SupabaseClient | null = null;

const getServiceClient = (): SupabaseClient => {
  if (_serviceClient) return _serviceClient;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing service-role Supabase credentials');
  }
  _serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'horario-proxy' } },
  });
  return _serviceClient;
};
```

**S3 — Query builder reassignment**

```typescript
// BEFORE (broken — filters silently dropped):
const query = client.from('shifts').select('date, role, worker_id, hours')
  .order('date', { ascending: true }).limit(500);
if (filters?.date) {
  query.gte('date', filters.date).lte('date', filters.date); // ← not reassigned
}

// AFTER (correct):
let query = client.from('shifts').select('date, role, worker_id, hours')
  .order('date', { ascending: true }).limit(500);
if (filters?.date) {
  query = query.gte('date', filters.date).lte('date', filters.date);
}
if (filters?.role) {
  query = query.eq('role', filters.role);
}
```

**S2 — Minimum RLS migration template**

```sql
-- Enable RLS on all public tables
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;

-- Deny all access via anon key (service-role bypasses RLS)
CREATE POLICY "deny_anon_shifts"
  ON public.shifts FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_demand_targets"
  ON public.demand_targets FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_external_signals"
  ON public.external_signals FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_pos_sales"
  ON public.pos_sales FOR ALL TO anon USING (false);
```

---

## Prioritised Remediation Roadmap

| Priority | ID | Description | Effort |
|----------|----|-------------|--------|
| 1 | V6 | SSRF via unvalidated `FORECAST_API_URL` | 1 h |
| 2 | C1 | Auth bypass in production when Clerk key missing | 2 h |
| 3 | S1 | Supabase client created per-request (connection exhaustion) | 1 h |
| 4 | S2 | RLS not enforced on public tables | 2 h |
| 5 | C4 | JWT algorithm not validated (algorithm confusion) | 30 min |
| 6 | C6 | `iss`/`aud` JWT claims not validated | 1 h |
| 7 | S3 | Query builder filters silently dropped | 1 h |
| 8 | S4 | Hard-coded query limits without overflow warning | 2 h |
| 9 | V3 | No CORS headers on proxy route | 1 h |
| 10 | V4 | Node.js runtime not declared for proxy | 15 min |
| 11 | C2 | JWKS fetch has no timeout | 1 h |
| 12 | S5 | `upsert` unique constraint not guaranteed | 30 min |
| 13 | C5 | `nbf` claim not validated | 15 min |
| 14 | S6 | Supabase errors swallowed silently | 2 h |
| 15 | V1 | `EXPO_PUBLIC_` prefix on server-only env vars | 1 h |
| 16 | V2 | Dual fallback service-role key names | 30 min |
| 17 | S7 | No query timeout | 2 h |
| 18 | C3 | Module-level JWKS cache not distributed | 1 h |
| 19 | C7 | `tokenProvider` not cleared on sign-out | 30 min |
| 20 | S8 | `pos_sales` proxy actions missing | 3 h |
| 21 | V5 | No request body size limit | 1 h |

**Total estimated remediation effort: ~26 hours**

---

## Appendix A — Environment Variable Inventory

| Variable | Location | Exposure | Required |
|----------|----------|----------|----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Client + Server | Public (bundle) | Yes — but see V1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Secret | Yes |
| `SUPABASE_SERVICE_KEY` | Server only | Secret | Remove (V2) |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client + Server | Public (bundle) | Yes |
| `CLERK_JWKS_URL` | Server only | Internal | Yes |
| `CLERK_ISSUER_URL` | Server only | Internal | Add (C6) |
| `EXPO_PUBLIC_FORECAST_API_URL` | Client + Server | Public (bundle) | Rename (V6) |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Client | Public (bundle) | Yes |
| `ALLOWED_ORIGINS` | Server only | Internal | Add (V3) |
| `NODE_ENV` | Runtime | Internal | Yes |