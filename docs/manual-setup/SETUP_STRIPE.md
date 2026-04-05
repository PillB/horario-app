# SETUP_STRIPE.md

> **Scope:** Horario — Expo SDK 53 · React Native 0.79 · Expo Router v5 API routes · Vercel (Node.js runtime) · `@clerk/expo` v3 · Supabase RLS
>
> **Use Test mode** (toggle top-left of Stripe Dashboard) for all steps until the Go-Live Checklist.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1 — Create Products & Prices](#step-1--create-products--prices)
3. [Step 2 — Install and Initialize Stripe SDK](#step-2--install-and-initialize-stripe-sdk)
4. [Step 3 — Implement createCheckoutSession](#step-3--implement-createcheckoutsession)
5. [Step 4 — Webhook Setup](#step-4--webhook-setup)
6. [Step 5 — Billing Portal](#step-5--billing-portal)
7. [Step 6 — Idempotency & Error Handling](#step-6--idempotency--error-handling)
8. [Step 7 — Local Testing](#step-7--local-testing)
9. [Troubleshooting Table](#troubleshooting-table)
10. [Go-Live Checklist](#go-live-checklist)

---

## Prerequisites

### Stripe Account Requirements

1. **Email verification** — Stripe will not activate payouts until your email is confirmed. Check your inbox for the verification link immediately after signup.
2. **Bank account for payouts** — Required before any live charges can be settled. You add this under **Settings → Bank accounts and scheduling**.
3. **Identity verification** — Stripe requires a government-issued ID and business information before activating a live account. Allow 1–3 business days.

### Stripe Availability in Peru

> ⚠️ **CRITICAL — Read before choosing your legal entity:**

[Stripe is available in Peru as of 2023](https://stripe.com/global), but **only for businesses registered as a legal entity in Peru (e.g., SAC, SRL, E.I.R.L.) or in the United States.** Individual natural persons (`persona natural`) without a registered business cannot activate a Stripe live account. Verify current supported countries at [stripe.com/global](https://stripe.com/global).

**Options for Horario:**
- **Peruvian legal entity** — Register as `SAC` or `SRL` with SUNAT. Provide RUC number during Stripe onboarding.
- **US LLC** — If your founding team has US presence. Requires US EIN and US bank account.
- **Culqi** — For Peru-only payments (Yape, local cards), use the Culqi integration in `secure-proxy+api.ts`. Stripe and Culqi can coexist.

### Node.js Version Requirement

The Stripe Node.js SDK (`stripe` npm package v17+) requires **Node.js ≥ 18.0.0**.

Verify your local version:

```bash
node --version
# Must output v18.x.x or higher
```

Verify your Vercel function runtime in `vercel.json` or the project settings. Horario's `secure-proxy+api.ts` is already configured for Node.js runtime — confirm the Vercel **Functions** settings show Node.js 20.x (recommended) or 18.x.

✅ **Verify:** `node --version` returns `v18.0.0` or higher.

---

## Step 1 — Create Products & Prices

### 1.1 — Navigate to the Products Catalog

In the [Stripe Dashboard](https://dashboard.stripe.com):

1. Confirm **Test mode** is active (orange "Test mode" badge in the top-left header).
2. In the left sidebar, click **Product catalog**.
3. Click **+ Add product** (top-right button).

> **2025 Dashboard note:** The legacy **Products** menu item was renamed to **Product catalog** in late 2024. If you see **Products** instead, it's the same destination. [Source](https://docs.stripe.com/products-prices/manage-prices).

✅ **Verify:** The URL is `https://dashboard.stripe.com/test/products/create`.

---

### 1.2 — Create the Starter Product

Fill in the form exactly as follows:

| Field | Value |
|---|---|
| **Name** | `Horario Starter` |
| **Description** | `Scheduling para un local — hasta 25 trabajadores, WhatsApp notifications` |
| **Image** | Optional — upload Horario logo (PNG, min 100×100 px) |

Under **Pricing**, set the first price:

| Field | Value |
|---|---|
| **Pricing model** | Standard pricing |
| **Price** | `19.00` |
| **Currency** | `USD` |
| **Billing period** | `Monthly` |

Click **Add another price** and set:

| Field | Value |
|---|---|
| **Pricing model** | Standard pricing |
| **Price** | `182.40` |
| **Currency** | `USD` |
| **Billing period** | `Yearly` |

Click **Save product**.

✅ **Verify:** The product page shows two prices: `$19.00 / month` and `$182.40 / year`. Both display a `price_` ID under each price row.

---

### 1.3 — Create the Growth Product

Click **+ Add product** again:

| Field | Value |
|---|---|
| **Name** | `Horario Growth` |
| **Description** | `Multisede — hasta 3 locales, 50 trabajadores, IA optimization` |

Prices:

| Interval | Amount |
|---|---|
| Monthly | `$39.00 USD` |
| Yearly | `$374.40 USD` |

Click **Save product**.

✅ **Verify:** Product page shows `$39.00 / month` and `$374.40 / year`.

---

### 1.4 — Create the Pro Product

| Field | Value |
|---|---|
| **Name** | `Horario Pro` |
| **Description** | `Compliance total — locales y trabajadores ilimitados, motor laboral` |

Prices:

| Interval | Amount |
|---|---|
| Monthly | `$79.00 USD` |
| Yearly | `$758.40 USD` |

Click **Save product**.

✅ **Verify:** Product page shows `$79.00 / month` and `$758.40 / year`.

---

### 1.5 — Copy All Price IDs

For each product, click the product name → locate each price row → click the **copy icon** next to the `price_xxxx` ID (it appears when you hover over the ID).

Record them as follows:

```bash
# .env.local (development — TEST MODE IDs only)
STRIPE_STARTER_MONTHLY_PRICE_ID=price_xxxx   # $19.00/mo
STRIPE_STARTER_ANNUAL_PRICE_ID=price_xxxx    # $182.40/yr
STRIPE_GROWTH_MONTHLY_PRICE_ID=price_xxxx    # $39.00/mo
STRIPE_GROWTH_ANNUAL_PRICE_ID=price_xxxx     # $374.40/yr
STRIPE_PRO_MONTHLY_PRICE_ID=price_xxxx       # $79.00/mo
STRIPE_PRO_ANNUAL_PRICE_ID=price_xxxx        # $758.40/yr
```

> **Exact UI location:** Product detail page → **Pricing** section → each price row has an ID like `price_1RAbcDEfGhIjKlMn` with a clipboard icon to its right.

> See `docs/manual-setup/SETUP_VERCEL.md` for where to paste these in Vercel environment variables.

✅ **Verify:** Each `price_` ID starts with `price_` and is distinct. Confirm all six are saved before proceeding.

---

> ⚠️ **GOTCHA: Price IDs are environment-specific — test IDs ≠ live IDs**
>
> Every `price_xxxx` ID you created in **Test mode** is **different** from the ID that will be generated when you create the same products in **Live mode**. They are not interchangeable.
>
> **Fix:**
> - Use the IDs from **Test mode** in `.env.local` and in Vercel's **Preview** environment.
> - After completing the [Go-Live Checklist](#go-live-checklist), switch the Stripe Dashboard to **Live mode**, recreate all products/prices, and save the new live `price_` IDs to Vercel's **Production** environment separately.
> - Never mix test and live price IDs — Stripe will return `No such price: 'price_xxx'` if you use a test ID against the live API key.
>
> [Source — Stripe Docs: Test and live modes](https://docs.stripe.com/keys#test-live-modes)

---

### 1.6 — Price ID Reference Table

| Variable | Tier | Interval | Amount |
|---|---|---|---|
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | Starter | Monthly | $19.00 |
| `STRIPE_STARTER_ANNUAL_PRICE_ID` | Starter | Annual | $182.40 |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID` | Growth | Monthly | $39.00 |
| `STRIPE_GROWTH_ANNUAL_PRICE_ID` | Growth | Annual | $374.40 |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | Pro | Monthly | $79.00 |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Pro | Annual | $758.40 |

---

### Troubleshooting — Step 1

| Symptom | Cause | Fix |
|---|---|---|
| "No such price" error at runtime | Using test `price_` ID with live secret key (or vice versa) | Ensure `STRIPE_SECRET_KEY` and all `price_` IDs are from the same Stripe mode |
| Can't find "Product catalog" in sidebar | Dashboard UI updated; legacy label was "Products" | Look for **Product catalog** or use direct URL `https://dashboard.stripe.com/test/products` |
| Price ID clipboard icon not visible | You're hovering over the product name, not the price row | Scroll to the **Pricing** section within the product detail page and hover each price row |

---

## Step 2 — Install and Initialize Stripe SDK

### 2.1 — Install the Package

From the root of your Horario project:

```bash
npm install stripe
```

✅ **Verify:** `package.json` shows `"stripe": "^17.x.x"` (or current latest) in `dependencies`. Run `npm ls stripe` to confirm no duplicate versions.

---

### 2.2 — Current API Version

As of June 2025, the latest Stripe API version is **`2025-05-28.basil`**. Always use the latest version available at install time — check [stripe.com/docs/api/versioning](https://docs.stripe.com/api/versioning) for the current string.

```typescript
// The apiVersion string to use in initialization:
{ apiVersion: '2025-05-28.basil' }
```

> **Note:** The API version string is pinned at SDK initialization. It does not auto-update when you upgrade the npm package. Update it manually after reading the [Stripe changelog](https://docs.stripe.com/changelog).

---

### 2.3 — Initialize Stripe in `secure-proxy+api.ts`

The Stripe client **must only be instantiated inside the API route file**, never in any file that is imported by client-side code (screens, components, hooks).

```typescript
// app/api/secure-proxy+api.ts

// ✅ CORRECT: Top-level import in an API route file (+api.ts suffix)
// This file is NEVER bundled into the Expo/React Native client.
import Stripe from 'stripe';

// Guard: fail loudly if this code somehow runs client-side
if (typeof window !== 'undefined') {
  throw new Error(
    '[secure-proxy] Stripe SDK was imported in a browser/RN context. ' +
    'This file must only run server-side. Check your import graph.'
  );
}

// Single shared instance — Vercel functions are stateless but this pattern
// avoids re-initializing on every request within a warm invocation.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-05-28.basil',
  // typescript: { alwaysIncludeTypes: true }, // optional, for full type inference
});
```

✅ **Verify:** Run `npx expo export` (or `eas build --platform android --profile preview`). The build must complete with no error mentioning `stripe` or `crypto` in the bundle output. If you see a Metro bundler error about `crypto` or `net` modules, the Stripe SDK has leaked into the client bundle — see the GOTCHA below.

---

> ⚠️ **GOTCHA: Stripe SDK imported in client-side code causes Metro bundler crash**
>
> **Symptom:** Metro throws `Unable to resolve module 'crypto'` or `Unable to resolve module 'net'` during `expo start` or `eas build`.
>
> **Cause:** The `stripe` npm package uses Node.js built-in modules (`crypto`, `net`, `tls`, `http`) that do not exist in React Native's JavaScript engine (Hermes). If any file in your screen/component tree imports from a module that eventually `import`s `stripe`, Metro will fail.
>
> **Fix:**
>
> 1. **Never import `stripe` outside of `+api.ts` files.** Expo Router's `+api.ts` convention is explicitly excluded from the client bundle. Verify your import graph with:
>
> ```bash
> npx expo-dependency-graph app/api/secure-proxy+api.ts
> # Confirm 'stripe' only appears under the +api.ts node, never under screens/
> ```
>
> 2. If you have a shared `lib/stripe.ts` utility file, **do not import it from any screen, hook, or component.** Only import it from `+api.ts` files.
>
> 3. Add a `package.json` `browser` field override as a final safety net:
>
> ```json
> // package.json — prevents Metro from bundling stripe into the client
> {
>   "browser": {
>     "stripe": false
>   }
> }
> ```
>
> 4. The `typeof window !== 'undefined'` guard at the top of `secure-proxy+api.ts` provides a runtime safety net but does **not** prevent the bundler crash — fix the import graph first.
>
> [Source — Expo Router API Routes docs](https://docs.expo.dev/router/reference/api-routes/) · [Metro bundler Node.js polyfills](https://metrobundler.dev/docs/configuration/#resolver-options)

---

### Troubleshooting — Step 2

| Symptom | Cause | Fix |
|---|---|---|
| `Unable to resolve module 'crypto'` in Metro | `stripe` imported in client bundle | Check import graph; ensure `stripe` is only in `+api.ts` files |
| `TypeError: stripe is not a function` at runtime | Default import used incorrectly with some bundler configs | Use `import Stripe from 'stripe'` (capital S, default import) |
| `Error: No API key provided` | `STRIPE_SECRET_KEY` not set in Vercel env or `.env.local` | Add `STRIPE_SECRET_KEY=sk_test_xxx` to `.env.local` and Vercel dashboard |
| TypeScript: `Cannot find module 'stripe'` | Types not installed | Run `npm install stripe` — the package ships its own types since v10 |

---

## Step 3 — Implement createCheckoutSession

### 3.1 — Price ID Lookup Helper

Add this helper at the top of `secure-proxy+api.ts` (after the Stripe initialization):

```typescript
// app/api/secure-proxy+api.ts

type Tier = 'starter' | 'growth' | 'pro';
type BillingInterval = 'month' | 'year';

function getPriceId(tier: Tier, interval: BillingInterval): string {
  const map: Record<Tier, Record<BillingInterval, string>> = {
    starter: {
      month: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID!,
      year:  process.env.STRIPE_STARTER_ANNUAL_PRICE_ID!,
    },
    growth: {
      month: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID!,
      year:  process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID!,
    },
    pro: {
      month: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
      year:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID!,
    },
  };

  const priceId = map[tier]?.[interval];
  if (!priceId) {
    throw new Error(`No price ID configured for tier="${tier}" interval="${interval}"`);
  }
  return priceId;
}
```

---

### 3.2 — Complete `createCheckoutSession` Implementation

```typescript
// app/api/secure-proxy+api.ts
// Inside your POST handler, within the switch(action) block:

case 'createCheckoutSession': {
  const {
    accountId,       // Horario account ID (your internal ID, stored in Supabase)
    tier,            // 'starter' | 'growth' | 'pro'
    billingInterval, // 'month' | 'year'
    successUrl,      // Deep link back to app, e.g. horario://billing/success
    cancelUrl,       // Deep link back to app, e.g. horario://billing/cancel
    stripeCustomerId, // Optional: existing Stripe customer ID (from Supabase)
  } = body as {
    accountId: string;
    tier: Tier;
    billingInterval: BillingInterval;
    successUrl: string;
    cancelUrl: string;
    stripeCustomerId?: string;
  };

  if (!accountId || !tier || !billingInterval || !successUrl || !cancelUrl) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const priceId = getPriceId(tier, billingInterval);

  // Build session params
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',

    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],

    // {CHECKOUT_SESSION_ID} is a Stripe template literal — NOT a JS template literal.
    // Stripe replaces it server-side after the session is created.
    // Do NOT use backticks here — use single quotes.
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,

    // Links this checkout to your internal account ID.
    // Available in webhook events as event.data.object.client_reference_id
    client_reference_id: accountId,

    // Idempotency is handled via idempotency keys (see Step 6),
    // but client_reference_id also helps detect duplicate completions.

    // Pre-fill email if available from Clerk
    // customer_email: clerkUser.emailAddresses[0].emailAddress,

    // Subscription data: store tier in metadata for webhook handler
    subscription_data: {
      metadata: {
        accountId,
        tier,
        billingInterval,
      },
    },

    // Allow promotion codes (coupon codes entered by the user)
    allow_promotion_codes: true,

    // Automatic tax calculation (requires tax settings configured in Stripe)
    // automatic_tax: { enabled: true },
  };

  // Re-use existing Stripe customer to preserve billing history
  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    return Response.json({ error: 'Failed to create checkout session URL' }, { status: 500 });
  }

  return Response.json({ checkoutUrl: session.url });
}
```

✅ **Verify:** Call the endpoint with the test `curl` command below and confirm you receive a `checkoutUrl` starting with `https://checkout.stripe.com/c/pay/`:

```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/secure-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_JWT" \
  -d '{
    "action": "createCheckoutSession",
    "accountId": "test-account-001",
    "tier": "starter",
    "billingInterval": "month",
    "successUrl": "horario://billing/success",
    "cancelUrl": "horario://billing/cancel"
  }'
```

Expected: `{ "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_..." }`

---

### 3.3 — Opening Checkout in the Mobile App

Stripe Checkout runs in a browser. On mobile, open the `checkoutUrl` using `expo-web-browser`, not a `WebView` component.

```typescript
// hooks/useStripeCheckout.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

export async function openStripeCheckout(checkoutUrl: string): Promise<void> {
  const result = await WebBrowser.openAuthSessionAsync(
    checkoutUrl,
    // Redirect scheme that matches your success_url deep link
    Linking.createURL('billing/success'),
  );

  if (result.type === 'success') {
    // The user completed checkout. The webhook will handle DB updates.
    // Optionally parse result.url to extract session_id:
    const url = new URL(result.url);
    const sessionId = url.searchParams.get('session_id');
    console.log('Checkout complete, session:', sessionId);
    // Navigate to a "processing" screen — wait for webhook to confirm
  } else if (result.type === 'cancel') {
    // User closed the browser without completing checkout
    console.log('Checkout cancelled');
  }
}
```

In `app.json`, ensure your deep link scheme is registered:

```json
{
  "expo": {
    "scheme": "horario"
  }
}
```

✅ **Verify:** Tapping "Upgrade" in the app opens the Stripe-hosted checkout page in the system browser (Safari on iOS, Chrome on Android). The app resumes after completion or cancellation.

---

> ⚠️ **GOTCHA: Stripe Checkout in a `<WebView>` component does NOT work reliably**
>
> **Symptom:** The checkout page loads but card input fails, 3D Secure authentication hangs, or the page redirects to a broken blank screen.
>
> **Cause:** Stripe Checkout and Stripe.js rely on browser APIs, cross-origin iframes (for 3D Secure), and cookie-based state that React Native's `WebView` component does not fully support. Stripe explicitly [does not support embedded WebViews](https://support.stripe.com/questions/stripe-checkout-in-a-webview).
>
> **Fix:** Always use `expo-web-browser` (`WebBrowser.openAuthSessionAsync`). This opens the system browser (not a WebView), which has full cookie and iframe support. Use `openAuthSessionAsync` (not `openBrowserAsync`) so the app can intercept the deep-link redirect when Stripe redirects back to `horario://billing/success`.
>
> Install if not already present:
>
> ```bash
> npx expo install expo-web-browser expo-linking
> ```
>
> [Source — Stripe support: WebViews](https://support.stripe.com/questions/stripe-checkout-in-a-webview) · [Expo WebBrowser docs](https://docs.expo.dev/versions/latest/sdk/webbrowser/)

---

### Troubleshooting — Step 3

| Symptom | Cause | Fix |
|---|---|---|
| `No such price: 'price_xxx'` from Stripe API | Test price ID used with live secret key | Ensure all env vars are from the same Stripe mode |
| `checkoutUrl` received but browser shows error page | `success_url` or `cancel_url` is not a valid absolute URL | Both URLs must be absolute; deep links like `horario://` are valid |
| App doesn't resume after checkout | Deep link scheme not registered in `app.json` | Add `"scheme": "horario"` to `app.json` and rebuild |
| `{CHECKOUT_SESSION_ID}` appears literally in success URL | Used JS template literal (backticks) instead of string literal | Use single-quoted string: `successUrl + '?session_id={CHECKOUT_SESSION_ID}'` |
| 3D Secure hangs in WebView | WebView doesn't support cross-origin iframes | Switch to `expo-web-browser` (see GOTCHA above) |

---

## Step 4 — Webhook Setup

> **This is the highest-failure-risk section of the Stripe integration.** Read every GOTCHA before writing any code.

### 4.1 — Create the Webhook Endpoint in Stripe Dashboard

1. In the [Stripe Dashboard](https://dashboard.stripe.com), confirm **Test mode** is active.
2. In the left sidebar, click **Developers**.
3. Click **Webhooks**.
4. Click **+ Add endpoint** (top-right).
5. In **Endpoint URL**, enter:

```
https://YOUR-DOMAIN.vercel.app/api/secure-proxy
```

> Replace `YOUR-DOMAIN` with your actual Vercel deployment domain (e.g., `horario-app.vercel.app`).

6. Under **Select events to listen to**, click **+ Select events** and add exactly these events:

| Event | Trigger |
|---|---|
| `checkout.session.completed` | User completes checkout |
| `customer.subscription.created` | New subscription activated |
| `customer.subscription.updated` | Plan changed, trial ended, etc. |
| `customer.subscription.deleted` | Subscription cancelled |
| `invoice.payment_succeeded` | Recurring payment collected |
| `invoice.payment_failed` | Payment declined or card expired |
| `invoice.payment_action_required` | 3D Secure required for renewal |
| `customer.updated` | Customer email/metadata changed |

7. Click **Add endpoint**.
8. On the endpoint detail page, click **Reveal** next to **Signing secret**.
9. Copy the `whsec_...` value → save as `STRIPE_WEBHOOK_SECRET` in `.env.local` and Vercel.

✅ **Verify:** The endpoint appears in the Webhooks list with status **Enabled**. The signing secret starts with `whsec_`.

---

### 4.2 — Force Node.js Runtime (Critical)

At the very top of `app/api/secure-proxy+api.ts`, before any imports:

```typescript
// app/api/secure-proxy+api.ts
// MUST be the first line — before imports
export const runtime = 'nodejs';
```

✅ **Verify:** After deploying to Vercel, open **Vercel Dashboard → your project → Functions** tab. Find the `secure-proxy` function and confirm the runtime column shows **Node.js**, not **Edge**.

---

> ⚠️ **GOTCHA: Edge Runtime silently corrupts the webhook body, causing signature verification to always fail in production**
>
> **Symptom:** `stripe.webhooks.constructEvent()` throws `No signatures found matching the expected signature for payload` only in production (Vercel), but works fine with `stripe listen` locally.
>
> **Cause:** The Vercel Edge Runtime may re-encode or buffer the HTTP request body during proxying, altering the byte stream. Stripe's HMAC-SHA256 signature is computed over the **exact raw bytes** of the body. Any transformation — even invisible whitespace normalization — invalidates the signature. Expo Router v5 API routes can default to Edge on Vercel without an explicit runtime declaration.
>
> **Fix:** `export const runtime = 'nodejs'` at the top of the file (shown above). This is not optional.
>
> [Source](https://webhooks.cc/blog/nextjs-app-router-webhook-handler) · [Source](https://github.com/vercel/next.js/issues/60002)

---

### 4.3 — Reading the Raw Body Correctly

```typescript
// app/api/secure-proxy+api.ts
// Inside your POST handler, BEFORE any switch(action) logic:

// ✅ CORRECT: request.text() returns the raw string without any parsing
const rawBody = await request.text();

// Parse JSON separately for non-webhook actions
let body: Record<string, unknown>;
try {
  body = JSON.parse(rawBody);
} catch {
  return Response.json({ error: 'Invalid JSON' }, { status: 400 });
}

const action = body.action as string;
```

---

> ⚠️ **GOTCHA: Using `request.json()` destroys the raw body needed for webhook verification**
>
> **Symptom:** `constructEvent()` throws `Webhook signature verification failed` even with the correct signing secret.
>
> **Cause:** `await request.json()` consumes the body stream and returns a parsed JavaScript object. The original byte stream is gone. Stripe's `constructEvent()` requires the **original raw string or Buffer** — not a re-serialized object. Even `JSON.stringify(parsedBody)` will not restore the exact original bytes (key order, whitespace, encoding may differ).
>
> **Fix:** Always use `await request.text()` to read the body once, then parse it manually with `JSON.parse()`.
>
> ```typescript
> // ❌ WRONG — destroys raw body
> const body = await request.json();
>
> // ✅ CORRECT — preserves raw body for signature verification
> const rawBody = await request.text();
> const body = JSON.parse(rawBody);
> ```
>
> [Source](https://github.com/vercel/next.js/discussions/48885) · [Source](https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function)

---

### 4.4 — Complete Webhook Handler Implementation

```typescript
// app/api/secure-proxy+api.ts
// Inside the switch(action) block:

case 'stripeWebhook': {
  // The stripe-signature header uses the Web API — NOT req.headers['stripe-signature']
  const stripeSignature = request.headers.get('stripe-signature');

  if (!stripeSignature) {
    console.error('[stripe-webhook] Missing stripe-signature header');
    return Response.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,                                    // raw string from request.text()
      stripeSignature,                            // from request.headers.get(...)
      process.env.STRIPE_WEBHOOK_SECRET!,         // whsec_... from Dashboard
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[stripe-webhook] Signature verification failed:', message);
    // Return 400 so Stripe retries — do NOT return 200 on verification failure
    return Response.json({ error: `Webhook signature failed: ${message}` }, { status: 400 });
  }

  console.log('[stripe-webhook] Verified event:', event.type, event.id);

  // Idempotency: check if we've already processed this event
  // (Stripe may deliver the same event multiple times)
  const { data: existingEvent } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .single();

  if (existingEvent) {
    console.log('[stripe-webhook] Duplicate event, skipping:', event.id);
    return Response.json({ received: true, duplicate: true });
  }

  // Record event before processing (prevents double-processing on crash)
  await supabase.from('stripe_events').insert({ stripe_event_id: event.id, type: event.type });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId = session.client_reference_id;
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        if (!accountId) {
          throw new Error('checkout.session.completed missing client_reference_id');
        }

        // Retrieve the full subscription to get the price/tier
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0].price.id;
        const tier = subscription.metadata.tier ?? resolveTierFromPriceId(priceId);
        const interval = subscription.items.data[0].price.recurring?.interval ?? 'month';

        // Update Supabase: store Stripe customer and subscription IDs
        await supabase
          .from('accounts')
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_tier: tier,
            subscription_status: 'active',
            billing_interval: interval,
          })
          .eq('id', accountId);

        // Update Clerk public metadata
        await clerkClient.users.updateUserMetadata(/* userId from accountId */, {
          publicMetadata: { tier, subscriptionStatus: 'active' },
        });

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = subscription.metadata.accountId;
        const tier = subscription.metadata.tier;
        const status = subscription.status; // 'active' | 'past_due' | 'canceled' | etc.

        await supabase
          .from('accounts')
          .update({ subscription_status: status, subscription_tier: tier })
          .eq('stripe_subscription_id', subscription.id);

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        await supabase
          .from('accounts')
          .update({
            subscription_status: 'canceled',
            subscription_tier: 'free',
          })
          .eq('stripe_subscription_id', subscription.id);

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        await supabase
          .from('accounts')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_subscription_id', subscriptionId);

        // TODO: trigger dunning email via Resend/SendGrid
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        // Reset past_due status on successful renewal
        await supabase
          .from('accounts')
          .update({ subscription_status: 'active' })
          .eq('stripe_subscription_id', subscriptionId);

        break;
      }

      default:
        console.log('[stripe-webhook] Unhandled event type:', event.type);
    }
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : 'Unknown';
    console.error('[stripe-webhook] Processing error:', message);
    // Return 500 so Stripe retries — do NOT swallow processing errors silently
    return Response.json({ error: 'Processing failed' }, { status: 500 });
  }

  // Always return 200 after successful verification + processing
  return Response.json({ received: true });
}
```

> **Return code discipline:**
> - `400` — Failed signature verification (do NOT return 200 — Stripe will not retry a 400)
> - `500` — DB or processing error (Stripe **will** retry)
> - `200` — Everything succeeded

✅ **Verify:** Using the Stripe CLI (see Step 7), trigger a `checkout.session.completed` event and confirm the function logs show `[stripe-webhook] Verified event: checkout.session.completed` and the Supabase `accounts` table updates accordingly.

---

> ⚠️ **GOTCHA: `request.headers.get("stripe-signature")` vs `req.headers["stripe-signature"]`**
>
> **Symptom:** `stripeSignature` is `null` even though Stripe is sending the header. `constructEvent()` throws `No signatures found`.
>
> **Cause:** Expo Router v5 API routes use the [Web `Request` API](https://developer.mozilla.org/en-US/docs/Web/API/Request), not Node.js's `IncomingMessage`. The `headers` property is a [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) object. Bracket notation (`headers["stripe-signature"]`) always returns `undefined` on a `Headers` object.
>
> **Fix:** Use the `.get()` method:
>
> ```typescript
> // ❌ WRONG — always undefined with Web API Headers
> const sig = request.headers['stripe-signature'];
>
> // ✅ CORRECT — Web API Headers method
> const sig = request.headers.get('stripe-signature');
> ```
>
> [Source](https://github.com/vercel/next.js/issues/49739)

---

> ⚠️ **GOTCHA: Webhook signing secret mismatch — Test vs. Live, and CLI vs. Dashboard**
>
> **Symptom:** Signature verification works with `stripe listen` locally but always fails in production on Vercel.
>
> **Cause 1 — CLI secret ≠ Dashboard secret:** The `stripe listen` CLI generates a **temporary local** signing secret (printed in the terminal as `whsec_...`). This secret is **not** the same as the endpoint signing secret shown in the Stripe Dashboard. Using the CLI secret as `STRIPE_WEBHOOK_SECRET` in Vercel will always fail in production.
>
> **Cause 2 — Test secret used in Live mode:** The Dashboard generates a different `whsec_` for each endpoint, and test-mode endpoints have different secrets than live-mode endpoints.
>
> **Fix:** Use separate environment variables:
>
> ```bash
> # .env.local — use CLI secret ONLY for local testing
> STRIPE_WEBHOOK_SECRET=whsec_CLI_generated_secret_here
>
> # Vercel Preview environment — Dashboard TEST endpoint secret
> STRIPE_WEBHOOK_SECRET=whsec_test_dashboard_secret_here
>
> # Vercel Production environment — Dashboard LIVE endpoint secret
> STRIPE_WEBHOOK_SECRET=whsec_live_dashboard_secret_here
> ```
>
> In Vercel: **Project Settings → Environment Variables** → set different values per environment (Preview vs. Production).
>
> [Source](https://dev.to/nerdincode/debugging-stripe-webhook-signature-verification-errors-in-production-1h7c)

---

### 4.5 — Required Supabase Table for Idempotency

Create this table in your Supabase project to prevent duplicate webhook processing:

```sql
-- Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS stripe_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast duplicate checks
CREATE INDEX IF NOT EXISTS idx_stripe_events_stripe_event_id
  ON stripe_events (stripe_event_id);

-- RLS: only service role can insert/select (webhook handler uses service role key)
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
-- No public policies — service role bypasses RLS
```

✅ **Verify:** In Supabase Table Editor, confirm `stripe_events` table exists with columns `id`, `stripe_event_id`, `type`, `processed_at`.

---

### Troubleshooting — Step 4

| Symptom | Cause | Fix |
|---|---|---|
| `No signatures found matching the expected signature` in production | Edge runtime re-encodes body | Add `export const runtime = 'nodejs'` as first line of `+api.ts` |
| Same error locally | Using wrong signing secret (CLI vs Dashboard) | Use CLI-printed `whsec_` locally; use Dashboard endpoint `whsec_` in Vercel |
| `signature` is `null` | Using bracket notation on Web `Headers` API | Use `request.headers.get('stripe-signature')` |
| Webhook events processed twice | No idempotency check | Create `stripe_events` table and check for duplicate `event.id` before processing |
| Stripe shows endpoint as "Failed" (400) | Signature verification failed | Check runtime setting, signing secret, raw body method |
| Stripe shows endpoint as "Failed" (500) | DB error in processing | Check Vercel function logs for the specific Supabase error |
| Works locally, fails on Vercel | CLI secret used in Vercel env vars | Use the Dashboard endpoint's signing secret in Vercel |

---

## Step 5 — Billing Portal

### 5.1 — Configure the Portal in Stripe Dashboard

1. In the Stripe Dashboard, go to **Settings** (gear icon, bottom-left).
2. Click **Billing** → **Customer portal**.
3. Configure exactly:

| Setting | Value |
|---|---|
| **Cancel subscriptions** | ✅ Enabled |
| **Update payment method** | ✅ Enabled |
| **View billing history** | ✅ Enabled |
| **Update subscriptions** (plan switching) | ✅ Enabled (allows tier upgrades/downgrades) |
| **Pause subscriptions** | ❌ Disabled (not applicable for Horario) |
| **Return URL** | `https://YOUR-DOMAIN.vercel.app/billing` |

4. Click **Save**.

✅ **Verify:** The Customer portal page shows **Active** status and your return URL is saved. Navigate to `https://billing.stripe.com/test/...` — this confirms the portal is live in test mode.

---

### 5.2 — Create Customer on First Checkout

The billing portal requires a Stripe Customer object. Create one during the first checkout if the account doesn't already have a `stripe_customer_id`:

```typescript
// app/api/secure-proxy+api.ts
// Add to createCheckoutSession, before building sessionParams:

case 'createCheckoutSession': {
  // ... (body parsing as shown in Step 3)

  // Retrieve existing Stripe customer ID from Supabase
  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_customer_id')
    .eq('id', accountId)
    .single();

  let stripeCustomerId = account?.stripe_customer_id;

  // Create customer if none exists
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      metadata: { accountId },
      // Optionally pre-fill email from Clerk:
      // email: clerkUser.emailAddresses[0].emailAddress,
    });
    stripeCustomerId = customer.id;

    // Store immediately so it's available for future checkouts
    await supabase
      .from('accounts')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', accountId);
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: stripeCustomerId, // Always pass customer ID if available
    // ... rest of params from Step 3
  };
  // ...
}
```

---

### 5.3 — Create Billing Portal Session

```typescript
// app/api/secure-proxy+api.ts
// Inside the switch(action) block:

case 'createBillingPortalSession': {
  const { accountId } = body as { accountId: string };

  if (!accountId) {
    return Response.json({ error: 'Missing accountId' }, { status: 400 });
  }

  // Retrieve the Stripe customer ID for this account
  const { data: account, error: dbError } = await supabase
    .from('accounts')
    .select('stripe_customer_id')
    .eq('id', accountId)
    .single();

  if (dbError || !account?.stripe_customer_id) {
    return Response.json(
      { error: 'No Stripe customer found. User must complete checkout first.' },
      { status: 404 }
    );
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: `${process.env.APP_BASE_URL}/billing`, // e.g. https://horario-app.vercel.app/billing
  });

  return Response.json({ portalUrl: portalSession.url });
}
```

Open in the mobile app using the same `expo-web-browser` pattern as checkout:

```typescript
// In your billing screen component:
const { data } = await fetch('/api/secure-proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${clerkToken}` },
  body: JSON.stringify({ action: 'createBillingPortalSession', accountId }),
}).then(r => r.json());

await WebBrowser.openBrowserAsync(data.portalUrl);
```

✅ **Verify:** Calling the endpoint returns `{ "portalUrl": "https://billing.stripe.com/session/..." }`. Opening the URL shows the Stripe Customer Portal with the test account's subscription details.

---

> ⚠️ **GOTCHA: Billing Portal throws `No such customer` if called before first checkout**
>
> **Symptom:** `createBillingPortalSession` returns a Stripe error: `No such customer: 'cus_xxx'` or the Supabase query returns `null` for `stripe_customer_id`.
>
> **Cause:** The Stripe Customer object is only created during the first `createCheckoutSession` call (or webhook processing). If a user tries to access the portal before subscribing, there is no customer to link the portal to.
>
> **Fix:**
> 1. In the Billing screen, check `account.stripe_customer_id` before showing the "Manage Billing" button — hide it if null.
> 2. Return a clear 404 with a user-friendly message: "Complete a subscription first to access the billing portal."
> 3. Optionally create the customer eagerly on account creation (not required, but simplifies the portal flow).

---

### Troubleshooting — Step 5

| Symptom | Cause | Fix |
|---|---|---|
| `No such customer` error | Portal called before first checkout | Guard with `stripe_customer_id` null check; hide portal button for free users |
| Portal redirects to wrong URL | Return URL not saved in Dashboard | Confirm **Settings → Billing → Customer portal → Return URL** matches your domain |
| Portal shows wrong plan | Subscription metadata not set during checkout | Ensure `subscription_data.metadata` is set in `createCheckoutSession` |
| Portal URL expires immediately | Portal sessions expire after 5 minutes | Generate a fresh URL per request; do not cache portal URLs |

---

## Step 6 — Idempotency & Error Handling

### 6.1 — Using Idempotency Keys

Idempotency keys prevent duplicate subscriptions if a network error causes the client to retry a request. Pass a stable key based on the account ID and intent:

```typescript
// app/api/secure-proxy+api.ts
// When creating checkout sessions:

const session = await stripe.checkout.sessions.create(
  sessionParams,
  {
    // Idempotency key: account + tier + interval + date (prevents duplicate sessions
    // for the same upgrade within a 24-hour window)
    idempotencyKey: `checkout-${accountId}-${tier}-${billingInterval}-${new Date().toISOString().split('T')[0]}`,
  }
);
```

For other Stripe API calls:

```typescript
// Customer creation — idempotent per account
const customer = await stripe.customers.create(
  { metadata: { accountId } },
  { idempotencyKey: `customer-create-${accountId}` }
);
```

✅ **Verify:** Make the same `createCheckoutSession` API call twice within 24 hours for the same account/tier/interval. Both calls should return the **same** `checkoutUrl` (Stripe returns the same session for a repeated idempotency key). Check your Stripe Dashboard test event log — only one `checkout.session.created` event should appear.

---

### 6.2 — Stripe Error Code Handling

Handle these Stripe error codes explicitly in your API route:

```typescript
// app/api/secure-proxy+api.ts
// Wrap all stripe.* calls:

import Stripe from 'stripe';

function handleStripeError(err: unknown): Response {
  if (err instanceof Stripe.errors.StripeCardError) {
    // Card declined — show user-friendly message
    return Response.json({
      error: 'card_declined',
      message: err.message,
      declineCode: err.decline_code, // e.g. 'insufficient_funds', 'do_not_honor'
    }, { status: 402 });
  }

  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    // Invalid parameters — likely a bug in your code
    console.error('[stripe] Invalid request:', err.message, err.param);
    return Response.json({ error: 'invalid_request', message: err.message }, { status: 400 });
  }

  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    // Wrong API key
    console.error('[stripe] Authentication error — check STRIPE_SECRET_KEY');
    return Response.json({ error: 'auth_error' }, { status: 500 });
  }

  if (err instanceof Stripe.errors.StripeRateLimitError) {
    // Too many requests — retry with exponential backoff
    return Response.json({ error: 'rate_limit', retryAfter: 60 }, { status: 429 });
  }

  if (err instanceof Stripe.errors.StripeConnectionError) {
    // Network issue between Vercel and Stripe
    console.error('[stripe] Connection error:', err.message);
    return Response.json({ error: 'upstream_unavailable' }, { status: 503 });
  }

  // Unknown error
  console.error('[stripe] Unexpected error:', err);
  return Response.json({ error: 'internal_error' }, { status: 500 });
}

// Usage in your action handlers:
try {
  const session = await stripe.checkout.sessions.create(sessionParams);
  return Response.json({ checkoutUrl: session.url });
} catch (err) {
  return handleStripeError(err);
}
```

---

### 6.3 — Decline Codes to Handle Explicitly

| Decline Code | Meaning | User Message |
|---|---|---|
| `insufficient_funds` | Card has insufficient funds | "Tu tarjeta no tiene fondos suficientes." |
| `card_declined` | Generic decline | "Tu tarjeta fue rechazada. Intenta con otra." |
| `expired_card` | Card is expired | "Tu tarjeta ha expirado. Actualiza tu método de pago." |
| `incorrect_cvc` | Wrong CVC | "El código de seguridad es incorrecto." |
| `do_not_honor` | Issuer declined generically | "Tu banco rechazó el pago. Contacta a tu banco." |
| `authentication_required` | 3D Secure required | Automatically handled by Stripe Checkout's 3DS flow |
| `currency_not_supported` | Card doesn't support USD | "Tu tarjeta no acepta pagos en USD. Usa Culqi para pagar en PEN." |

---

### 6.4 — Failed Payment Recovery

When `invoice.payment_failed` is received in the webhook:

1. Update `accounts.subscription_status` to `'past_due'` (handled in Step 4.4).
2. Stripe automatically retries the invoice 3 times over 7 days (configurable in **Settings → Billing → Automatic collection**).
3. After max retries, Stripe sends `customer.subscription.deleted` — handle in webhook to downgrade to free tier.
4. Send a dunning email on first failure (implement via Resend or SendGrid in the `invoice.payment_failed` handler).

✅ **Verify:** Use `stripe trigger invoice.payment_failed` (see Step 7) and confirm `accounts.subscription_status` changes to `'past_due'` in Supabase.

---

### Troubleshooting — Step 6

| Symptom | Cause | Fix |
|---|---|---|
| Duplicate subscriptions in Stripe | No idempotency key on checkout session creation | Add `idempotencyKey` option to `stripe.checkout.sessions.create()` |
| `StripeAuthenticationError` | Wrong or missing `STRIPE_SECRET_KEY` | Verify env var is set and starts with `sk_test_` (test) or `sk_live_` (prod) |
| Subscription stays `past_due` after payment succeeds | `invoice.payment_succeeded` not handled | Add handler for `invoice.payment_succeeded` to reset status to `active` |
| User downgraded before max retries | Stripe's smart retries not configured | Check **Settings → Billing → Automatic collection** retry schedule |

---

## Step 7 — Local Testing

### 7.1 — Install the Stripe CLI

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows (Scoop)
scoop install stripe

# Linux
# Download from https://github.com/stripe/stripe-cli/releases/latest
# Then:
chmod +x stripe_linux_amd64
sudo mv stripe_linux_amd64 /usr/local/bin/stripe
```

✅ **Verify:** `stripe --version` outputs a version number (e.g., `stripe version 1.23.x`).

---

### 7.2 — Authenticate the CLI

```bash
stripe login
# Opens browser — log in with your Stripe account
# The CLI stores credentials at ~/.config/stripe/config.toml
```

✅ **Verify:** `stripe whoami` outputs your Stripe account email.

---

### 7.3 — Forward Webhooks to Local Development Server

```bash
# Start your Expo dev server first (in a separate terminal):
npx expo start

# In another terminal, forward Stripe webhooks to your local API:
stripe listen --forward-to http://localhost:8081/api/secure-proxy
```

The CLI prints:

```
> Ready! Your webhook signing secret is whsec_XXXXXXXXXXXXXXXX (^C to quit)
```

Copy this `whsec_` value and set it in `.env.local`:

```bash
# .env.local — ONLY for local development
STRIPE_WEBHOOK_SECRET=whsec_XXXXXXXXXXXXXXXX
```

> **This secret is different from your Dashboard endpoint secret.** Only use it locally.

✅ **Verify:** The terminal shows `Listening for Stripe events...`. Proceed to trigger a test event.

---

### 7.4 — Trigger Test Events

In a third terminal, trigger individual webhook events:

```bash
# Test full subscription lifecycle:
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted

# Test a specific payment failure scenario:
stripe trigger invoice.payment_failed --add invoice:billing_reason=subscription_cycle
```

✅ **Verify:** Each `stripe trigger` command results in a log line in the `stripe listen` terminal showing `[200]` (or your response code). Check your local logs for `[stripe-webhook] Verified event: ...`.

---

### 7.5 — Test Card Numbers

Use these cards in Stripe's test mode (any future expiry date, any CVC, any ZIP):

| Card Number | Scenario |
|---|---|
| `4242 4242 4242 4242` | ✅ Payment succeeds |
| `4000 0000 0000 0002` | ❌ Generic card declined |
| `4000 0000 0000 9995` | ❌ Insufficient funds |
| `4000 0000 0000 0069` | ❌ Expired card |
| `4000 0000 0000 0127` | ❌ Incorrect CVC |
| `4000 0025 0000 3155` | 🔐 Requires 3D Secure authentication |
| `4000 0000 0000 3220` | 🔐 3DS — authentication fails |
| `4000 0000 0000 0044` | ⏳ Card always declined after attaching |

For Peruvian test scenarios, use `4242 4242 4242 4242` with any billing address including Lima, Peru.

[Full test card reference](https://docs.stripe.com/testing#cards)

---

### 7.6 — Test the Full Checkout Flow

```bash
# 1. Create a checkout session via your API:
curl -X POST http://localhost:8081/api/secure-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_JWT" \
  -d '{
    "action": "createCheckoutSession",
    "accountId": "test-account-001",
    "tier": "starter",
    "billingInterval": "month",
    "successUrl": "horario://billing/success",
    "cancelUrl": "horario://billing/cancel"
  }'

# 2. Open the returned checkoutUrl in a browser
# 3. Use test card 4242 4242 4242 4242
# 4. Watch stripe listen terminal for checkout.session.completed event
# 5. Verify Supabase accounts table updated
```

✅ **Verify:** After completing test checkout, the `accounts` row in Supabase shows `subscription_tier = 'starter'`, `subscription_status = 'active'`, and a non-null `stripe_customer_id` and `stripe_subscription_id`.

---

### Troubleshooting — Step 7

| Symptom | Cause | Fix |
|---|---|---|
| `stripe: command not found` | CLI not installed or not in PATH | Follow install steps; run `which stripe` to confirm PATH |
| `stripe listen` shows `[400]` on every event | Wrong signing secret in `.env.local` | Copy the `whsec_` printed by `stripe listen` itself into `.env.local` |
| `stripe trigger` returns error | Not authenticated | Run `stripe login` |
| Local server not receiving events | Wrong port in `--forward-to` | Confirm Expo dev server port with `npx expo start` output |
| Webhook works locally but not in production | CLI secret used in Vercel | Use Dashboard endpoint secret in Vercel env vars |

---

## Troubleshooting Table

| Symptom | Cause | Fix |
|---|---|---|
| `No signatures found matching the expected signature` in production | Edge runtime re-encodes webhook body | Add `export const runtime = 'nodejs'` as first line of `secure-proxy+api.ts` |
| Signature error works locally, fails on Vercel | Using CLI signing secret in Vercel env var | Use the Dashboard webhook endpoint's `whsec_` in Vercel; CLI secret is local-only |
| `request.headers.get('stripe-signature')` returns `null` | Using bracket notation on Web API `Headers` object | Use `.get('stripe-signature')` method, not `headers['stripe-signature']` |
| `constructEvent` throws even with correct secret | Body was parsed with `.json()` before signature check | Use `await request.text()` to read raw body; parse JSON manually afterward |
| `No such price: 'price_xxx'` | Test price ID used with live secret key | Match mode: test keys with test price IDs, live keys with live price IDs |
| `No such customer: 'cus_xxx'` | Billing portal called before user has ever checked out | Check `stripe_customer_id` in DB; hide portal button for free/no-subscription users |
| Duplicate subscriptions created | Missing idempotency key on session creation | Add `idempotencyKey: \`checkout-${accountId}-${tier}-${date}\`` to session create call |
| Checkout page opens but card input fails | Checkout loaded in `WebView` component | Replace `WebView` with `expo-web-browser`'s `openAuthSessionAsync` |
| `Unable to resolve module 'crypto'` in Metro | `stripe` SDK imported in client-side code | Ensure `stripe` is only imported inside `+api.ts` files; never in screens or hooks |
| App doesn't return from Stripe Checkout | Deep link scheme not registered | Add `"scheme": "horario"` to `app.json` and rebuild the native app |
| Webhook events processed multiple times | No idempotency check in webhook handler | Create `stripe_events` table and skip already-processed `event.id` values |
| `invoice.payment_failed` not triggering | Missing event subscription in Dashboard | Go to **Developers → Webhooks → [endpoint]** and confirm `invoice.payment_failed` is listed |
| Vercel function timeout on webhook | DB operation taking too long | Move heavy processing to a Supabase Edge Function or background job; return 200 to Stripe quickly |
| `StripeAuthenticationError` | Wrong or expired API key | Verify `STRIPE_SECRET_KEY` in Vercel matches the active key in **Developers → API keys** |
| Billing portal returns user to wrong URL | Return URL not saved in portal settings | Set return URL in **Settings → Billing → Customer portal → Return URL** and save |
| Annual price shows wrong amount | Price created in wrong currency | Ensure both monthly and annual prices use `USD` currency |

---

## Go-Live Checklist

Complete every item before switching `STRIPE_SECRET_KEY` to a live key in Vercel Production.

- [ ] **Email verified** — Stripe account email confirmation email was clicked and account shows "Active" status.
- [ ] **Business entity confirmed** — Peruvian RUC or US EIN entered in Stripe account settings; identity verification approved.
- [ ] **Bank account connected** — Payout bank account added under **Settings → Bank accounts and scheduling**; first test payout initiated.
- [ ] **Live mode products created** — Switch Stripe Dashboard to **Live mode** and recreate all 3 products and 6 prices. Live `price_` IDs are different from test IDs.
- [ ] **Vercel Production env vars updated** — `STRIPE_SECRET_KEY` set to `sk_live_...`, all 6 `STRIPE_*_PRICE_ID` vars updated to live `price_` IDs.
- [ ] **Live webhook endpoint created** — In **Live mode** Dashboard, create a new webhook endpoint pointing to production URL. Copy live `whsec_` to `STRIPE_WEBHOOK_SECRET` in Vercel Production environment.
- [ ] **`export const runtime = 'nodejs'`** — Confirmed present as first line of `secure-proxy+api.ts`. Verified in Vercel Functions tab.
- [ ] **Raw body reading confirmed** — `await request.text()` is used (not `.json()`). Webhook signature verification tested end-to-end in staging.
- [ ] **`expo-web-browser` used for checkout** — No `WebView` components open Stripe URLs. `openAuthSessionAsync` tested on both iOS and Android physical devices.
- [ ] **Deep link scheme registered** — `"scheme": "horario"` in `app.json`. App returns from checkout on both platforms. `success_url` uses `{CHECKOUT_SESSION_ID}` placeholder.
- [ ] **Idempotency keys on all Stripe API calls** — `createCheckoutSession` and `stripe.customers.create` both pass `idempotencyKey`. Verified no duplicate sessions in test logs.
- [ ] **Webhook idempotency table active** — `stripe_events` table exists in Supabase with `UNIQUE` constraint on `stripe_event_id`. RLS enabled with no public policies.
- [ ] **All 8 webhook events handled** — `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.updated` — all update Supabase and Clerk metadata correctly.
- [ ] **Failed payment flow tested** — Used test card `4000 0000 0000 9995`; confirmed `subscription_status` changes to `past_due`; dunning email triggered.
- [ ] **Customer Portal configured in Live mode** — Return URL points to production domain. Cancel, update payment method, and view