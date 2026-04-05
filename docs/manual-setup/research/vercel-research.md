Now I have all the research data I need. Let me compile this into the comprehensive gotcha report.Now I have comprehensive research data. Let me compile the full report:I now have all the data needed. Let me compile the comprehensive report with proper citations:

---

# 🚨 HORARIO × VERCEL: Complete Gotcha Field Manual
## Expo Router v5 + Vercel Deployment — 15 Critical Issues (2024–2025)

> **Stack Context:** Expo SDK 53 · React Native 0.79 · Expo Router v5 · Clerk v3 · Supabase · Stripe + Culqi · Node.js runtime (NOT Edge) · `app/api/secure-proxy+api.ts`

---

## GOTCHA #1 — `EXPO_PUBLIC_*` Variables Are **Baked Into the Bundle at Build Time**, Not Runtime

### 🔴 PROBLEM
`EXPO_PUBLIC_*` environment variables are **inlined during build time**. This means when the JavaScript bundle is being generated, the bundler replaces all instances of `EXPO_PUBLIC_API_URL` with the actual value in the resulting bundle, which is then converted to Hermes bytecode. If you change a `EXPO_PUBLIC_*` variable in the Vercel dashboard after a deploy, **the old value is still baked into the bundle** — it does NOT hot-reload. For Horario, if `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` or `EXPO_PUBLIC_API_URL` are wrong at Vercel build time, every native client ships with the wrong value permanently.

### ✅ FIX
1. Set all `EXPO_PUBLIC_*` variables in Vercel **before** triggering a build.
2. After changing any `EXPO_PUBLIC_*` variable in the Vercel dashboard, **always trigger a full redeploy** — not just a rerun.
3. Do not store sensitive info, such as private keys, in `EXPO_PUBLIC_` variables. These variables will be visible in plain-text in your compiled application.
4. Secret keys (`STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CULQI_PRIVATE_KEY`) must NOT have the `EXPO_PUBLIC_` prefix — they are only available server-side in API routes.

```bash
# Verify what values are baked in before shipping native build:
EXPO_PUBLIC_API_URL=https://horario.vercel.app npx expo export -p web
```

**📌 SOURCE:** expo.dev/blog — "What every dev should know about using Environment Variables" · docs.expo.dev/guides/environment-variables

---

## GOTCHA #2 — Server-Side Secrets Are **Available in API Routes** But NOT in Client Code

### 🔴 PROBLEM
Developers frequently conflate the two env var categories. All code in your API routes (files ending with `+api.ts`) runs on the server. This is **good** — it means `process.env.STRIPE_SECRET_KEY`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, and `process.env.CULQI_PRIVATE_KEY` are correctly accessible in `secure-proxy+api.ts`. The confusion arises because these non-prefixed vars are **undefined** in any client component, even on the web.

### ✅ FIX
Two-category mental model for Horario:

| Variable | Where Available | How Set on Vercel |
|---|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client bundle + API routes | Vercel Dashboard → Environment Variables |
| `STRIPE_SECRET_KEY` | **API routes only** | Vercel Dashboard → Environment Variables |
| `SUPABASE_SERVICE_ROLE_KEY` | **API routes only** | Vercel Dashboard → Environment Variables |
| `CULQI_PRIVATE_KEY` | **API routes only** | Vercel Dashboard → Environment Variables |

```ts
// ✅ CORRECT — in app/api/secure-proxy+api.ts
export async function POST(request: Request) {
  const secret = process.env.STRIPE_SECRET_KEY; // ✅ works
  const pubKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY; // ✅ also works server-side
}

// ❌ WRONG — in any React component
const secret = process.env.STRIPE_SECRET_KEY; // undefined — DO NOT DO THIS
```

**📌 SOURCE:** docs.expo.dev/eas/environment-variables/usage — "All the code in your API routes (files ending with `+api.ts`) runs on the server."

---

## GOTCHA #3 — Env Variables Added to Vercel Dashboard **Don't Apply to Existing Deployments**

### 🔴 PROBLEM
If you attempt to read an Environment Variable that was added **after** the deployment was made, its value will be `undefined`. This is the single most reported "it works locally, it's broken in prod" bug. Developers add a new Vercel env var (e.g., `CULQI_SECRET_KEY`) then test the existing deployment URL — and get `undefined`.

### ✅ FIX
After adding a new Environment Variable, you must **redeploy** your application. Environment Variables are made available to the app on **each deployment**.

