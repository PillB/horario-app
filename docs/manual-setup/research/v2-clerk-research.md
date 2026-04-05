# Clerk — Research Findings (v2)

I'll run all 5 searches simultaneously.
Now let me fetch the most relevant pages for deeper detail.
Now I have enough data. Let me compile the research summary.
Now I have comprehensive research. Let me write the summary.

---

## Findings

- **Supabase JWT template is deprecated (April 1, 2025).** 
Clerk's official Supabase guide now instructs you to set up Clerk as a native Supabase "third-party auth provider" instead of creating a JWT template. The guide uses `getToken()` (no template parameter) with the new `accessToken` callback pattern on `createClient`.
 The existing manual's Step 1 creates a `horario` JWT template for subscription claims — this is a custom template for a custom purpose, which is still valid. But the **Supabase-specific** JWT template (`supabase`) is no longer recommended.
  - Source: https://clerk.com/docs/guides/development/integrations/databases/supabase

- **Native Supabase integration replaces shared JWT secret.** 
Supabase deprecated the old Clerk integration pattern as of April 1, 2025, citing security issues with sharing your JWT secret and the latency of generating a new JWT. The new pattern uses Clerk's domain registered as a third-party auth provider in Supabase.

  - Source: https://supabase.com/docs/guides/auth/third-party/clerk

- **New `accessToken` callback pattern for Supabase client.** 
Supabase now expects `accessToken: async () => session?.getToken() ?? null` passed directly to `createClient()`, rather than setting `Authorization` headers manually.
 Supabase docs use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not `SUPABASE_ANON_KEY`) in examples.
  - Source: https://supabase.com/docs/guides/auth/third-party/clerk

- **Session Token V2: org claims restructured under `o` object.** 
V2 nests organization claims under a compact `o` claim with abbreviated keys: `id`, `slg`, `rol`, `per`, `fpm`. V1 used flat top-level claims like `org_id`, `org_role`, `org_slug`, `org_permissions`.
 RLS policies must handle both if you're mid-migration. Supabase's own example shows a `coalesce` pattern:
  ```sql
  coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')
  ```
  - Source: https://clerk.com/docs/guides/sessions/session-tokens, https://supabase.com/docs/guides/auth/third-party/clerk

- **`@clerk/expo` v3 = Core 3 (major breaking change, requires Expo SDK 53+).** 
Core 3 replaces `setActive()` with `signIn.finalize()`, `signIn.attemptFirstFactor()` with `signIn.password()`, and introduces a new Signal API.
 Three new native components (`AuthView`, `UserButton`, `UserProfileView`) are available from `@clerk/expo/native`. Three new hooks: `useUserProfileModal()`, `useNativeSession()`, `useNativeAuthEvents()`.
  - Source: https://clerk.com/changelog/2026-03-09-expo-native-components

- **`tokenCache` import changed.** 
The current Expo quickstart imports `tokenCache` from `@clerk/expo/token-cache` (not from a custom SecureStore adapter). The `ClerkProvider` now takes `tokenCache={tokenCache}` as a prop.

  - Source: https://clerk.com/docs/expo/getting-started/quickstart

