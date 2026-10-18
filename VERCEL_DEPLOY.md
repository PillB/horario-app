# VERCEL_DEPLOY.md

# Vercel Deployment Checklist
## Expo Router v5 + Clerk + Supabase

---

## 0. Prerequisites

- [ ] Vercel account with access to the target team/org
- [ ] Vercel CLI installed globally: `npm i -g vercel@latest`
- [ ] Logged in: `vercel login`
- [ ] Production domain decided (e.g. `app.yourdomain.com`) — you need this BEFORE
      configuring Clerk and Supabase allowed origins
- [ ] All secrets available:
  - `pk_live_*` Clerk publishable key (switch from `pk_test_*` for production)
  - `sk_live_*` Clerk secret key
  - Supabase project URL + anon key + service role key
  - Any other API keys used in API routes

---

## 1. Pre-Deployment: Code Fixes

### 1.1 Fix Clerk token-cache — native-only import

`@clerk/expo/token-cache` calls `expo-secure-store` which is not available on web.
Wrap it with a Platform guard wherever `tokenCache` is passed to `<ClerkProvider>`.

Edit your root layout (`app/_layout.tsx`):

```tsx
import { Platform } from 'react-native';
import type { TokenCache } from '@clerk/expo/token-cache';

// Only import on native — web uses cookie-based storage automatically
const tokenCache: TokenCache | undefined =
  Platform.OS !== 'web'
    ? (require('@clerk/expo/token-cache').tokenCache as TokenCache)
    : undefined;

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}   // undefined on web = Clerk uses cookies
    >
      {/* ... */}
    </ClerkProvider>
  );
}
```

- [ ] Code change committed and pushed to your deployment branch

---

### 1.2 Fix EXPO_PUBLIC_SECURE_PROXY_URL — must be production URL

This env var is baked into the client bundle at build time by Expo.
It MUST point to the production Vercel domain, not `localhost`.

In `.env.local` (local dev only — not committed):
```
EXPO_PUBLIC_SECURE_PROXY_URL=http://localhost:8081/api/secure-proxy
```

In Vercel dashboard (see §3 below) set:
```
EXPO_PUBLIC_SECURE_PROXY_URL=https://app.yourdomain.com/api/secure-proxy
```

- [ ] Confirm `.env.local` is in `.gitignore`
- [ ] Confirm the Vercel env var will use the production value (set in §3.3)

---

### 1.3 Verify API route filename convention

Expo Router SSR API routes must use the `+api.ts` suffix.