```bash
# After adding any env var to Vercel dashboard:
vercel deploy --prod  # triggers new deployment with the new var
```

Also: if you've added the Environment Variable but it remains `undefined` on a new deployment, consider the environments you have added the variable to and make sure the Environment Variable is present in the UI for the type of deployment you are accessing. Preview deployments and Production deployments have **separate env var scopes**.

**📌 SOURCE:** vercel.com/kb — "How do I add environment variables to my Vercel project?"

---

## GOTCHA #4 — `@expo/server` Version Mismatch Causes `FUNCTION_INVOCATION_TIMEOUT` (Not a Real Timeout)

### 🔴 PROBLEM
This is the **most insidious Expo + Vercel bug of 2025**. Following the Expo docs for Vercel deployment and then fetching `POST /hello` results in `FUNCTION_INVOCATION_TIMEOUT` with `SyntaxError: JSON Parse error: Unexpected character: A`. The function isn't actually timing out — the `@expo/server` adapter is silently broken, returning garbage HTML instead of JSON. The error message completely misleads you.

### ✅ FIX
Install `@expo/server@0.5.1` with `--force` and redeploy to Vercel. This fixes the POST request handling.

```bash
npm install @expo/server@0.5.1 --force
vercel deploy --prod
```

**Always pin `@expo/server`** in `package.json` to avoid auto-upgrades breaking it:
```json
{
  "dependencies": {
    "@expo/server": "0.5.1"
  }
}
```

**📌 SOURCE:** github.com/expo/expo/issues/35763 — opened March 2025, fixed April 2025

---

## GOTCHA #5 — `"type": "module"` in `package.json` Breaks Expo Router on Vercel with `ERR_REQUIRE_ESM`

### 🔴 PROBLEM
When attempting to deploy the Expo API Router on Vercel with ESM configuration, you encounter: `Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/dist/server/_expo/functions/hello+api.js from /var/task/node_modules/@expo/server/build/index.js not supported.`

The Expo API Routes documentation states that ESM is not supported. The current bundling implementation opts to be more unified than flexible — this means the limitation of native not supporting ESM is carried over to API Routes. All code will be compiled to CommonJS. If your root `package.json` has `"type": "module"`, the exported `.js` server files are treated as ESM and `@expo/server` (which uses `require()`) cannot load them.

### ✅ FIX
```json
// ❌ BAD — package.json
{ "type": "module" }

// ✅ FIX — Remove "type": "module" OR rename conflicting files to .mjs/.cjs
// The root package.json must NOT have "type": "module"
```

If you need ESM elsewhere in the project, use `.mjs` extensions for those specific files instead of the global flag.

**📌 SOURCE:** github.com/expo/expo/issues/30423 — July 2024

---

## GOTCHA #6 — `vercel.json` Legacy v2 vs v3 Format: Two Completely Different Configs

### 🔴 PROBLEM
There are **two incompatible `vercel.json` formats** for Expo Router with API routes, and the wrong one will silently serve no API routes at all. Most StackOverflow answers and outdated blog posts show the v2 format.

**Legacy v2 (still required for some setups):**
```json
{
  "version": 2,
  "outputDirectory": "dist",
  "builds": [
    { "src": "package.json", "use": "@vercel/static-build", "config": { "distDir": "dist/client" } },
    { "src": "api/index.ts", "use": "@vercel/node", "config": { "includeFiles": ["dist/server/**"] } }
  ],
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/api/index.ts" }
  ]
}
```

**Modern v3 (preferred):**
```json
{
  "buildCommand": "expo export -p web",
  "outputDirectory": "dist",
  "devCommand": "expo",
  "cleanUrls": true,
  "framework": null,
  "rewrites": [{ "source": "/:path*", "destination": "/" }]
}
```

### ✅ FIX
The newer version of `vercel.json` does not use `routes` and `builds` configuration options anymore, and serves your public assets from the `dist/client` output directory automatically. Use v3 for new projects. The `"framework": null` is **critical** — without it, Vercel auto-detects Next.js and breaks the build.

Also add to `package.json`:
```json
{
  "scripts": {
    "vercel-build": "expo export -p web"
  }
}
```

**📌 SOURCE:** docs.expo.dev/router/reference/api-routes — Vercel section · docs.expo.dev/guides/publishing-websites

---

## GOTCHA #7 — Expo Router API Routes Bundle **Everything Into One File** — No External Native Modules

