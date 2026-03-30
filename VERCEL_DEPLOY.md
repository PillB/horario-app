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

Edit your root layout (e.g. `app/_layout.tsx`):

// app/_layout.tsx
import { Platform } from 'react-native';
import { ClerkProvider } from '@clerk/clerk-expo';

// Only import on native — web uses in-memory / cookie storage automatically
const tokenCache =
  Platform.OS !== 'web'
    ? (() => {
        // Lazy require so the module is never evaluated on web
        const { createTokenCache } = require('@clerk/expo/token-cache');
        return createTokenCache();
      })()
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

- [ ] Code change committed and pushed to your deployment branch

---

### 1.2 Fix EXPO_PUBLIC_SECURE_PROXY_URL — must be production URL

This env var is baked into the client bundle at build time by Expo.
It MUST point to the production Vercel domain, not `localhost`.

In `.env.local` (local dev only — not committed):
EXPO_PUBLIC_SECURE_PROXY_URL=http://localhost:8081/api/secure-proxy

In Vercel dashboard (see §3 below) set:
EXPO_PUBLIC_SECURE_PROXY_URL=https://app.yourdomain.com/api/secure-proxy

- [ ] Confirm `.env.local` is in `.gitignore`
- [ ] Confirm the Vercel env var will use the production value (set in §3.3)

---

### 1.3 Verify API route filename convention

Expo Router SSR API routes must use the `+api.ts` suffix.

- [ ] Confirm file is `app/api/secure-proxy+api.ts`
- [ ] Confirm the file exports at least one of: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`

// app/api/secure-proxy+api.ts — minimal shape check
export async function POST(request: Request): Promise<Response> {
  // ...
}

---

### 1.4 Confirm web.output = "server" in app.json / app.config.ts

{
  "expo": {
    "web": {
      "output": "server",
      "bundler": "metro"
    }
  }
}

- [ ] `web.output` is `"server"` (NOT `"static"`)
- [ ] Build produces `dist/server/` and `dist/client/` directories locally:
  ```bash
  npx expo export --platform web
  ls dist/
  # → client/  server/
  
---

### 1.5 Confirm vercel.json exists at repo root

{
  "buildCommand": "npx expo export --platform web",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}

> Setting `"framework": null` overrides any auto-detection. This is equivalent to
> selecting "Other" in the dashboard and prevents Vercel from injecting Next.js
> build logic.

- [ ] `vercel.json` committed to repo root
- [ ] No conflicting `next.config.*` file in repo root

---

### 1.6 Run a local production build and smoke test

npx expo export --platform web
# Should complete with exit code 0 and produce dist/

vercel dev          # optional: test serverless functions locally

- [ ] Build exits with code 0
- [ ] `dist/server/` and `dist/client/` both present
- [ ] `dist/server/_expo/functions/` contains compiled API route(s)

---

## 2. Third-Party Service Configuration

### 2.1 Clerk Dashboard — Add production domain to allowed origins

1. Go to **https://dashboard.clerk.com**
2. Select your application → **Configure** (left sidebar)
3. Navigate to **Domains** → **Allowed Origins**
4. Click **Add origin** and add:
   
   https://app.yourdomain.com
   
5. If you are using a Vercel preview URL pattern, also add:
   
   https://*.vercel.app
   
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
   
   https://app.yourdomain.com
   
5. If using Vercel preview deployments:
   
   https://*.vercel.app
   
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
3. Set **Build Command** to:
   
   npx expo export --platform web
   
4. Set **Output Directory** to:
   
   dist
   
5. Set **Install Command** to (leave default or set explicitly):
   
   npm install
   
6. Set **Node.js Version** to **20.x** (LTS)
   - Path: **Settings → General → Node.js Version**

- [ ] Framework = Other
- [ ] Build command = `npx expo export --platform web`
- [ ] Output directory = `dist`
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
| `EXPO_PUBLIC_SECURE_PROXY_URL` | `https://app.yourdomain.com/api/secure-proxy` | Production |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | `https://[your-preview-slug].vercel.app/api/secure-proxy` | Preview |