- **Supabase Realtime + Clerk third-party auth: `exp` claim bug.** 
A reported bug (issue #1390) shows `InvalidJWTToken: Invalid value for JWT claim "exp"` when using Realtime with Clerk's new third-party auth integration. Regular DB calls work; only Realtime subscriptions fail.
 Closed as stale/not planned.
  - Source: https://github.com/supabase/supabase-js/issues/1390

- **`supabase-js` v2.x crashes React Native (Expo) due to `ws` module import.** 
Even with `realtime: false`, the `ws` Node.js module is imported at bundle time, crashing iOS/Android. This blocks all Supabase usage in React Native.

  - Source: https://github.com/supabase/supabase-js/issues/1434

- **Supabase Edge Functions don't validate Clerk RS256 JWTs.** 
Edge Functions using the new third-party auth integration fail JWT verification because Supabase doesn't verify against the Clerk JWKS endpoint. The official workaround is to use `--no-verify-jwt` locally and use a custom JWT validation function in production.

  - Source: https://github.com/orgs/supabase/discussions/34988

- **Svix webhook verification requires raw string body.** 
The payload must be passed as a raw string, not parsed JSON. Express users must use `bodyParser.raw({ type: 'application/json' })` and must NOT apply `express.json()` middleware to the webhook route.
 Next.js Pages Router needs `export const config = { api: { bodyParser: false } }` with the `micro` `buffer()` helper. Next.js App Router can use `await req.text()` directly.
  - Source: https://docs.svix.com/receiving/verifying-payloads/how

- **Svix + Express: `Expected payload to be of type string` error.** 
A common issue when using `bodyParser.raw()` — the result is a Buffer, not a string. You may need `.toString()` on the body before passing to `wh.verify()`.

  - Source: https://github.com/svix/svix-webhooks/issues/1463

---

## New Gotchas (not in existing manual)

1. **Supabase `PUBLISHABLE_KEY` vs `ANON_KEY`:** Supabase docs now reference `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the Clerk integration examples. If your existing setup uses `SUPABASE_ANON_KEY`, check whether this is a rename or a different key type.

2. **Supabase Realtime is broken with Clerk third-party auth** — the `exp` claim causes `InvalidJWTToken` errors on Realtime channels. If Horario uses Supabase Realtime, this is a blocker. No official fix yet.

3. **`supabase-js` v2.x crashes Expo/React Native** due to a hard `ws` import even when Realtime is disabled. Workarounds are fragile (Metro config hacks). This may affect the Expo + Supabase client setup.

4. **Supabase Edge Functions cannot validate Clerk JWTs** out of the box with the new third-party integration. Must use `--no-verify-jwt` or implement custom JWT validation using the Clerk JWKS endpoint.

5. **Core 3 / `@clerk/expo` v3 breaking changes:** `setActive()` → `signIn.finalize()`, `attemptFirstFactor()` → `signIn.password()`. Error handling patterns changed. Any custom sign-in/sign-up flows in the manual need updating.

6. **V2 org claim RLS patterns need `coalesce()`:** If you write RLS policies for org data, you need to handle both V1 flat claims (`org_id`, `org_role`) and V2 nested claims (`o->>'id'`, `o->>'rol'`) during migration using `coalesce()`.

7. **Svix `wh.verify()` needs `.toString()` on Express `bodyParser.raw()` result:** The raw body is a Buffer, not a string, causing "Expected payload to be of type string" errors. The existing manual should note this if the webhook endpoint uses Express-style middleware.

---

## Outdated Steps (needs update)

1. **Step 1 (JWT Template for Supabase):** The manual's approach of creating a custom `horario` JWT template is still valid for custom claims (subscription tier), BUT the Supabase-specific JWT template pattern is deprecated. If the manual also instructs using `getToken({ template: 'supabase' })` for Supabase RLS anywhere, that must be replaced with the native third-party auth integration using plain `getToken()` + the `accessToken` callback.

2. **`ClerkProvider` setup:** If the manual uses a custom `SecureStore` token cache adapter, it should be updated to use `import { tokenCache } from '@clerk/expo/token-cache'` which is the new built-in approach in `@clerk/expo` v3.

3. **`setActive()` pattern:** Any sign-in/sign-up flow code using `setActive({ session: signIn.createdSessionId })` is Core 2 syntax. Core 3 (`@clerk/expo` v3) requires `signIn.finalize({ navigate: ... })`.

4. **V2 Session Token claims table:** The manual's symptom table mentions `org_*` claims missing — this should be expanded to document the specific V1→V2 mapping (`org_id` → `o.id`, `org_role` → `o.rol`, `org_slug` → `o.slg`, `org_permissions` → `o.per`).

5. **Supabase client initialization:** If the manual uses the `global.headers.Authorization = Bearer ${token}` pattern, this is outdated. The new pattern is `accessToken: async () => session?.getToken() ?? null` on the `createClient` options.

---

## Key URLs

| Resource | URL |
|---|---|
| Clerk Supabase integration guide (current) | https://clerk.com/docs/guides/development/integrations/databases/supabase |
| Supabase third-party auth Clerk docs | https://supabase.com/docs/guides/auth/third-party/clerk |
| Session Token V2 changelog | https://clerk.com/changelog/2025-04-14-session-token-jwt-v2 |
| Session token claims reference (V1/V2) | https://clerk.com/docs/guides/sessions/session-tokens |
| `@clerk/expo` v3 / Core 3 changelog | https://clerk.com/changelog/2026-03-09-expo-native-components |
| Expo quickstart (current) | https://clerk.com/docs/expo/getting-started/quickstart |
| Svix webhook verification docs | https://docs.svix.com/receiving/verifying-payloads/how |
| Clerk webhooks overview | https://clerk.com/docs/guides/development/webhooks/overview |
| **BUG:** Realtime + Clerk `exp` claim | https://github.com/supabase/supabase-js/issues/1390 |
| **BUG:** `supabase-js` `ws` crash on Expo | https://github.com/supabase/supabase-js/issues/1434 |
| **BUG:** Edge Functions + Clerk JWT | https://github.com/orgs/supabase/discussions/34988 |
| **BUG:** DB migration breaks Clerk auth | https://github.com/supabase/supabase/issues/38285 |
| Svix + Express raw body issue | https://github.com/svix/svix-webhooks/issues/1463 |