### 🔴 PROBLEM
API Routes currently work by bundling all code (minus the Node.js built-ins) into a single file. This means that you **cannot use any external dependencies that are not bundled with the server**. For example, a library such as `sharp`, which includes multiple platform binaries, cannot be used.

This directly affects Horario's `secure-proxy+api.ts`: you cannot use `bcrypt` (native binding), `sharp`, `canvas`, or any module with compiled `.node` binaries. Even pure-JS packages that depend on native optional deps can fail silently.

### ✅ FIX
- Use **pure-JS alternatives**: `bcryptjs` instead of `bcrypt`, `jimp` instead of `sharp`
- For Stripe: use `stripe` npm package (pure JS) — ✅ works fine
- For Culqi: use their HTTP API directly with `fetch()` — ✅ no native deps
- Expo notes this will be addressed in a future version

```ts
// ❌ BROKEN in Expo Router API routes on Vercel
import bcrypt from 'bcrypt'; // has native .node binary

// ✅ WORKS
import bcrypt from 'bcryptjs'; // pure JS drop-in replacement
```

**📌 SOURCE:** docs.expo.dev/router/web/api-routes — "Known limitations"

---

## GOTCHA #8 — Vercel Free Plan: **10-Second Function Timeout** Kills Stripe/Culqi Payment Flows

### 🔴 PROBLEM
Vercel Functions are archived when not invoked, and archived functions will be unarchived when they're invoked, which can make the initial cold start time at least 1 second. On the Hobby (free) plan, the **default max duration is 10 seconds**. A Stripe payment + Culqi Yape payment + Supabase write chain can easily exceed this in production during cold-start conditions.

### ✅ FIX
**Option A — Upgrade to Pro and set `maxDuration`:**
```ts
// app/api/secure-proxy+api.ts
export const maxDuration = 30; // seconds — Pro plan allows up to 300s

export async function POST(request: Request) { ... }
```

**Option B — Enable Fluid Compute (Vercel Pro):**
Fluid Compute has higher default and maximum duration limits than traditional serverless functions. For network-intensive functions, it enables you to run code for up to 1 minute on free plans and 14 minutes on paid plans.

**Option C — Always send a response ASAP:**
Always send an HTTP response (even an error). If your function never returns anything, Vercel will wait until the maximum duration has elapsed and then time out. Use streaming for long Stripe operations.

**📌 SOURCE:** vercel.com/docs/functions/runtimes · inngest.com/blog — "How to solve Next.js timeouts" · vercel.com/kb — "What can I do about Vercel Functions timing out?"

---

## GOTCHA #9 — Cold Starts: **1–3 Second Delays** on First Request After Inactivity

### 🔴 PROBLEM
Serverless function cold start delays of 2–3 seconds on Vercel are commonly reported when a function hasn't been invoked recently. The overhead in starting a Lambda invocation — commonly called a cold-start — consists of two components: instantiating the execution environment and processing the bundle code. For Horario's `secure-proxy+api.ts` (which proxies Stripe and Culqi), the first payment attempt after inactivity will feel slow to Peruvian users expecting instant Yape response.

### ✅ FIX
1. **Minimize bundle size** — don't import the entire `stripe` SDK if you only need `stripe.paymentIntents.create`. Use targeted imports.
2. **Enable Fluid Compute** — Vercel Functions prioritize existing idle resources before allocating new ones, reducing unnecessary compute usage. This in-function concurrency is especially effective when multiple requests target the same function.
3. **Keep functions warm** with a lightweight `/api/health+api.ts` pinged via cron (Uptime Robot free tier).
4. **Use Node.js runtime, not Edge** — for Stripe/Culqi webhooks you need the full Node.js environment.

**📌 SOURCE:** github.com/vercel/vercel/discussions/7961 · vercel.com/docs/fluid-compute

---

## GOTCHA #10 — Stripe Webhook Signature Verification Fails: **Raw Body Is Pre-Parsed**

### 🔴 PROBLEM
Vercel parses the body by default, which interferes with Stripe's signature verification. You must disable body parsing to keep the raw body intact for verification. Stripe's `stripe.webhooks.constructEvent()` requires the **exact raw byte buffer** of the request body — if Vercel's runtime has already JSON-parsed it, the HMAC signature won't match and every webhook returns `400`.

### ✅ FIX
In Expo Router API routes (Web API style), use `request.text()` — NOT `request.json()`:

```ts
// app/api/stripe-webhook+api.ts
export async function POST(request: Request) {
  // ✅ CORRECT — get raw body as string
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature')!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,             // ← raw string, not parsed object
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return new Response(`Webhook Error: ${err}`, { status: 400 });
  }
  // handle event...
}
```