> **Important:** `EXPO_PUBLIC_*` variables are inlined into the client bundle at
> build time. They are NOT secret. Never put secret keys in `EXPO_PUBLIC_*` names.
>
> `CLERK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only — they are
> never sent to the browser, only available in API routes / server functions.
>
> `ANTHROPIC_API_KEY` (and any key not in this table) stays in `.env.local` only
> unless your API routes on Vercel need it — if so, add it as Production-only.

- [ ] All env vars added
- [ ] No `EXPO_PUBLIC_` prefix on secret keys
- [ ] `EXPO_PUBLIC_SECURE_PROXY_URL` set to production domain (not localhost)

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
git push origin main        # or your production branch
Vercel auto-deploys on push.

**Via CLI:**
vercel --prod

### 5.2 Monitor the build log

1. Go to **https://vercel.com/[team]/[project]/deployments**
2. Click the latest deployment → **Build Logs**
3. Watch for:
   - [ ] `npx expo export --platform web` starts
   - [ ] No missing env var warnings (Expo warns if `EXPO_PUBLIC_*` vars are absent)
   - [ ] `Exporting...` completes successfully
   - [ ] `dist/server/` and `dist/client/` detected by Vercel
   - [ ] Serverless functions detected (look for "Creating Serverless Functions...")
   - [ ] Build status = **Ready** ✅

Common build errors and fixes:

| Error | Fix |
|-------|-----|
| `Cannot find module '@clerk/expo/token-cache'` on web build | Apply fix from §1.1 |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not defined` | Check §3.3, redeploy |
| `Output directory dist not found` | Check `vercel.json` outputDirectory = `"dist"` |
| Function size limit exceeded | Check for bundled node_modules in API route; use dynamic import |

---

## 6. Post-Deployment Verification

### 6.1 Smoke test — site loads

- [ ] Open `https://app.yourdomain.com` in a private/incognito browser window
- [ ] Page renders (no blank white screen)
- [ ] Browser console: zero `CORS` errors
- [ ] Browser console: zero `401 Unauthorized` errors from Clerk

---

### 6.2 Test sign-up flow

- [ ] Navigate to your sign-up page (e.g. `https://app.yourdomain.com/sign-up`)
- [ ] Create a new account with a real email address
- [ ] Confirm email if required (check Clerk dashboard: **Users** tab shows new user)
- [ ] Redirected to authenticated route after sign-up ✅
- [ ] Sign out → sign back in → session persists ✅
- [ ] Hard refresh (`Cmd+Shift+R`) → still authenticated ✅ (Clerk cookie-based
      sessions survive refresh on web)

---

### 6.3 Test data persistence per account

- [ ] Sign in as User A → create a record (e.g. a note, post, etc.)
- [ ] Sign out → sign in as User B
- [ ] Confirm User B cannot see User A's record (RLS is enforced) ✅
- [ ] Sign back in as User A → record is still there ✅
- [ ] Open Supabase Dashboard → **Table Editor** → confirm row exists with correct
      `user_id` matching Clerk user ID ✅

---

### 6.4 Test API proxy route

# Replace with your actual production URL and a valid Clerk session token
curl -X POST https://app.yourdomain.com/api/secure-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token_from_browser_devtools>" \
  -d '{"test": true}'

- [ ] Returns `200` (or expected response), not `404` or `500`
- [ ] Check Vercel **Functions** tab for invocation logs:
      `https://vercel.com/[team]/[project]/functions`
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is accessible inside the function
      (add a temporary log and remove after test)
- [ ] Confirm unauthenticated requests are rejected (remove auth header → expect `401`)

---

### 6.5 Check Vercel Function logs

1. Go to **https://vercel.com/[team]/[project]/logs**
   (or **
