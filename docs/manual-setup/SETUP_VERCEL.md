# SETUP_VERCEL.md

```markdown
# Vercel Environment Variables & Deployment Setup
## Horario — Expo SDK 53 + Expo Router v5 + Node.js Serverless

> **Stack:** Expo SDK 53 · React Native 0.79 · Expo Router v5 API routes · Clerk v3 ·
> Supabase · Stripe + Culqi · Node.js runtime (NOT Edge) · `app/api/secure-proxy+api.ts`
>
> **Dashboard:** https://vercel.com/dashboard → **horario-app** → **Settings** →
> **Environment Variables**

---

## Table of Contents

1. [How Environment Variables Work in This Stack](#1-how-environment-variables-work-in-this-stack)
2. [Open Environment Variables in Vercel](#2-open-environment-variables-in-vercel)
3. [Add Every Variable](#3-add-every-variable)
4. [Webhook Configuration — Stripe & Clerk](#4-webhook-configuration--stripe--clerk)
5. [CORS Configuration for Preview URLs](#5-cors-configuration-for-preview-urls)
6. [Deploy & Verify](#6-deploy--verify)
7. [Redeployment After Env Var Changes](#7-redeployment-after-env-var-changes)
8. [Real-Time Log Monitoring](#8-real-time-log-monitoring)
9. [Troubleshooting Table](#9-troubleshooting-table)
10. [Security Checklist](#10-security-checklist)

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

⚠️ **GOTCHA: Build-time baking — the #1 source of "works locally, broken in prod"**

`EXPO_PUBLIC_*` variables are **inlined by Metro bundler during `expo export`**. The
bundler performs a literal string replacement — every reference to
`process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` becomes the actual value in the
compiled JavaScript, which is then compiled to Hermes bytecode.

**Consequence:** If you change `EXPO_PUBLIC_SECURE_PROXY_URL` in the Vercel dashboard
after your app is already deployed, **the running app still uses the old value**. The
new value only takes effect after a full redeployment that rebuilds the bundle.

```ts
// What you write:
const url = process.env.EXPO_PUBLIC_SECURE_PROXY_URL;

// What Metro produces in the bundle (value frozen at build time):
const url = "https://horario-app.vercel.app/api/secure-proxy";
```

**Source:** [Expo environment variables guide](https://docs.expo.dev/guides/environment-variables/) —
*"EXPO_PUBLIC_ variables are replaced at build time."*

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

---

## 2. Open Environment Variables in Vercel

### Step 2.1 — Navigate to the Settings Panel

1. Go to [https://vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **horario-app** (your project tile)
3. Click the **Settings** tab in the top navigation bar
4. Click **Environment Variables** in the left sidebar

You should see the URL: `https://vercel.com/YOUR-TEAM/horario-app/settings/environment-variables`

✅ **Verify:** The page shows an **Add New** button and three environment filter tabs
(Production, Preview, Development).

### Step 2.2 — Understand the Add Variable Form

When you click **Add New**, Vercel presents:
- **Key** — the variable name (e.g., `STRIPE_SECRET_KEY`)
- **Value** — the secret value
- **Environment** — checkboxes: ☑ Production ☑ Preview ☑ Development
- **Add another** — to batch-add without closing the form

⚠️ **GOTCHA: Encryption at rest is automatic**