Make sure you use `await request.text()` and not `await request.json()` for the raw request body, since the latter doesn't give you the raw body needed for Stripe's signature verification.

Also: check for Vercel's deployment protection — it makes webhook requests get rejected. You should probably disable it for the webhook endpoint.

**📌 SOURCE:** github.com/vercel/next.js/discussions/48885 · vercel.com/kb — "How do I get the raw body of a Serverless Function?"

---

## GOTCHA #11 — Vercel **4.5 MB Request Body Limit** Silently Kills Large Payloads

### 🔴 PROBLEM
The maximum payload size for the request body or the response body of a Vercel Function is **4.5 MB**. If a Vercel Function receives a payload in excess of the limit it will return `413: FUNCTION_PAYLOAD_TOO_LARGE`. For Horario, this matters if you're passing receipt images, base64-encoded documents, or batch schedule data through `secure-proxy+api.ts`.

### ✅ FIX
- For file uploads: upload directly to **Supabase Storage** from the client using a signed URL (bypass the serverless function entirely).
- For large JSON payloads: paginate or chunk the data on the client side before sending.
- For Culqi payment receipts with images: store in Supabase Storage, pass only the URL through `secure-proxy`.

```ts
// ✅ Pattern: Get a signed upload URL from your API, then upload directly from client
// app/api/upload-url+api.ts
export async function POST(req: Request) {
  const { bucket, path } = await req.json(); // small payload ✅
  const { data } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  return Response.json({ uploadUrl: data?.signedUrl });
}
// Client uploads directly to Supabase — never hits Vercel 4.5MB limit
```

**📌 SOURCE:** vercel.com/docs/functions/limitations

---

## GOTCHA #12 — Preview Deployment Environment Variables **Are Scoped Separately** from Production

### 🔴 PROBLEM
Preview environment variables are applied to deployments from any Git branch that does not match the Production Branch. Any change you make to environment variables is **not applied to previous deployments** — they only apply to new deployments. When you're testing on a PR preview URL, it uses **Preview**-scoped env vars. If your `STRIPE_SECRET_KEY` is only set for Production, every Stripe call on preview deployments returns `401`.

### ✅ FIX
In Vercel Dashboard → Project Settings → Environment Variables, for **each secret** set it for **all three environments**:

| Variable | Development | Preview | Production |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ (test key) | ✅ (test key) | ✅ (live key) |
| `CULQI_PRIVATE_KEY` | ✅ (test) | ✅ (test) | ✅ (live) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ |
| `CLERK_SECRET_KEY` | ✅ | ✅ | ✅ |

Use Stripe's **test keys** (`sk_test_...`) for Development and Preview, live keys (`sk_live_...`) only for Production.

**📌 SOURCE:** vercel.com/docs/environment-variables · vercel.com/docs/environment-variables

---

## GOTCHA #13 — Using `bun` as Package Manager Breaks Expo Router Vercel Deployment

### 🔴 PROBLEM
Vercel deployment with API routes does not work when using `bun`. The `expo export` command fails with: `ConfigError: The expected package.json path: /vercel/path0/api/package.json does not exist`. Bun resolves paths differently during the build step on Vercel's CI environment, causing the API route discovery to break.

### ✅ FIX
Use **npm** or **yarn** as your package manager for Vercel deployments with Expo Router API routes:

```bash
# In Vercel Project Settings → General → Build & Development Settings
# Override install command to:
npm install

# OR explicitly set in vercel.json (v3):
{
  "installCommand": "npm install",
  "buildCommand": "expo export -p web"
}
```

If you must use bun locally, add `.npmrc` to force npm on CI or set `VERCEL_FORCE_NO_BUILD_CACHE=1` and the npm install command in the dashboard.

**📌 SOURCE:** github.com/expo/expo/issues/27155

---

## GOTCHA #14 — JS File Hash Changes Between Local Export and Vercel Cloud Build

### 🔴 PROBLEM
An Office Hours attendee was having trouble with the Vercel deployment instructions. It turned out that the **hashes on the JS files were changing from the local export to the build on Vercel's cloud**. This means the `api/index.ts` server entry point references bundle file names that don't match the actual exported files, causing 404s or broken API routes in production.

### ✅ FIX
Building the Vercel app **locally** (with `vercel build`) fixed the issue. Never pre-export locally then push; let Vercel's CI do the full `expo export -p web` on its own infra.

