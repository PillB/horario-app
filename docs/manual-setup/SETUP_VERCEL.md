# Vercel Environment Variables & Deployment Setup
## Horario — Expo SDK 53 + Expo Router v5 + Node.js Serverless

> **Stack:** Expo SDK 53 · React Native 0.79 · Expo Router v5 API routes · Clerk Core 3 (`@clerk/expo`) ·
> Supabase · Stripe + Culqi · Node.js runtime (NOT Edge) · `app/api/secure-proxy+api.ts`
>
> **Dashboard:** https://vercel.com/dashboard → **horario-app** → **Settings** →
> **Environment Variables**

---

## Table of Contents

1. [How Environment Variables Work in This Stack](#1-how-environment-variables-work-in-this-stack)
2. [Critical Pre-Flight Checks](#2-critical-pre-flight-checks)
3. [Open Environment Variables in Vercel](#3-open-environment-variables-in-vercel)
4. [Add Every Variable](#4-add-every-variable)
5. [Webhook Configuration — Stripe & Clerk](#5-webhook-configuration--stripe--clerk)
6. [CORS Configuration for Preview URLs](#6-cors-configuration-for-preview-urls)
7. [Deploy & Verify](#7-deploy--verify)
8. [Redeployment After Env Var Changes](#8-redeployment-after-env-var-changes)
9. [Real-Time Log Monitoring](#9-real-time-log-monitoring)
10. [Troubleshooting Table](#10-troubleshooting-table)
11. [Security Checklist](#11-security-checklist)
12. [References](#12-references)

---

## 1. How Environment Variables Work in This Stack

Understanding this section prevents the most common class of production bugs.
Read it before touching the dashboard.

### 1.1 Two Completely Different Variable Categories

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HORARIO ENVIRONMENT VARIABLE FLOW                    │
├──────────────────────────────┬──────────────────────────────────────────┤
│   EXPO_PUBLIC_* prefix       │   No prefix (server-only)                │
├──────────────────────────────┼──────────────────────────────────────────┤
│ • Inlined at BUILD TIME      │ • Injected at RUNTIME by Vercel          │
│ • Visible in JS bundle       │ • Never in client bundle                 │
│ • Available: client + server │ • Available: API routes ONLY             │
│ • Changing requires rebuild  │ • Changing requires redeployment         │
│ • NEVER put secrets here     │ • All secrets go here                    │
└──────────────────────────────┴──────────────────────────────────────────┘
```

### 1.2 EXPO_PUBLIC_ Variables Are Baked In at Build Time

🔄 UPDATED: ⚠️ GOTCHA: Build-time baking — the #1 source of "works locally, broken in prod"

`EXPO_PUBLIC_*` variables are **inlined by Metro bundler during `expo export`**. The
bundler performs a literal string replacement — every reference to
`process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` becomes the actual value in the
compiled JavaScript, which is then compiled to Hermes bytecode.

**Consequence:** If you change `EXPO_PUBLIC_SECURE_PROXY_URL` in the Vercel dashboard
after your app is already deployed, **the running app still uses the old value**. The
new value only takes effect after a full redeployment that rebuilds the bundle.

There is also an intermittent Expo CLI bug (Issue #36767) where only the first
`EXPO_PUBLIC_*` variable from `.env` files gets loaded. If a variable appears missing
despite being set, clear the Metro cache.

⚠️ GOTCHA: Intermittent `EXPO_PUBLIC_*` loading failure in Expo CLI — only the first variable from `.env` files may load in some Expo versions. Workaround: run `npx expo start --clear` to clear Metro cache, or add a dummy new variable to force re-export of all variables. (source: https://github.com/expo/expo/issues/36767)

```ts
// What you write:
const url = process.env.EXPO_PUBLIC_SECURE_PROXY_URL;

// What Metro produces in the bundle (value frozen at build time):
const url = "https://horario-app.vercel.app/api/secure-proxy";
```

✅ **Verify:** After any `EXPO_PUBLIC_*` change, confirm the redeployed bundle has the
new value:

```bash
# After redeploy, grep the exported bundle for your variable's value
npx expo export --platform web 2>/dev/null
grep -r "horario-app.vercel.app" dist/
# Should show the NEW URL, not the old one
```

### 1.3 EXPO_PUBLIC_ Variables on the Server (Vercel API Routes)

`EXPO_PUBLIC_*` variables **are also available in `secure-proxy+api.ts`** at runtime
on the server — Vercel injects them as normal `process.env` values. However, because
they are also baked into the client bundle, they must **never contain secrets**.

```ts
// app/api/secure-proxy+api.ts — what IS and IS NOT available:

export async function POST(request: Request) {
  // ✅ Available server-side (also in client bundle — non-secret only)
  const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

  // ✅ Available server-side ONLY (never reaches client bundle)
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const culqiPrivate = process.env.CULQI_PRIVATE_KEY;
  const clerkSecret = process.env.CLERK_SECRET_KEY;

  // ❌ UNDEFINED — non-prefixed vars never reach client components
  // (only relevant if you accidentally try to use them in a React component)
}
```

### 1.4 Server-Only Variables Never Reach the Client

```ts
// ❌ WRONG — in any React component (client-side):
// This will always be undefined, no error thrown, silent failure
const secret = process.env.STRIPE_SECRET_KEY; // → undefined

// ✅ CORRECT — call your secure-proxy instead:
const response = await fetch(process.env.EXPO_PUBLIC_SECURE_PROXY_URL, {
  method: 'POST',
  body: JSON.stringify({ action: 'createCheckout', priceId }),
});
```

### 1.5 Variable Scope by Environment

Vercel has three independent scopes. Variables are NOT shared between them unless you
explicitly select all three when adding.

| Scope | When Used | Stripe Keys | Culqi Keys |
|---|---|---|---|
| **Production** | Merged to `main`/prod branch | `sk_live_*` | `sk_live_*` |
| **Preview** | Every PR branch deployment | `sk_test_*` | `sk_test_*` |
| **Development** | `vercel dev` locally | `sk_test_*` | `sk_test_*` |

⚠️ GOTCHA: Variables added to the Vercel dashboard **do not apply to existing deployments** — they only take effect on the next deployment. If you add a new secret (e.g., `CULQI_PRIVATE_KEY`) and then test the currently-live URL, the value will be `undefined`. You must redeploy. (source: https://vercel.com/docs/projects/environment-variables)

---

## 2. Critical Pre-Flight Checks

🔄 UPDATED: Complete these checks **before** adding environment variables or deploying. Skipping any one of these is the leading cause of broken Vercel deployments for this stack.

### 2.1 Pin Node.js Version to 22.x

🔄 UPDATED: ⚠️ GOTCHA: Vercel now defaults to **Node.js 24.x** for new projects. Expo SDK 53, React Native 0.79, and the `@expo/server` adapter were developed and tested against Node 20/22. Node 24.x may introduce breaking changes. Clerk Core 3 requires Node.js ≥ 20.9.0, which is satisfied by 22.x. Pin to 22.x now. (source: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

In Vercel Dashboard → **horario-app** → **Settings** → **General** → **Build & Development Settings** → **Node.js Version** → select **22.x**.

✅ **Verify:** Go to **Settings** → **General** and confirm the Node.js Version dropdown shows **22.x**.

### 2.2 Confirm Package Manager Is npm (Not bun)

🔄 UPDATED: ⚠️ GOTCHA: Vercel deployment with Expo Router API routes **does not work when using `bun`**. The `expo export` step fails with `ConfigError: The expected package.json path: /vercel/path0/api/package.json does not exist`. Bun resolves paths differently on Vercel's CI environment, breaking API route discovery. (source: https://github.com/expo/expo/issues/27155)

In Vercel Dashboard → **Settings** → **General** → **Build & Development Settings**:
- **Install Command:** `npm install`
- **Build Command:** `expo export -p web`

If you use bun locally, add this to `vercel.json`:
```json
{
  "installCommand": "npm install",
  "buildCommand": "expo export -p web"
}
```

✅ **Verify:** The Vercel build log shows `npm install` (not `bun install`) at the start of the install step.

### 2.3 Verify vercel.json Uses the v3 Format

🔄 UPDATED: There are two incompatible `vercel.json` formats. The v2 format (which uses `"version": 2`, `"builds"`, and `"routes"`) is outdated and will silently serve no API routes in many configurations. Use the v3 format. The `"framework": null` field is **critical** — without it, Vercel auto-detects Next.js and breaks the Expo build entirely.

⚠️ GOTCHA: The `"framework": null` key in `vercel.json` is mandatory. Omitting it causes Vercel's auto-detection to treat the project as Next.js, which breaks the Expo export step and produces an empty deployment. (source: https://docs.expo.dev/router/reference/api-routes/)

This repo follows the official Expo Router guide for SDK 53
(https://docs.expo.dev/router/reference/api-routes/, "Vercel"). Two files at the
repo root are involved:

`api/index.ts` (the location is required by the guide) hands every request that is
not a static client file to `@expo/server`, which routes it using
`dist/server/_expo/routes.json`:

```ts
const { createRequestHandler } = require('@expo/server/adapter/vercel');

module.exports = createRequestHandler({
  build: require('path').join(__dirname, '../dist/server'),
});
```

`vercel.json` (abridged; the real file also sets the security and cache headers):

```json
{
  "framework": null,
  "buildCommand": "expo export -p web",
  "outputDirectory": "dist/client",
  "functions": {
    "api/index.ts": {
      "runtime": "@vercel/node@5.1.8",
      "includeFiles": "dist/server/**",
      "maxDuration": 30
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

Vercel serves files that exist in `dist/client` (`/_expo/static/*`, `/assets/*`,
`/favicon.ico`) directly; everything else (pages, `/api/*` routes, unknown paths that
render `+not-found` with a 404) goes through the function. New pages and `+api` routes
need **no** `vercel.json` change. Do not add per-route rewrites to compiled files in
`dist/server`, and do not list `app/api/*+api.ts` under `functions`: those are not
Vercel functions.

> **Note on `maxDuration`:** 30s is within the Hobby limit. Raise it only on Pro.

🔄 UPDATED: ⚠️ GOTCHA: The `@vercel/node` runtime version must be pinned. The Expo docs explicitly pin `"runtime": "@vercel/node@5.1.8"`. Unpinned runtimes auto-update and have historically broken `@expo/server` adapter compatibility without warning. (source: https://docs.expo.dev/router/reference/api-routes/)

No `vercel-build` script is needed with this (v3) format.

✅ **Verify:** Run `cat vercel.json | python3 -m json.tool` (or any JSON linter) — the file must be valid JSON with no trailing commas.

### 2.4 Confirm `"type": "module"` Is NOT in package.json

🔄 UPDATED: ⚠️ GOTCHA: If `package.json` contains `"type": "module"`, Expo Router API routes on Vercel fail with `Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/dist/server/_expo/functions/hello+api.js from /var/task/node_modules/@expo/server/build/index.js not supported`. Expo API routes are compiled to CommonJS — the `"type": "module"` flag makes Node treat the output as ESM, which `@expo/server`'s `require()` cannot load. (source: https://github.com/expo/expo/issues/30423)

```bash
# Check for the offending field:
cat package.json | grep '"type"'
# If this outputs '"type": "module"' — remove it immediately
```

If you need ESM for specific files, rename those files to `.mjs` instead of using the global flag.

✅ **Verify:** `cat package.json | grep '"type"'` returns nothing, or returns `"type": "commonjs"`.

### 2.5 Pin @expo/server (SDK 53: 0.6.2)

🔄 UPDATED: ⚠️ GOTCHA: There is a critical bug in older `@expo/server` versions where POST requests to Expo API routes on Vercel return `FUNCTION_INVOCATION_TIMEOUT` with `SyntaxError: JSON Parse error: Unexpected character: A`. The function is NOT actually timing out — the adapter silently returns garbage HTML instead of JSON. This affects all POST routes including `secure-proxy+api.ts`. GET requests work fine, masking the issue until payment flows are tested. Fix: pin to `@expo/server@0.5.1` or later. (source: https://github.com/expo/expo/issues/35763)

This repo pins `"@expo/server": "0.6.2"` in `dependencies`, the version `expo-router@5.0.x`
(SDK 53) resolves to, so `api/index.ts` and Expo Router share one copy. (`expo-server`, without
the scope, is the SDK 54+ package; do not use it on SDK 53.)

✅ **Verify:** `npm ls @expo/server` shows `@expo/server@0.6.2` at the top level and `deduped` under `expo-router`.

### 2.6 Confirm dist/ Is in .gitignore

🔄 UPDATED: ⚠️ GOTCHA: JS file hashes change between a local `expo export` and the same build run on Vercel's CI infrastructure. If you commit the `dist/` folder and push it, the `api/index.ts` server entry point references bundle filenames that don't match the files Vercel's build step produces, causing 404s or broken API routes in production. Always let Vercel's CI run `expo export` fresh. (source: https://github.com/expo/expo/pull/34706)

```bash
# Confirm dist/ is ignored:
cat .gitignore | grep dist
# Must output: dist/
```

If not present:
```bash
echo "dist/" >> .gitignore
git rm -r --cached dist/ 2>/dev/null || true
git add .gitignore
git commit -m "chore: ignore dist/ build artifacts"
```

✅ **Verify:** `git status` shows no `dist/` directory tracked after the above.

### 2.7 Confirm Clerk Package Name Is @clerk/expo (Core 3)

🔄 UPDATED: ⚠️ GOTCHA: Clerk Core 3 renames the Expo package from `@clerk/clerk-expo` to `@clerk/expo`. If your code still imports from `@clerk/clerk-expo`, Clerk's Core 3 APIs — including the new `Show` component (which replaces `SignedIn`/`SignedOut`/`Protect`) — will not be available, and you may encounter subtle auth failures. (source: https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)

```bash
# Check for old package name:
cat package.json | grep clerk-expo
# If this outputs anything — you must migrate
npm uninstall @clerk/clerk-expo
npm install @clerk/expo
```

✅ **Verify:** `cat package.json | grep "@clerk/expo"` returns the new package name; `@clerk/clerk-expo` is absent.

### 2.8 Confirm ClerkProvider Passes publishableKey Explicitly

🔄 UPDATED: ⚠️ GOTCHA: In Clerk Core 3, `ClerkProvider` no longer automatically reads `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` from environment variables in Expo/React Native apps. Environment variables inside `node_modules` are not inlined during production builds in React Native. You **must** pass `publishableKey` as an explicit prop or the app will crash in production with an authentication configuration error. (source: https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)

```tsx
// ❌ BROKEN in Clerk Core 3 — ClerkProvider with no publishableKey prop
<ClerkProvider>
  <App />
</ClerkProvider>

// ✅ CORRECT — pass publishableKey explicitly
import { ClerkProvider } from '@clerk/expo';

<ClerkProvider publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}>
  <App />
</ClerkProvider>
```

✅ **Verify:** Search the codebase for `<ClerkProvider` — every instance must have a `publishableKey` prop.

---

## 3. Open Environment Variables in Vercel

### Step 3.1 — Navigate to the Settings Panel

1. Go to [https://vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **horario-app** (your project tile)
3. Click the **Settings** tab in the top navigation bar
4. Click **Environment Variables** in the left sidebar

You should see the URL: `https://vercel.com/<YOUR_TEAM>/horario-app/settings/environment-variables`

✅ **Verify:** The page shows an **Add New** button and three environment filter tabs
(Production, Preview, Development).

### Step 3.2 — Understand the Add Variable Form

When you click **Add New**, Vercel presents:
- **Key** — the variable name (e.g., `STRIPE_SECRET_KEY`)
- **Value** — the secret value
- **Environment** — checkboxes: ☑ Production ☑ Preview ☑ Development
- **Add another** — to batch-add without closing the form

⚠️ GOTCHA: Vercel limits the combined size of all environment variable names and values to **64 KB** per deployment for Node.js projects. With Clerk + Supabase + Stripe + Culqi keys, you are unlikely to hit this, but be aware if the project grows significantly. (source: https://vercel.com/docs/limits)

⚠️ GOTCHA: Vercel encrypts all environment variables at rest using AES-256 and in transit using TLS. However, "encrypted at rest" does not mean "hidden from your team" — anyone with project access in your Vercel team can read these values. Use Vercel's **Sensitive Environment Variables** feature (mark as **Sensitive**) to make the value write-only after saving. (source: https://vercel.com/docs/projects/environment-variables/sensitive-environment-variables)

**Mark these as Sensitive immediately after saving:**
- `STRIPE_SECRET_KEY`
- `CULQI_PRIVATE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLERK_SECRET_KEY`
- `ANTHROPIC_API_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CLERK_WEBHOOK_SECRET`
- `CULQI_WEBHOOK_SECRET`

✅ **Verify:** After saving a Sensitive variable, its value field shows `••••••••` and
a **Cannot display sensitive environment variable** message when you click to edit.

---

## 4. Add Every Variable

Add each variable below via **Settings** → **Environment Variables** → **Add New**.
The **Env** column uses abbreviations: **P** = Production, **Pv** = Preview, **D** = Development.

### 4.1 Authentication — Clerk

🔄 UPDATED: The package is now `@clerk/expo` (Core 3). The `publishableKey` must be passed explicitly to `<ClerkProvider>` — see §2.8.

| Variable | Env | Exact Value Pattern | Where to Get It |
|---|---|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | P, Pv, D | `pk_live_XXXX` (prod) / `pk_test_XXXX` (preview/dev) | [Clerk Dashboard](https://dashboard.clerk.com) → **API Keys** → **Publishable key** |
| `CLERK_SECRET_KEY` | P, Pv | `sk_live_XXXX` (prod) / `sk_test_XXXX` (preview) | Clerk Dashboard → **API Keys** → **Secret keys** |
| `CLERK_JWKS_URL` | P, Pv, D | `https://<YOUR_INSTANCE>.clerk.accounts.dev/.well-known/jwks.json` | Clerk Dashboard → **API Keys** → copy the JWKS URL shown |
| `CLERK_WEBHOOK_SECRET` | P, Pv | `whsec_XXXXXXXXXXXX` | Clerk Dashboard → **Webhooks** → your endpoint → **Signing Secret** |

> **Note on `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`:** Use the live publishable key in
> Production and the test publishable key in Preview/Development. These are NOT secrets
> (they are safe to expose in the client bundle), but they must match the Clerk instance
> (test vs. live) you are using in each environment.

✅ **Verify:** In Vercel dashboard, you should see 4 Clerk rows. Click each to confirm
the correct environments are checked.

### 4.2 Database — Supabase

| Variable | Env | Exact Value Pattern | Where to Get It |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | P, Pv, D | `https://rfmdlzaqvmhbzbgjwhqn.supabase.co` | [Supabase Dashboard](https://app.supabase.com) → **Settings** → **API** → **Project URL** |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | P, Pv, D | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.XXXX` | Supabase → **Settings** → **API** → **Project API keys** → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | P, Pv | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.XXXX` | Supabase → **Settings** → **API** → **Project API keys** → `service_role` `secret` |

⚠️ GOTCHA: `SUPABASE_SERVICE_ROLE_KEY` is a **superuser JWT** — it bypasses all Row Level Security policies on every table. If this key is ever given an `EXPO_PUBLIC_` prefix, any user can read and write all data in your database without restriction. Confirm no `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` exists anywhere. If it does, immediately rotate the key in Supabase → **Settings** → **API** → **Regenerate**. (source: https://supabase.com/docs/guides/api/api-keys)

✅ **Verify:** In Supabase → **Settings** → **API**, confirm the `service_role` key
starts with `eyJ` and matches what you pasted into Vercel. Do NOT use the anon key
value for this variable.

### 4.3 API Endpoints

⚠️ GOTCHA: Preview deployments get randomly-generated URLs like `horario-app-git-feature-xyz-yourteam.vercel.app`. If `EXPO_PUBLIC_SECURE_PROXY_URL` points to the production URL for all environments, your preview app calls the production proxy — mixing test auth tokens with live payment keys. This is dangerous. (source: https://vercel.com/docs/projects/environment-variables/system-environment-variables)

**Option A (Recommended): Use environment-specific values**

| Variable | Env | Value |
|---|---|---|
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Production | `https://horario-app.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Preview | `https://horario-app-git-<YOUR_BRANCH>-<YOUR_TEAM>.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Development | `http://localhost:8081/api/secure-proxy` |
| `EXPO_PUBLIC_APP_ORIGIN` | Production | `https://horario-app.vercel.app` |
| `EXPO_PUBLIC_APP_ORIGIN` | Preview | `https://horario-app-git-<YOUR_BRANCH>-<YOUR_TEAM>.vercel.app` |
| `EXPO_PUBLIC_APP_ORIGIN` | Development | `http://localhost:8081` |
| `EXPO_PUBLIC_APP_ENV` | Production | `production` |
| `EXPO_PUBLIC_APP_ENV` | Preview | `preview` |
| `EXPO_PUBLIC_APP_ENV` | Development | `development` |

`EXPO_PUBLIC_APP_ENV` is inlined at build time. Only the value `production` changes
behaviour: it hides the support **Diagnostics** tab (and the Profile button that opens
it) and makes `/diagnostics` redirect to `/`. Any other value, or leaving it unset,
keeps diagnostics available. `GET /api/health` reports the server-side environment
separately, from Vercel's `VERCEL_ENV` system variable (no setup needed).

**Option B: Use `VERCEL_URL` at runtime (server-side only)**

In `secure-proxy+api.ts`, construct absolute URLs using the system variable:

```ts
// app/api/secure-proxy+api.ts
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:8081';
// ⚠️ VERCEL_URL does NOT include 'https://' — always prepend the protocol
// ⚠️ Do NOT add VERCEL_URL to the Vercel dashboard — it is auto-injected as a system variable
```

✅ **Verify:** After deploying a preview branch, open your Vercel **Deployments** tab,
click the preview deployment, and confirm the URL matches what you set for
`EXPO_PUBLIC_SECURE_PROXY_URL` in the Preview environment.

### 4.4 Payments — Stripe

> **Key naming:** Use `sk_test_*` + `price_test_*` for Preview/Development.
> Use `sk_live_*` + `price_live_*` for Production. Never mix.

| Variable | Env | Value Pattern | Where to Get It |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Production | `sk_live_XXXX` | [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **API keys** → **Secret key** |
| `STRIPE_SECRET_KEY` | Preview, Development | `sk_test_XXXX` | Same page → toggle **Test mode** ON → **Secret key** |
| `STRIPE_WEBHOOK_SECRET` | Production | `whsec_XXXX` | Stripe Dashboard → **Developers** → **Webhooks** → production endpoint → **Signing secret** |
| `STRIPE_WEBHOOK_SECRET` | Preview, Development | `whsec_XXXX` | Same → **Test mode** → your test webhook endpoint → **Signing secret** |
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | Production | `price_XXXX` | Stripe Dashboard → **Products** → **Starter** → monthly price → copy **Price ID** |
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | Preview, Development | `price_XXXX` | Same in test mode |
| `STRIPE_STARTER_ANNUAL_PRICE_ID` | Production | `price_XXXX` | Stripe Dashboard → **Products** → **Starter** → annual price |
| `STRIPE_STARTER_ANNUAL_PRICE_ID` | Preview, Development | `price_XXXX` | Same in test mode |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID` | Production | `price_XXXX` | Stripe Dashboard → **Products** → **Growth** → monthly price |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID` | Preview, Development | `price_XXXX` | Same in test mode |
| `STRIPE_GROWTH_ANNUAL_PRICE_ID` | Production | `price_XXXX` | Stripe Dashboard → **Products** → **Growth** → annual price |
| `STRIPE_GROWTH_ANNUAL_PRICE_ID` | Preview, Development | `price_XXXX` | Same in test mode |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | Production | `price_XXXX` | Stripe Dashboard → **Products** → **Pro** → monthly price |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | Preview, Development | `price_XXXX` | Same in test mode |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Production | `price_XXXX` | Stripe Dashboard → **Products** → **Pro** → annual price |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Preview, Development | `price_XXXX` | Same in test mode |

✅ **Verify:** In Stripe Dashboard → **Developers** → **API keys**, confirm your live
secret key starts with `sk_live_` and your test secret key starts with `sk_test_`. In
Vercel, confirm Production has `sk_live_` and Preview/Development have `sk_test_`.

### 4.5 Payments — Culqi (Peru / Yape)

🔄 UPDATED: Do not use native-binary packages in `secure-proxy+api.ts` for Culqi processing. Use Culqi's HTTP API directly with `fetch()` — no native dependencies. See §2 Known Limitations in the Expo Router API Routes docs.

| Variable | Env | Value Pattern | Where to Get It |
|---|---|---|---|
| `CULQI_PRIVATE_KEY` | Production | `sk_live_XXXX` | [Culqi Panel](https://panel.culqi.com) → **Configuración** → **Llaves de API** → **Llave privada** |
| `CULQI_PRIVATE_KEY` | Preview, Development | `sk_test_XXXX` | Same → toggle **Modo prueba** → **Llave privada** |
| `CULQI_PUBLIC_KEY` | Production | `pk_live_XXXX` | Culqi Panel → **Configuración** → **Llaves de API** → **Llave pública** |
| `CULQI_PUBLIC_KEY` | Preview, Development | `pk_test_XXXX` | Same → toggle **Modo prueba** |
| `CULQI_WEBHOOK_SECRET` | Production | `<YOUR_VALUE_HERE>` | Culqi Panel → **Configuración** → **Notificaciones** → your endpoint → **Token** |
| `CULQI_WEBHOOK_SECRET` | Preview | `<YOUR_VALUE_HERE>` | Same in test mode |

✅ **Verify:** In Culqi Panel → **Configuración** → **Llaves de API**, confirm you
are in the correct mode (live vs. test) before copying each key.

### 4.6 AI — Anthropic

| Variable | Env | Value Pattern | Where to Get It |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Production, Preview | `sk-ant-api03-XXXX` | [Anthropic Console](https://console.anthropic.com) → **API Keys** → **Create Key** |

> **Note:** Do not add `ANTHROPIC_API_KEY` to Development unless you explicitly want
> AI features locally. Unexpected API calls during development can incur costs.

✅ **Verify:** In Anthropic Console → **API Keys**, the key you copied should appear
in the list with status **Active**.

### 4.7 Complete Variable Count Checklist

After adding all variables, your Vercel **Settings** → **Environment Variables** page
should show the following row count:

| Group | Variable Count |
|---|---|