Vercel encrypts all environment variables at rest using AES-256 and in transit using
TLS. You do **not** need a separate secrets manager for values stored here. However,
"encrypted at rest" does not mean "hidden from your team" — anyone with project access
in your Vercel team can read these values. Use Vercel's
[Sensitive Environment Variables](https://vercel.com/docs/projects/environment-variables/sensitive-environment-variables)
feature (mark as **Sensitive**) to hide the value from the UI after saving — it becomes
write-only and cannot be read back through the dashboard.

**Mark these as Sensitive:**
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

## 3. Add Every Variable

Add each variable below via **Settings** → **Environment Variables** → **Add New**.
The **Env** column uses abbreviations: **P** = Production, **Pv** = Preview, **D** = Development.

### 3.1 Authentication — Clerk

| Variable | Env | Exact Value Pattern | Where to Get It |
|---|---|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | P, Pv, D | `pk_live_XXXX` (prod) / `pk_test_XXXX` (preview/dev) | [Clerk Dashboard](https://dashboard.clerk.com) → **API Keys** → **Publishable key** |
| `CLERK_SECRET_KEY` | P, Pv | `sk_live_XXXX` (prod) / `sk_test_XXXX` (preview) | Clerk Dashboard → **API Keys** → **Secret keys** |
| `CLERK_JWKS_URL` | P, Pv, D | `https://YOUR-INSTANCE.clerk.accounts.dev/.well-known/jwks.json` | Clerk Dashboard → **API Keys** → copy the JWKS URL shown |
| `CLERK_WEBHOOK_SECRET` | P, Pv | `whsec_XXXXXXXXXXXX` | Clerk Dashboard → **Webhooks** → your endpoint → **Signing Secret** |

> **Note on `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`:** Use the live publishable key in
> Production and the test publishable key in Preview/Development. These are NOT secrets
> (they are safe to expose in the client bundle), but they must match the Clerk instance
> (test vs. live) you are using in each environment.

✅ **Verify:** In Vercel dashboard, you should see 4 Clerk rows. Click each to confirm
the correct environments are checked.

### 3.2 Database — Supabase

| Variable | Env | Exact Value Pattern | Where to Get It |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | P, Pv, D | `https://rfmdlzaqvmhbzbgjwhqn.supabase.co` | [Supabase Dashboard](https://app.supabase.com) → **Settings** → **API** → **Project URL** |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | P, Pv, D | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.XXXX` | Supabase → **Settings** → **API** → **Project API keys** → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | P, Pv | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.XXXX` | Supabase → **Settings** → **API** → **Project API keys** → `service_role` `secret` |

⚠️ **GOTCHA: `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely**

The service role key is a **superuser JWT** — it ignores all RLS policies on every
table. If this key leaks into the client bundle (via an `EXPO_PUBLIC_` prefix mistake),
any user can read and write all data in your database without restriction.

**Fix:** Confirm no `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` exists. The correct name
has no `EXPO_PUBLIC_` prefix. Set it only for Production and Preview — not Development
(use the anon key + RLS locally).

✅ **Verify:** In Supabase → **Settings** → **API**, confirm the `service_role` key
starts with `eyJ` and matches what you pasted into Vercel. Do NOT use the anon key
value for this variable.

### 3.3 API Endpoints

⚠️ **GOTCHA: Preview deployments get randomly generated URLs**

Vercel preview deployments get URLs like `horario-app-git-feature-xyz-yourteam.vercel.app`.
If `EXPO_PUBLIC_SECURE_PROXY_URL` is set to your production URL in all environments,
**your preview app will call the production proxy** — mixing test auth tokens with live
payment keys. This is dangerous.

**Fix — Option A (Recommended): Use environment-specific values**

Set `EXPO_PUBLIC_SECURE_PROXY_URL` three times with different values:

| Variable | Env | Value |
|---|---|---|
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Production | `https://horario-app.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Preview | `https://horario-app-git-BRANCH-YOURTEAM.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Development | `http://localhost:8081/api/secure-proxy` |

> **Important:** For Preview, use your stable preview alias if you have one
> (e.g., `horario-app-preview.vercel.app`), or set it per-PR using Vercel's
> [system environment variables](https://vercel.com/docs/projects/environment-variables/system-environment-variables):
> `VERCEL_URL` is auto-set to the deployment URL on every deploy.

**Fix — Option B: Use `VERCEL_URL` at runtime (server-side only)**

In `secure-proxy+api.ts`, construct absolute URLs using the system variable:

```ts
// app/api/secure-proxy+api.ts
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:8081';
```

> `VERCEL_URL` is automatically injected by Vercel — do NOT add it to your dashboard.
> Note: `VERCEL_URL` does NOT include `https://` — always prepend the protocol.

| Variable | Env | Value |
|---|---|---|
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Production | `https://horario-app.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Preview | `https://horario-app-git-preview-yourteam.vercel.app/api/secure-proxy` |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Development | `http://localhost:8081/api/secure-proxy` |
| `EXPO_PUBLIC_APP_ORIGIN` | Production | `https://horario-app.vercel.app` |
| `EXPO_PUBLIC_APP_ORIGIN` | Preview | `https://horario-app-git-preview-yourteam.vercel.app` |
| `EXPO_PUBLIC_APP_ORIGIN` | Development | `http://localhost:8081` |

✅ **Verify:** After deploying a preview branch, open your Vercel **Deployments** tab,
click the preview deployment, and confirm the URL matches what you set for
`EXPO_PUBLIC_SECURE_PROXY_URL` in the Preview environment.

### 3.4 Payments — Stripe

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

### 3.5 Payments — Culqi (Peru / Yape)

| Variable | Env | Value Pattern | Where to Get It |
|---|---|---|---|
| `CULQI_PRIVATE_KEY` | Production | `sk_live_XXXX` | [Culqi Panel](https://panel.culqi.com) → **Configuración** → **Llaves de API** → **Llave privada** |
| `CULQI_PRIVATE_KEY` | Preview, Development | `sk_test_XXXX` | Same → toggle **Modo prueba** → **Llave privada** |
| `CULQI_PUBLIC_KEY` | Production | `pk_live_XXXX` | Culqi Panel → **Configuración** → **Llaves de API** → **Llave pública** |
| `CULQI_PUBLIC_KEY` | Preview, Development | `pk_test_XXXX` | Same → toggle **Modo prueba** |
| `CULQI_WEBHOOK_SECRET` | Production | `[token from Culqi]` | Culqi Panel → **Configuración** → **Notificaciones** → your endpoint → **Token** |
| `CULQI_WEBHOOK_SECRET` | Preview | `[token from Culqi test]` | Same in test mode |

✅ **Verify:** In Culqi Panel → **Configuración** → **Llaves de API**, confirm you
are in the correct mode (live vs. test) before copying each key.

### 3.6 AI — Anthropic

| Variable | Env | Value Pattern | Where to Get It |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Production, Preview | `sk-ant-api03-XXXX` | [Anthropic Console](https://console.anthropic.com) → **API Keys** → **Create Key** |

> **Note:** Do not add `ANTHROPIC_API_KEY` to Development unless you explicitly want
> AI features locally. Unexpected API calls during development can incur costs.

✅ **Verify:** In Anthropic Console → **API Keys**, the key you copied should appear
in the list with status **Active**.

### 3.7 Complete Variable Count Checklist

After adding all variables, your Vercel **Settings** → **Environment Variables** page
should show the following row count:

| Group | Variable Count |
|---|---|
| Clerk | 4 |
| Supabase | 3 |
| API Endpoints | 2 (×3 environments = 6 rows displayed) |
| Stripe | 16 (8 names × 2 environments each) |
| Culqi | 6 (3 names × 2 environments each) |
| Anthropic | 1 |
| **Total unique names** | **32** |

✅ **Verify:** The Vercel environment variables list shows at least 32 variable names
with correct environment badges (Production/Preview/Development).

---

## 4. Webhook Configuration — Stripe & Clerk

### 4.1 Why Webhooks Require the Node.js Runtime

⚠️ **GOTCHA: Webhook signature verification requires the raw request body**

Stripe and Clerk sign webhooks using HMAC-SHA256 over the **raw bytes** of the request
body. If anything reads or transforms the body before your signature check (e.g., a
JSON middleware that re-serializes), the signature fails with
`"No signatures found matching the expected signature for payload"`.

Vercel's **Edge Runtime** does NOT buffer the full request body before your handler
runs. The **Node.js runtime** does. Your `secure-proxy+api.ts` must use the Node.js
runtime.

✅ **Verify** your route has this at the top:

```ts
// app/api/secure-proxy+api.ts — MUST be present, MUST be first export
export const runtime = 'nodejs'; // ← this line is mandatory
```

If this line is missing or set to `'edge'`, Stripe webhook verification will fail
on every request with a 400.

### 4.2 Reading the Raw Body in an Expo Router API Route

```ts
// app/api/secure-proxy+api.ts

export const runtime = 'nodejs';

export async function POST(request: Request) {
  // ✅ CORRECT: Read raw body as ArrayBuffer, then convert to string
  // Do NOT call request.json() before this — it consumes the stream
  const rawBody = await request.arrayBuffer();
  const rawBodyString = Buffer.from(rawBody).toString('utf-8');

  const stripeSignature = request.headers.get('stripe-signature');
  const clerkSignature = request.headers.get('svix-signature');

  if (stripeSignature) {
    // Stripe webhook path
    const event = stripe.webhooks.constructEvent(
      rawBodyString,                          // ← raw string, not parsed JSON
      stripeSignature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    // handle event...
  }

  if (clerkSignature) {
    // Clerk webhook path (uses svix)
    const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
    const evt = wh.verify(rawBodyString, {   // ← raw string
      'svix-id': request.headers.get('svix-id')!,
      'svix-timestamp': request.headers.get('svix-timestamp')!,
      'svix-signature': clerkSignature,
    });
    // handle evt...
  }
}
```

### 4.3 Vercel Function Timeout Limits

⚠️ **GOTCHA: Default Vercel function timeout is 10 seconds on Hobby plan**

Webhook handlers that call Supabase + Stripe + Culqi in sequence can exceed 10 seconds.

| Plan | Default Timeout | Max Configurable |
|---|---|---|
| Hobby | 10s | 60s |
| Pro | 15s | 300s |
| Enterprise | 15s | 900s |

**Fix for Pro plan** — add to `vercel.json` at your project root:

```json
{
  "functions": {
    "app/api/secure-proxy+api.ts": {
      "maxDuration": 60
    }
  }
}
```

✅ **Verify:** After deploying with `vercel.json`, go to **Settings** → **Functions**
in your Vercel dashboard and confirm `secure-proxy` shows max duration of 60s.

**Fix for Hobby plan** — make webhook handlers fast:
- Immediately return `200` to Stripe/Clerk after validating the signature
- Process the actual business logic (DB writes, emails) asynchronously using
  Vercel's `waitUntil` or by queueing via Supabase Edge Functions

```ts
// Pattern: respond immediately, process async
export async function POST(request: Request) {
  const rawBody = await request.arrayBuffer();
  // ... validate signature (fast) ...

  // Respond to Stripe immediately — prevents retry storm
  const response = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  // Process asynchronously (non-blocking)
  // Use context.waitUntil() if available, or fire-and-forget with error logging
  processWebhookAsync(event).catch(console.error);

  return response;
}
```

### 4.4 Register Webhook Endpoints

**Stripe — Production Webhook:**

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. **Endpoint URL:** `https://horario-app.vercel.app/api/secure-proxy`
4. **Listen to:** Select events your app handles, minimally:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Click the endpoint → **Signing secret** → **Reveal** → copy `whsec_XXXX`
7. Set this as `STRIPE_WEBHOOK_SECRET` in Vercel → Production

**Stripe — Test Webhook (Preview/Development):**

1. Switch Stripe Dashboard to **Test mode** (toggle top-right)
2. Repeat steps 2–6 above with your preview URL
3. Set this as `STRIPE_WEBHOOK_SECRET` in Vercel → Preview + Development

**Local webhook testing with Stripe CLI:**

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Authenticate
stripe login

# Forward to local dev server (Expo Router API routes run on port 8081)
stripe listen --forward-to http://localhost:8081/api/secure-proxy

# The CLI prints a webhook signing secret starting with whsec_
# ⚠️ This is DIFFERENT from your Stripe dashboard webhook secret
# Use it only as STRIPE_WEBHOOK_SECRET in your local .env.local file
```

✅ **Verify:** Stripe CLI output shows:
```
> Ready! Your webhook signing secret is whsec_XXXXXX (^C to quit)
```
Trigger a test event:
```bash
stripe trigger checkout.session.completed
```
Your local server logs should show the event being processed.

**Clerk — Production Webhook:**

1. Go to [Clerk Dashboard](https://dashboard.clerk.com) → **Webhooks**
2. Click **Add Endpoint**
3. **URL:** `https://horario-app.vercel.app/api/secure-proxy`
4. **Subscribe to events:** At minimum:
   - `user.created`
   - `user.updated`
   - `user.deleted`
5. Click **Create**
6. Copy the **Signing Secret** (`whsec_XXXX`)
7. Set as `CLERK_WEBHOOK_SECRET` in Vercel → Production + Preview

✅ **Verify:** In Clerk Dashboard → **Webhooks** → your endpoint → **Testing** tab,
send a test `user.created` event. The endpoint should return `200`. If you see `400`,
check the raw body reading pattern in §4.2.

---

## 5. CORS Configuration for Preview URLs

### 5.1 The Preview URL Problem

⚠️ **GOTCHA: Preview deployments have unpredictable URLs not in your CORS allowlist**

Your `secure-proxy` likely has an allowlist like:
```ts
const ALLOWED_ORIGINS = ['https://horario-app.vercel.app'];
```

A preview deployment at `horario-app-git-fix-payments-yourteam.vercel.app` will have
every `fetch()` call to the proxy blocked by CORS — browser shows:
`"Access to fetch at '...' from origin '...' has been blocked by CORS policy"`

### 5.2 Dynamic CORS Origin Validation

Update your `secure-proxy+api.ts` to allow all `*.vercel.app` subdomains of your
project, plus production:

```ts
// app/api/secure-proxy+api.ts

export const runtime = 'nodejs';

const PRODUCTION_ORIGIN = 'https://horario-app.vercel.app';

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  // Allow exact production domain
  if (origin === PRODUCTION_ORIGIN) return true;
  // Allow all Vercel preview deployments for this project
  if (/^https:\/\/horario-app(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return true;
  // Allow local development
  if (origin === 'http://localhost:8081') return true;
  return false;
}

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = isAllowedOrigin(origin) ? origin! : PRODUCTION_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// ✅ CORS preflight — must return 204, not 200
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,   // ← 204, not 200 — some browsers reject 200 for preflight
    headers: corsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  // ... your handler logic ...
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}
```

⚠️ **GOTCHA: OPTIONS must return 204**

Browsers send a preflight `OPTIONS` request before any cross-origin `POST` with a
custom `Authorization` header. If `OPTIONS` returns `200` with a body, some browsers
(Safari, older Chrome) reject the preflight. Return `204 No Content` with no body.

✅ **Verify** CORS is working from a preview URL:

```bash
# Replace with an actual preview URL from your Vercel Deployments tab
curl -X OPTIONS https://horario-app-git-fix-xyz-yourteam.vercel.app/api/secure-proxy \
  -H "Origin: https://horario-app-git-fix-xyz-yourteam.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, Authorization" \
  -i

# Expected response:
# HTTP/2 204
# access-control-allow-origin: https://horario-app-git-fix-xyz-yourteam.vercel.app
# access-control-allow-methods: GET, POST, OPTIONS
```

---

## 6. Deploy & Verify

### 6.1 Trigger Initial Deployment

After adding all environment variables in §3:

```bash
# Option A — Push to your connected Git branch (recommended)
git add vercel.json  # if you added/changed it
git commit -m "chore: add vercel.json with function timeout config"
git push origin main

# Option B — Deploy directly via Vercel CLI
npm install -g vercel
vercel login
vercel deploy --prod
```

✅ **Verify:** Go to **Deployments** tab in Vercel. The latest deployment should show
a green **Ready** badge. Deployment typically takes 60–90 seconds.

### 6.2 Test the Secure Proxy Endpoint

```bash
# Replace with your actual production URL
curl https://horario-app.vercel.app/api/secure-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_SESSION_TOKEN" \
  -d '{"action": "getSubscription", "accountId": "test-account-123"}' \
  --max-time 30 \
  -w "\n\nHTTP Status: %{http_code}\nTime: %{time_total}s\n"
```

**Expected response (healthy):**
```json
{
  "subscription": {
    "tier": "free",
    "status": "active",
    "currentPeriodEnd": null
  }
}
HTTP Status: 200
Time: 0.847s
```

**Expected response (missing env var):**
```json
{"error": "Internal server error"}
HTTP Status: 500
```
→ Go to [Vercel Logs](#8-real-time-log-monitoring) to see the specific missing variable.

### 6.3 What a Healthy Cold Start Looks Like

⚠️ **GOTCHA: Cold starts add 1–3 seconds on the first request after idle**

Vercel serverless functions are shut down after ~5 minutes of inactivity. The next
request triggers a cold start: Node.js runtime init + your module imports + DB
connection setup. This is **normal behavior**, not a bug.

```
# Vercel function logs during a cold start (visible in Logs tab):
2024-01-15T10:23:01.000Z  START RequestId: abc-123
2024-01-15T10:23:01.847Z  [INFO] Cold start — initializing Stripe client
2024-01-15T10:23:01.891Z  [INFO] Cold start — initializing Supabase client
2024-01-15T10:23:03.201Z  [INFO] Request processed successfully
2024-01-15T10:23:03.202Z  END RequestId: abc-123
2024-01-15T10:23:03.205Z  REPORT Duration: 2201ms  Billed: 2300ms
                                           ^^^^^^
                                           Cold start: ~2.2s total
                                           Warm requests will be ~200-400ms
```

**To minimize cold start impact:**
1. Move all client initializations (Stripe, Supabase) **outside** the request handler
   so they are cached across warm invocations:

```ts
// ✅ Module-level initialization — runs once per cold start, cached for warm requests
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const runtime = 'nodejs';

export async function POST(request: Request) {
  // stripe and supabase are already initialized — no re-init cost
}
```

✅ **Verify:** Make two requests in sequence. The second should show `Duration: ~200ms`
vs the first's `~2000ms` in Vercel function logs.

---

## 7. Redeployment After Env Var Changes

### 7.1 When You Must Redeploy

| Change Type | Requires Redeploy? | Which Deployments Affected |
|---|---|---|
| Added new `EXPO_PUBLIC_*` var | **YES** — baked into bundle | All future builds |
| Changed existing `EXPO_PUBLIC_*` var | **YES** — baked into bundle | All future builds |
| Added new server-only var (no prefix) | **YES** — injected at runtime | Next deployment only |
| Changed existing server-only var | **YES** — old deployment has old value | Next deployment only |
| Deleted a variable | **YES** | Next deployment only |

⚠️ **GOTCHA: The currently-running deployment keeps its env vars forever**

Even after you change a variable in the dashboard, every request to your **existing**
deployed URL uses the **values that were present when that deployment was built**. The
dashboard change only affects the **next** deployment.

**Source:** [Vercel docs — Environment Variables](https://vercel.com/docs/projects/environment-variables) —
*"If you add an Environment Variable after a deployment, it will not be available
until you redeploy."*

### 7.2 Trigger a Redeployment — Exact Steps

**Method A — Redeploy from the Dashboard (fastest):**

1. Go to your project → **Deployments** tab
2. Find the most recent **Production** deployment (green **Ready** badge)
3. Click the **⋯** (three dots) menu on the right side of that row
4. Click **Redeploy**
5. In the dialog: confirm you want to **Use existing Build Cache** → click **Redeploy**
   (uncheck "Use existing Build Cache" only if you changed `EXPO_PUBLIC_*` vars —
   cached bundles won't pick up the new baked-in values)
6. Wait for the new deployment to show **Ready** (typically 60–90 seconds)

> **Critical:** For `EXPO_PUBLIC_*` changes, always **uncheck "Use existing Build
> Cache"** — a cached bundle will still contain the old value.

✅ **Verify:** After redeployment, call the proxy and check logs:

```bash
curl https://horario-app.vercel.app/api/secure-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"action": "ping"}' \
  -s | jq .
```

**Method B — Force redeploy via CLI:**

```bash
# Empty commit to trigger CI/CD
git commit --allow-empty -m "chore: trigger redeploy after env var update"
git push origin main
```

**Method C — Vercel CLI:**

```bash
vercel deploy --prod --force  # --force bypasses build cache
```

### 7.3 Verify New Variables Are Picked Up

Add a temporary diagnostic endpoint (remove before going to production):

```ts
// app/api/health+api.ts — TEMPORARY, delete after verification

export const runtime = 'nodejs';

export async function GET(request: Request) {
  // Never expose actual secret values — only check presence
  return Response.json({
    stripe: !!process.env.STRIPE_SECRET_KEY,
    supabase: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    clerk: !!process.env.CLERK_SECRET_KEY,
    culqi: !!process.env.CULQI_PRIVATE_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET,
    clerkWebhook: !!process.env.CLERK_WEBHOOK_SECRET,
    // Show first 8 chars of publishable key to verify correct key type
    clerkPk: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.substring(0, 8),
  });
}
```

```bash
curl https://horario-app.vercel.app/api/health
```

**Expected (all variables present):**
```json
{
  "stripe": true,
  "supabase": true,
  "clerk": true,
  "culqi": true,
  "anthropic": true,
  "stripeWebhook": true,
  "clerkWebhook": true,
  "clerkPk": "pk_live_"
}
```

Any `false` value means that variable is missing or not set for the Production
environment. Go back to §3 and re-add it.

✅ **Verify:** All values are `true` and `clerkPk` shows `pk_live_` in Production
(not `pk_test_`).

---

## 8. Real-Time Log Monitoring

### 8.1 Vercel Dashboard Logs

1. Go to your project in Vercel dashboard
2. Click the **Logs** tab (next to Deployments, Analytics, Storage)
3. In the **Filter** dropdown, select **Function logs** to see serverless output
4. In the **Source** dropdown, select `api/secure-proxy` to filter to your proxy
5. Click **Live** toggle to stream logs in real-time

✅ **Verify:** Make a test request to `secure-proxy` — a new log entry should appear
within 2 seconds showing the request ID, duration, and any `console.log` output.

### 8.2 Vercel CLI Log Streaming

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Authenticate
vercel login

# Stream production function logs in real-time
vercel logs https://horario-app.vercel.app --follow

# Filter to only error logs
vercel logs https://horario-app.vercel.app --follow 2>&1 | grep -i error

# Get logs for a specific deployment
vercel logs DEPLOYMENT_URL --follow
```

✅ **Verify:** CLI shows `Streaming logs from [project]...` and updates within
2 seconds of each request.

### 8.3 Adding Structured Logs to secure-proxy

```ts
// app/api/secure-proxy+api.ts — structured logging pattern

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().substring(0, 8);
  const start = Date.now();

  console.log(JSON.stringify({
    requestId,
    event: 'request_start',
    method: request.method,
    url: request.url,
  }));

  try {
    // ... your handler logic ...

    console.log(JSON.stringify({
      requestId,
      event: 'request_success',
      duration: Date.now() - start,
    }));

    return Response.json(result);
  } catch (error) {
    console.error(JSON.stringify({
      requestId,
      event: 'request_error',
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    }));

    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

These structured logs appear in Vercel's **Logs** tab and can be filtered by the
**Source** field.

---

## 9. Troubleshooting Table

| Symptom | Cause | Fix |
|---|---|---|
| `process.env.STRIPE_SECRET_KEY` is `undefined` in API route | Variable not set for the current environment (Production/Preview) | Go to **Settings** → **Environment Variables**, confirm `STRIPE_SECRET_KEY` has the Production checkbox checked, then redeploy |
| `process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` returns old value after dashboard update | `EXPO_PUBLIC_*` vars are baked into bundle at build time | Trigger a full redeployment with build cache disabled: **Deployments** → **⋯** → **Redeploy** → uncheck "Use existing Build Cache" |
| `{"error": "No signatures found matching the expected signature for payload"}` | Webhook body was read as JSON before signature verification, or `Edge` runtime is consuming the body | Ensure `export const runtime = 'nodejs'` is the first export in `secure-proxy+api.ts`. Read raw body with `await request.arrayBuffer()` before any other read |
| `CORS error: blocked by CORS policy` on preview URL | Preview deployment URL not in CORS allowlist | Implement dynamic origin validation using regex `/^https:\/\/horario-app(-[a-z0-9-]+)?\.vercel\.app$/` as shown in §5.2 |
| `OPTIONS` preflight returns `200` but browser still blocks | Some browsers require `204` for CORS preflight, not `200` | Change `OPTIONS` handler to return `new Response(null, { status: 204, ... })` |
| Webhook handler returns `504 Gateway Timeout` | Handler took longer than 10s (Hobby) or 15s (Pro) default | Add `"maxDuration": 60` to `vercel.json` functions config (Pro plan); or respond immediately and process async (Hobby plan) |
| First request after idle takes 3–5 seconds | Cold start: Node.js runtime + module initialization | Move `new Stripe(...)` and `createClient(...)` to module level outside handler (see §6.3) |
| Preview deployment calls production Stripe/Supabase | `EXPO_PUBLIC_SECURE_PROXY_URL` set to production URL for all environments | Set `EXPO_PUBLIC_SECURE_PROXY_URL` as a separate value per environment (Production vs Preview) in Vercel dashboard |
| `sk_live_` key used in test/preview, real charges occurring | `STRIPE_SECRET_KEY` set to live key for Preview environment | In Vercel → **Settings** → **Environment Variables**, click `STRIPE_SECRET_KEY` → verify Preview shows `sk_test_*` not `sk_live_*` |
| `SUPABASE_SERVICE_ROLE_KEY` accessible in client-side React component | Variable was accidentally given `EXPO_PUBLIC_` prefix | Immediately rotate the key in Supabase → **Settings** → **API** → **Regenerate** service role key. Remove `EXPO_PUBLIC_` prefix in Vercel |
| `VERCEL_URL` is undefined in API route | `VERCEL_URL` cannot be added manually — it is a system variable | Remove any manually-added `VERCEL_URL` variable. It is auto-injected by Vercel on every deployment |
| New env var added to dashboard but still `undefined` | Variable was added after the current deployment was built | Trigger a redeployment (§7.2). Env vars are only available from the next deployment onward |
| Clerk webhook returns `400 Bad Request` | `CLERK_WEBHOOK_SECRET` is wrong or Svix headers missing from verification | Confirm secret starts with `whsec_`. Ensure all three Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`) are passed to `wh.verify()` |
| `vercel dev` does not load environment variables | `.env.local` file missing or variable names wrong | Run `vercel env pull .env.local` to sync Vercel Development variables to your local `.env.local` file |
| API route works in `vercel dev` but returns 500 on Vercel | Environment is Development locally but Production remotely; different keys | Confirm Production env vars are set. Check Vercel function logs (**Logs** tab → **Function**) for the exact error message |

---

## 10. Security Checklist

Work through this checklist before every production deployment.

### Secrets — Never In Client Bundle

- [ ] `STRIPE_SECRET_KEY` does NOT have `