```bash
# ❌ DON'T: export locally then commit dist/
npx expo export -p web
git add dist/ && git commit -m "add dist"

# ✅ DO: let Vercel's CI run expo export fresh
# vercel.json:
{ "buildCommand": "expo export -p web" }
# Vercel runs this command fresh every deployment
```

Add `dist/` to `.gitignore` — never commit build artifacts.

**📌 SOURCE:** github.com/expo/expo/pull/34706 — Expo docs team update, 2024

---

## GOTCHA #15 — Viewing Vercel Function Logs: Where They Are and How to Stream Them

### 🔴 PROBLEM
When `secure-proxy+api.ts` fails silently in production, many developers look in the wrong place. Vercel function logs are **not** in the build logs — they're in a separate "Logs" section, and they're ephemeral (cleared based on plan).

### ✅ FIX
**Dashboard:** You can view runtime logs for all Vercel Functions in real-time from the **Logs section** in the sidebar of your project's dashboard. Runtime logs include all logs generated by Vercel Functions invocations in both preview and production deployments, including `console.log` output.

**CLI streaming:**
```bash
# Stream live logs from your deployment
vercel logs --follow

# Filter by function path
vercel logs --follow --status 500

# View last 24h for linked project
vercel logs
```

The `vercel logs` command displays request logs for your project or streams live runtime logs from a specific deployment. You can filter logs by environment, log level, status code, source, and more. To stream live logs, use the `--follow` flag. Live streaming continues for up to 5 minutes unless interrupted.

Add structured logging to `secure-proxy+api.ts`:
```ts
export async function POST(request: Request) {
  console.log('[secure-proxy] start', { method: request.method });
  try {
    // ... payment logic
    console.log('[secure-proxy] success');
  } catch (e) {
    console.error('[secure-proxy] error', e); // ← shows in Vercel Logs
    return new Response('Internal Error', { status: 500 });
  }
}
```

**📌 SOURCE:** vercel.com/docs/functions/logs · vercel.com/docs/cli/logs

---

## 🗺️ QUICK REFERENCE — Horario Deployment Checklist

```
PRE-DEPLOY CHECKLIST
─────────────────────────────────────────────────────
□ EXPO_PUBLIC_* vars set in Vercel BEFORE triggering build
□ Secret keys set for ALL 3 environments (Dev/Preview/Production)
□ "type": "module" NOT in root package.json
□ @expo/server pinned to ≥0.5.1 in package.json
□ Package manager = npm (not bun) in Vercel settings
□ vercel.json uses v3 format with "framework": null
□ dist/ is in .gitignore (never commit build artifacts)
□ Stripe webhook endpoint uses request.text() not request.json()
□ Vercel Deployment Protection DISABLED for webhook endpoints
□ All native-dep packages replaced with pure-JS alternatives
□ maxDuration set for payment API routes (Pro plan)
□ 4.5MB body limit handled — no large files through secure-proxy
□ console.log statements in secure-proxy for production debugging
```

---

## 📊 Issue Severity Matrix

| # | Gotcha | Severity | Affects Horario |
|---|--------|----------|-----------------|
| 1 | `EXPO_PUBLIC_*` baked at build time | 🔴 Critical | Clerk key, API URL |
| 2 | Secret env vars only in API routes | 🔴 Critical | Stripe, Culqi, Supabase |
| 3 | Must redeploy after adding env var | 🔴 Critical | All secrets |
| 4 | `@expo/server` version → TIMEOUT | 🔴 Critical | All POST routes |
| 5 | `"type": "module"` → ERR_REQUIRE_ESM | 🔴 Critical | All API routes |
| 6 | Wrong `vercel.json` format | 🟠 High | All API routes |
| 7 | No external native modules | 🟠 High | `bcrypt`, `sharp` |
| 8 | 10s timeout on free plan | 🟠 High | Stripe + Culqi chain |
| 9 | 1–3s cold start | 🟡 Medium | UX — first Yape payment |
| 10 | Stripe webhook raw body | 🔴 Critical | Stripe webhooks |
| 11 | 4.5 MB body limit | 🟡 Medium | File uploads |
| 12 | Preview env vars separate | 🟠 High | PR testing |
| 13 | `bun` breaks deployment | 🟠 High | If using bun |
| 14 | JS hash mismatch local vs CI | 🟡 Medium | Pre-built dist |
| 15 | Log visibility | 🟡 Medium | Debugging prod |