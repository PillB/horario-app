# MCP Compliance Manual — Horario App

> Step-by-step verification and setup guide for **Vercel MCP**, **Supabase MCP**, and **Clerk MCP** integrations.
> Each section lists what to verify, how to verify it, and any remediation steps needed.

---

## Table of Contents

1. [Clerk MCP — JWT Template Setup](#1-clerk-mcp--jwt-template-setup)
2. [Supabase MCP — JWT Secret & RLS](#2-supabase-mcp--jwt-secret--rls)
3. [Vercel MCP — Environment Variables & Functions](#3-vercel-mcp--environment-variables--functions)
4. [CORS Compliance Verification](#4-cors-compliance-verification)
5. [End-to-End Auth Flow Smoke Test](#5-end-to-end-auth-flow-smoke-test)

---

## 1. Clerk MCP — JWT Template Setup

Clerk issues JWTs for session authentication. Supabase validates those JWTs using a shared secret. The Clerk **JWT Template** named `supabase` is the bridge.

### 1.1 Create the "supabase" JWT Template

1. Log in to the [Clerk Dashboard](https://dashboard.clerk.com).
2. Navigate to your application → **JWT Templates** (left sidebar).
3. Click **New template** → choose **Supabase**.
4. Configure the template:
   - **Name:** `supabase` (must match exactly — `getToken({ template: 'supabase' })` in the app)
   - **Token lifetime:** `60` seconds (default; Supabase refreshes on every request)
   - **Claims** (verify these are present):
     ```json
     {
       "role": "authenticated",
       "aud": "authenticated"
     }
     ```
   - Clerk automatically adds `sub` (user ID), `iat`, `exp`, and any metadata you configure.
5. Copy the **Signing Key** shown at the bottom — you will paste it into Supabase in the next section.
6. Click **Save**.

> **Reference:** [Clerk Supabase JWT Template docs](https://clerk.com/docs/integrations/databases/supabase)

### 1.2 Verify EXPO_PUBLIC_CLERK_FRONTEND_API

The `UpgradeBanner` component derives the billing URL from this variable. Without it the URL falls back to `https://clerk.horario.app/user/billing`.

1. In the Clerk Dashboard → **API Keys** → copy the **Frontend API URL** (format: `https://YOUR-INSTANCE.clerk.accounts.dev`).
2. Add it to your Vercel project environment variables (see Section 3) and your local `.env.local`:
   ```
   EXPO_PUBLIC_CLERK_FRONTEND_API=https://YOUR-INSTANCE.clerk.accounts.dev
   ```

### 1.3 Verify CLERK_JWKS_URL

Used by `app/api/referrals+api.ts` to verify Clerk-issued JWTs server-side.

```bash
# Should return a JSON object with a "keys" array
curl https://YOUR-INSTANCE.clerk.accounts.dev/.well-known/jwks.json | jq .
```

Set in your environment:
```
CLERK_JWKS_URL=https://YOUR-INSTANCE.clerk.accounts.dev/.well-known/jwks.json
```

### 1.4 Checklist

- [ ] JWT Template named `supabase` created in Clerk Dashboard
- [ ] Template includes `"role": "authenticated"` and `"aud": "authenticated"` claims
- [ ] Signing Key copied (ready for Supabase, Section 2.1)
- [ ] `EXPO_PUBLIC_CLERK_FRONTEND_API` set in Vercel + `.env.local`
- [ ] `CLERK_JWKS_URL` set in Vercel + `.env.local`

---

## 2. Supabase MCP — JWT Secret & RLS

Supabase validates Clerk JWTs using the JWT secret from the Clerk template. RLS policies scope data to the authenticated user's account.

### 2.1 Set the JWT Secret in Supabase

1. In the [Supabase Dashboard](https://supabase.com/dashboard), open your project.
2. Navigate to **Settings → API → JWT Settings**.
3. Replace the value in the **JWT Secret** field with the signing key you copied from the Clerk template (Section 1.1, step 5).
4. Click **Save**.

> **Why:** PostgREST uses this secret to validate `Authorization: Bearer <clerk-jwt>` headers. If the secret doesn't match Clerk's signing key, all authenticated queries fail with `401 invalid_jwt`.

> **Reference:** [Supabase + Clerk docs](https://supabase.com/docs/guides/auth/third-party/clerk)

### 2.2 Verify the `private.jwt_account_id()` Helper Function

This function is used by RLS policies to extract `account_id` from the Clerk JWT.

```sql
-- Run in Supabase SQL Editor
SELECT private.jwt_account_id();
-- When called with a valid Clerk JWT in the Authorization header, returns the account_id claim.
-- Returns NULL when no JWT is present (anon access).
```

If the function does not exist, create it:

```sql
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.jwt_account_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'account_id',
    ''
  );
$$;
```

> **Note:** The `account_id` claim must be added to your Clerk JWT template (Section 1.1) as:
> ```json
> { "account_id": "{{user.public_metadata.account_id}}" }
> ```
> Set `account_id` in user public metadata when provisioning users.

### 2.3 Verify RLS on All Tables

Run the following query in the Supabase SQL Editor to confirm RLS is enabled:

```sql
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All rows should show `rowsecurity = true`. If any show `false`, enable RLS:

```sql
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
```

### 2.4 Apply the onboarding_progress RLS Fix

The current `onboarding_progress` table RLS may allow users to read/write rows belonging to other accounts. Apply the migration:

```bash
# From the project root — requires Supabase CLI
npx supabase db push

# Or apply manually in the Supabase SQL Editor:
```

Contents of `supabase/migrations/20260403000001_compliance_fixes.sql` (already in repo):

```sql
-- Verify it's been applied:
SELECT * FROM supabase_migrations WHERE name LIKE '%compliance%';
```

If not applied, run the SQL from that file directly in the Supabase SQL Editor.

### 2.5 Verify the `referrals` Table Exists

The `referrals+api.ts` endpoint requires a `referrals` table. Check:

```sql
SELECT COUNT(*) FROM public.referrals LIMIT 1;
```

If the table does not exist, create it:

```sql
CREATE TABLE IF NOT EXISTS public.referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code    text NOT NULL UNIQUE,
  referrer_user_id text NOT NULL,
  referred_user_id text,
  status           text NOT NULL CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  account_id       text NOT NULL,
  channel          text NOT NULL DEFAULT 'direct',
  max_redemptions  int NOT NULL DEFAULT 5,
  redemption_count int NOT NULL DEFAULT 0,
  expires_at       timestamptz NOT NULL
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own referrals (as referrer)
CREATE POLICY "Users can view their own referrals"
  ON public.referrals FOR SELECT
  USING (referrer_user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'));

-- Service role bypasses RLS (the API route uses service role)
```

### 2.6 Checklist

- [ ] JWT Secret in Supabase set to the Clerk template signing key
- [ ] `private.jwt_account_id()` function exists and returns correct values
- [ ] RLS enabled on all `public` schema tables
- [ ] `supabase/migrations/20260403000001_compliance_fixes.sql` applied
- [ ] `referrals` table exists with RLS enabled

---

## 3. Vercel MCP — Environment Variables & Functions

### 3.1 Required Environment Variables

Log in to [Vercel Dashboard](https://vercel.com/dashboard) → your project → **Settings → Environment Variables**.

Verify all of the following are set for **Production** (and **Preview** as needed):

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_*` for production |
| `EXPO_PUBLIC_CLERK_FRONTEND_API` | `https://YOUR-INSTANCE.clerk.accounts.dev` |
| `CLERK_JWKS_URL` | `https://YOUR-INSTANCE.clerk.accounts.dev/.well-known/jwks.json` |
| `CLERK_SECRET_KEY` | `sk_live_*` — server-only, never expose to client |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT-ID.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key from Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — **never** in `EXPO_PUBLIC_*` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | `https://YOUR-DOMAIN.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_APP_ORIGIN` | `https://YOUR-DOMAIN.vercel.app` (used for CORS allowlist) |
| `EXPO_PUBLIC_ACCOUNT_ID` | Your production account UUID |

> **Critical:** `SUPABASE_SERVICE_ROLE_KEY` and `CLERK_SECRET_KEY` must **not** be in `EXPO_PUBLIC_*` variables. Vercel exposes `EXPO_PUBLIC_*` to the client bundle.

### 3.2 Verify Serverless Function Configuration

The `vercel.json` in this repo configures two API functions:

```json
"functions": {
  "app/api/secure-proxy+api.ts": {
    "runtime": "nodejs20.x",
    "maxDuration": 30,
    "memory": 512
  },
  "app/api/referrals+api.ts": {
    "runtime": "nodejs20.x",
    "maxDuration": 15,
    "memory": 256
  }
}
```

After deploying, verify both functions appear in the Vercel Dashboard → **Functions** tab.

### 3.3 Test API Route Availability

After deployment, smoke-test both endpoints:

```bash
# secure-proxy — should return 405 or 401 (not 404)
curl -X POST https://YOUR-DOMAIN.vercel.app/api/secure-proxy \
  -H "Content-Type: application/json" \
  -d '{"action":"test"}'

# referrals — should return 401 (auth required)
curl -X POST https://YOUR-DOMAIN.vercel.app/api/referrals \
  -H "Content-Type: application/json" \
  -d '{"action":"list"}'
```

A `404` response means the rewrite rule or function deployment failed. Check:
1. Vercel build logs for TypeScript errors
2. That `vercel.json` rewrites include `/api/referrals`
3. That `app/api/referrals+api.ts` has both `POST` and `OPTIONS` exports

### 3.4 Verify CORS Headers in Responses

```bash
# Replace with your actual domain and origin
curl -i -X OPTIONS https://YOUR-DOMAIN.vercel.app/api/secure-proxy \
  -H "Origin: https://YOUR-DOMAIN.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```

Expected response headers:
```
Access-Control-Allow-Origin: https://YOUR-DOMAIN.vercel.app
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Vary: Origin
```

If `Access-Control-Allow-Origin: null` or `*` appears, check that `EXPO_PUBLIC_APP_ORIGIN` is set correctly in Vercel env vars.

### 3.5 Authenticate Vercel MCP (One-Time Setup)

To use Vercel MCP tools from Claude Code for deployment inspection:

1. In Claude Code, run: the Vercel MCP authenticate tool
2. Open the OAuth URL provided in a browser
3. Authorize the Vercel OAuth app
4. Claude Code will then have access to inspect deployments, env vars, and function logs

### 3.6 Checklist

- [ ] All 10 environment variables listed in 3.1 are set in Vercel (Production)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `CLERK_SECRET_KEY` are **not** in `EXPO_PUBLIC_*` vars
- [ ] Both serverless functions appear in Vercel Dashboard → Functions
- [ ] `curl` smoke test returns non-404 for both endpoints
- [ ] CORS headers include correct `Access-Control-Allow-Origin` (not `*`)
- [ ] `EXPO_PUBLIC_APP_ORIGIN` set to production domain

---

## 4. CORS Compliance Verification

CORS is handled entirely in API code (not in `vercel.json`). Both API routes maintain an `ALLOWED_ORIGINS` set built from environment variables:

```typescript
const ALLOWED_ORIGINS = new Set([
  process.env.EXPO_PUBLIC_APP_ORIGIN,               // production domain
  process.env.EXPO_PUBLIC_SECURE_PROXY_URL
    ? new URL(process.env.EXPO_PUBLIC_SECURE_PROXY_URL).origin
    : undefined,
  'http://localhost:8081',                            // Expo dev server
  'http://localhost:3000',                            // alternative dev port
].filter(Boolean));
```

### 4.1 Verify No Wildcard CORS in vercel.json

```bash
grep -n "Access-Control-Allow-Origin" vercel.json
```

Expected: no matches. If a wildcard `*` appears in `vercel.json` CORS headers, remove it — it bypasses the per-route allowlist logic.

### 4.2 Test Cross-Origin Rejection

```bash
# Should return Access-Control-Allow-Origin: null (not a real origin)
curl -i -X OPTIONS https://YOUR-DOMAIN.vercel.app/api/secure-proxy \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST"
```

Expected: `Access-Control-Allow-Origin: null`

---

## 5. End-to-End Auth Flow Smoke Test

Once all sections above are configured, verify the full auth → API → database flow:

1. **Sign in** to the app with a Clerk account.
2. **Open browser DevTools → Network tab**.
3. **Trigger a scheduler save** or any action that calls the secure proxy.
4. Inspect the request to `/api/secure-proxy`:
   - Headers should include `Authorization: Bearer <token>`
   - Response status should be `200` (not `401` or `500`)
5. In the Supabase Dashboard → **Logs → API Logs**, verify requests show `role: authenticated` (not `anon`).

### 5.1 Verify JWT Template Works

In a browser console (while signed in to the app):

```javascript
// If Clerk is available globally via the app
const token = await window.Clerk.session.getToken({ template: 'supabase' });
console.log(token); // Should be a JWT string, not null
// Paste into https://jwt.io to verify claims include role: "authenticated"
```

If `getToken({ template: 'supabase' })` returns `null`, the JWT template in Clerk is either:
- Not named exactly `supabase`
- Not saved/published

### 5.2 Checklist

- [ ] Sign-in flow completes without error
- [ ] `/api/secure-proxy` requests carry `Authorization: Bearer` header
- [ ] Supabase logs show `role: authenticated` for API requests
- [ ] `getToken({ template: 'supabase' })` returns a non-null JWT
- [ ] JWT decoded at jwt.io shows `role: "authenticated"` and `aud: "authenticated"` claims

---

## Summary of Required Manual Steps

| Step | Where | Priority |
|---|---|---|
| Create "supabase" JWT template in Clerk | Clerk Dashboard | **Critical** |
| Set JWT secret in Supabase to Clerk signing key | Supabase Dashboard | **Critical** |
| Add `account_id` claim to Clerk JWT template | Clerk Dashboard | High |
| Set `EXPO_PUBLIC_APP_ORIGIN` in Vercel env vars | Vercel Dashboard | High |
| Verify all 10 env vars in Vercel Production | Vercel Dashboard | **Critical** |
| Apply `20260403000001_compliance_fixes.sql` migration | Supabase SQL Editor / CLI | High |
| Create `referrals` table if missing | Supabase SQL Editor | High |
| Verify CORS returns correct origin (not `*`) | curl / browser DevTools | Medium |