- [ ] Confirm file is `app/api/secure-proxy+api.ts`
- [ ] Confirm the file exports at least one of: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`

```ts
// app/api/secure-proxy+api.ts — minimal shape check
export async function POST(request: Request): Promise<Response> {
  // ...
}
```

---

### 1.4 Confirm web.output = "server" in app.json

```json
{
  "expo": {
    "web": {
      "output": "server",
      "bundler": "metro"
    }
  }
}
```

- [ ] `web.output` is `"server"` (NOT `"static"`)

---

### 1.5 Confirm `api/index.ts` and `vercel.json` follow the official Expo guide

This repo uses the official Expo Router server-output setup for Vercel on SDK 53
(https://docs.expo.dev/router/reference/api-routes/, "Vercel"):

- `api/index.ts` at the **repo root** wraps `createRequestHandler` from
  `@expo/server/adapter/vercel` (pinned to `0.6.2`, the SDK 53 version) with
  `build: dist/server`.
- `vercel.json` builds with `expo export -p web`, publishes `dist/client` as static
  files, bundles `dist/server/**` into the `api/index.ts` function
  (`@vercel/node@5.1.8`) and rewrites `/(.*)` to `/api/index`.

Vercel serves a request from `dist/client` when the file exists (`/_expo/static/*`,
`/assets/*`, `/favicon.ico`); everything else goes to the function, which matches it
against `dist/server/_expo/routes.json`: HTML pages (`/`, `/scheduler`, `/explore`,
`/profile`, `/diagnostics`, `/sign-in`, `/sign-up`), API routes (`/api/*`), and a
404 with the `+not-found` page for anything unknown. **New pages and API routes need
no `vercel.json` change.**

`vercel.json` also sets the security headers (CSP, `X-Frame-Options`, etc.) on every
path, `no-store` on `/api/*`, `must-revalidate` on pages and `immutable` on hashed
static assets.

- [ ] `api/index.ts` exists at the repo root
- [ ] `vercel.json` has `"outputDirectory": "dist/client"` and the single `/api/index` rewrite
- [ ] No per-route rewrites into `dist/server` and no `app/api/*` entries under `functions`
- [ ] No conflicting `next.config.*` file in repo root

---

### 1.6 Run a local production build and smoke test

```bash
npx expo export -p web       # must exit 0 and produce dist/client + dist/server
npx expo serve               # official local server for the export (port 8081)

curl -i http://localhost:8081/scheduler      # 200 HTML
curl -i http://localhost:8081/api/health     # 200 JSON
curl -i http://localhost:8081/does-not-exist # 404
```

- [ ] Build exits with code 0
- [ ] `dist/client/` and `dist/server/` both present
- [ ] `dist/server/_expo/routes.json` exists
- [ ] Pages, `/api/health` and the 404 respond as above

---

## 2. Third-Party Service Configuration

### 2.1 Clerk Dashboard — Add production domain to allowed origins

1. Go to **https://dashboard.clerk.com**
2. Select your application → **Configure** (left sidebar)
3. Navigate to **Domains** → **Allowed Origins**
4. Click **Add origin** and add:

   ```
   https://app.yourdomain.com
   ```

5. If you are using a Vercel preview URL pattern, also add:

   ```
   https://*.vercel.app
   ```

   (only if you need preview deployments to work with Clerk)
6. Click **Save**

For production Clerk keys (not test):
- Navigate to **Configure → API Keys**
- Copy the `pk_live_*` publishable key and `sk_live_*` secret key
- [ ] You have the live keys ready for §3.3

- [ ] Production domain added to Clerk allowed origins
- [ ] Live API keys noted for Vercel env vars

---

### 2.2 Supabase Dashboard — Add Vercel domain to CORS allowed origins

1. Go to **https://supabase.com/dashboard**
2. Select your project
3. Navigate to **Project Settings** (gear icon, bottom-left) → **API**
4. Under **CORS allowed origins**, click **Add origin** and enter:

   ```
   https://app.yourdomain.com
   ```

5. If using Vercel preview deployments:

   ```
   https://*.vercel.app
   ```

6. Click **Save**

Also verify RLS (Row Level Security):
- Navigate to **Authentication → Policies**
- [ ] Confirm every table accessed from the client has RLS enabled and
      appropriate policies (user can only read/write their own rows)

- [ ] Vercel domain added to Supabase CORS
- [ ] RLS policies reviewed

---

## 3. Vercel Dashboard Configuration

### 3.1 Create / import the project

**New project:**
1. Go to **https://vercel.com/new**
2. Click **Import Git Repository** → select your repo
3. On the "Configure Project" screen — proceed to 3.2 before clicking Deploy

**Existing project — open project settings:**
1. Go to **https://vercel.com/[team]/[project]/settings**

---

### 3.2 Set framework to "Other"

In the **Configure Project** screen (or **Settings → General → Framework Preset**):

1. Click the **Framework Preset** dropdown
2. Select **Other**
3. Leave **Build Command** and **Output Directory** unset: `vercel.json` sets them
   (`expo export -p web` and `dist/client`) and overrides the dashboard.

5. Set **Install Command** to (leave default or set explicitly):

   ```
   npm install
   ```

6. Set **Node.js Version** to **20.x** (LTS)
   - Path: **Settings → General → Node.js Version**

- [ ] Framework = Other
- [ ] Build command / output directory come from `vercel.json`
- [ ] Node.js version = 20.x

---

### 3.3 Set environment variables

Navigate to **Settings → Environment Variables**
(URL: `https://vercel.com/[team]/[project]/settings/environment-variables`)

Add ALL of the following. For each:
- Click **Add New**
- Paste the **Name** and **Value**
- Select environments: ✅ Production, ✅ Preview (uncheck Preview for secrets if
  you want isolation), ✅ Development (optional)
- Click **Save**

| Name | Value | Environments |
|------|-------|--------------|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_xxxxxxxxxxxx` | Production, Preview |
| `CLERK_SECRET_KEY` | `sk_live_xxxxxxxxxxxx` | Production, Preview |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Production, Preview |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_xxxx` | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_xxxx` | Production, Preview |
| `CLERK_JWKS_URL` | `https://your-instance.clerk.accounts.dev/.well-known/jwks.json` | Production, Preview |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | `https://app.yourdomain.com/api/secure-proxy` | Production |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | `https://[your-preview-slug].vercel.app/api/secure-proxy` | Preview |
| `EXPO_PUBLIC_APP_ENV` | `production` | Production |
| `EXPO_PUBLIC_APP_ENV` | `preview` | Preview |

> **Important:** `EXPO_PUBLIC_*` variables are inlined into the client bundle at
> build time. They are NOT secret. Never put secret keys in `EXPO_PUBLIC_*` names.
>
> `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are server-only
> — they are never sent to the browser, only available in API routes / server functions.
>
> `EXPO_PUBLIC_APP_ENV=production` hides the support Diagnostics tab and makes
> `/diagnostics` redirect home. Set it only in the Production scope.
>
> `ANTHROPIC_API_KEY` stays in `.env.local` only (local batch scripts) — do not add to Vercel.

- [ ] All env vars added
- [ ] No `EXPO_PUBLIC_` prefix on secret keys
- [ ] `EXPO_PUBLIC_SECURE_PROXY_URL` set to production domain (not localhost)
- [ ] `CLERK_JWKS_URL` set (required for JWT verification in the secure-proxy API route)

---

### 3.4 Assign custom domain

1. Navigate to **Settings → Domains**
   (URL: `https://vercel.com/[team]/[project]/settings/domains`)
2. Type `app.yourdomain.com` → click **Add**
3. Vercel shows required DNS records:
   - For apex domain (`yourdomain.com`): **A record** pointing to `76.76.21.21`
   - For subdomain (`app.yourdomain.com`): **CNAME** pointing to `cname.vercel-dns.com`
4. Configure in your DNS provider (see §4)
5. Wait for Vercel to show **Valid Configuration** ✅ and SSL certificate issued

- [ ] Domain added in Vercel dashboard
- [ ] DNS records noted for next step

---

## 4. DNS Configuration

Log in to your DNS provider (Cloudflare, Route53, Namecheap, etc.)

### 4.1 Add DNS records

For a subdomain deployment (`app.yourdomain.com`):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `app` | `cname.vercel-dns.com` | 300 (or Auto) |

For an apex domain (`yourdomain.com`):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `76.76.21.21` | 300 |

> If using Cloudflare: set the CNAME/A record to **DNS only** (grey cloud) initially
> to avoid SSL conflicts with Vercel's certificate provisioning. You can enable
> the proxy (orange cloud) after the certificate is issued, but you must set
> SSL/TLS mode to **Full (Strict)**.

- [ ] DNS record(s) added
- [ ] Propagation checked: `dig app.yourdomain.com` or https://dnschecker.org
- [ ] Vercel dashboard shows green SSL certificate ✅

---

## 5. Initial Deployment

### 5.1 Trigger deploy

**Via Git (recommended):**
```bash
git push origin main        # or your production branch
# Vercel auto-deploys on push.
```

**Via CLI:**
```bash
vercel --prod
```

### 5.2 Monitor the build log

1. Go to **https://vercel.com/[team]/[project]/deployments**
2. Click the latest deployment → **Build Logs**
3. Watch for:
   - [ ] `expo export -p web` starts
   - [ ] No missing env var warnings (Expo warns if `EXPO_PUBLIC_*` vars are absent)
   - [ ] `Exporting...` completes successfully
   - [ ] One function, `api/index`, is created
   - [ ] Build status = **Ready** ✅

Common build errors and fixes:

| Error | Fix |
|-------|-----|
| `Cannot find module '@clerk/expo/token-cache'` on web build | Apply Platform guard from §1.1 |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not defined` | Check §3.3, redeploy |
| `Output directory dist/client not found` | `expo export -p web` failed earlier in the log; fix that error first |
| Function size limit exceeded | Check for bundled node_modules in API route; use dynamic import |
| **All pages return 404 or 500 after deploy** | Check `api/index.ts` exists at the repo root and `includeFiles` is `dist/server/**` (the function needs `dist/server/_expo/routes.json`) |
| **Blank page, JS errors in console** | Check the CSP in `vercel.json` (browser console lists blocked URLs) and that `/_expo/static/...` returns 200 |

---

## 6. Post-Deployment Verification

### 6.1 Smoke test — site loads

- [ ] Open `https://app.yourdomain.com` in a private/incognito browser window
- [ ] Page renders (no blank white screen, no 404)
- [ ] Browser console: zero `CORS` errors
- [ ] Browser console: zero `401 Unauthorized` errors from Clerk
- [ ] Browser Network tab: `/_expo/static/js/web/entry-*.js` returns 200
- [ ] Browser console: zero `Content-Security-Policy` violations
- [ ] `curl https://app.yourdomain.com/api/health` returns
      `{"status":"ok","environment":"production","commit":"<sha>","authConfigured":true,"databaseConfigured":true}`
- [ ] `https://app.yourdomain.com/diagnostics` redirects to `/` (production build)

---

### 6.2 Test sign-up flow

- [ ] Navigate to `https://app.yourdomain.com/sign-up`
- [ ] Create a new account with a real email address
- [ ] Confirm email if required (check Clerk dashboard: **Users** tab shows new user)
- [ ] Redirected to authenticated route after sign-up ✅
- [ ] Sign out → sign back in → session persists ✅
- [ ] Hard refresh (`Cmd+Shift+R`) → still authenticated ✅ (Clerk cookie-based
      sessions survive refresh on web)

---

### 6.3 Test data persistence per account

- [ ] Sign in as User A → create a record
- [ ] Sign out → sign in as User B
- [ ] Confirm User B cannot see User A's record (RLS is enforced) ✅
- [ ] Sign back in as User A → record is still there ✅
- [ ] Open Supabase Dashboard → **Table Editor** → confirm row exists with correct
      `user_id` matching Clerk user ID ✅

---

### 6.4 Test API proxy route

```bash
# Replace with your actual production URL and a valid Clerk session token
curl -X POST https://app.yourdomain.com/api/secure-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token_from_browser_devtools>" \
  -d '{"action": "getOnboardingProgress", "accountId": "demo"}'
```

- [ ] Returns `200` (or expected response), not `404` or `500`
- [ ] Check Vercel **Functions** tab for invocation logs:
      `https://vercel.com/[team]/[project]/functions`
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is accessible inside the function
- [ ] Confirm unauthenticated requests are rejected (remove auth header → expect `401`)

---

### 6.5 Check Vercel Function logs

1. Go to **https://vercel.com/[team]/[project]/logs**
2. Filter by **Function** to see invocations of `/api/secure-proxy`
3. Look for errors and apply these fixes:

| Log error | Likely cause | Fix |
|-----------|-------------|-----|
| `Failed to fetch JWKS` | `CLERK_JWKS_URL` missing or wrong | Set env var in §3.3; value is `https://your-instance.clerk.accounts.dev/.well-known/jwks.json` |
| `SUPABASE_SERVICE_ROLE_KEY is undefined` | Secret var not added to Vercel | Add to **Production** env in dashboard |
| `TypeError: Cannot read properties of undefined` | Supabase client init failed | Confirm `EXPO_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set |
| `401 Unauthorized` on all requests | JWT verification failing | Check `CLERK_JWKS_URL` matches the publishable key's instance; verify token is current |
| CORS error in browser console | Supabase not allowing Vercel origin | Add production domain to Supabase CORS allowed origins (§2.2) |

---

### 6.6 Troubleshoot 404s

If pages return 404 after a successful build:

1. Run `npx expo export -p web && npx expo serve` locally and request the same path.
   If it 404s locally too, the route does not exist in `app/` (check
   `dist/server/_expo/routes.json`).
2. If it works locally but not on Vercel, open the deployment in the dashboard and
   check **Functions** lists `api/index` and its logs show the request. A missing
   function means `api/index.ts` or the `functions`/`rewrites` entries in
   `vercel.json` were changed.
3. A 404 only for `/_expo/static/...` means the deployment's static output is not
   `dist/client` (check `outputDirectory`).
