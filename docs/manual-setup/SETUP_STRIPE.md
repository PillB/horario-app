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
11. [References](#references)

---

## Prerequisites

### Stripe Account Requirements

1. **Email verification** — Stripe will not activate payouts until your email is confirmed. Check your inbox for the verification link immediately after signup.
2. **Bank account for payouts** — Required before any live charges can be settled. Add this under **Settings → Bank accounts and scheduling**.
3. **Identity verification** — Stripe requires a government-issued ID and business information before activating a live account. Allow 1–3 business days.

### Stripe Availability in Peru

> ⚠️ **CRITICAL ARCHITECTURE DECISION — Read before choosing your payment gateway and legal entity.**

🔄 **UPDATED:** Peru is **not a supported country for Stripe merchant accounts** as of 2025. Despite some sources suggesting limited availability, Peru does not appear in Stripe's official supported-country list for merchant registration. Attempting to register a Peruvian business entity directly with Stripe will fail at the identity verification stage. (source: https://stripe.com/global)

**What this means for Horario:**

- You **cannot** create a Stripe merchant account as a Peru-registered business.
- Peruvian users **can pay** via Stripe if your account is registered in a supported country (US, EU, etc.) — international Visa/Mastercard cards work fine.
- Stripe has **no Yape, PEN (Peruvian Sol), or local Peruvian bank transfer support** under any configuration.
- Culqi is the correct local alternative: it supports Yape, Plin, local Peruvian cards, and charges approximately 3.44% + IGV for national cards/wallets and 3.99% + IGV for international cards.

**Your options for Horario:**

| Path | Requirements | Use Case |
|---|---|---|
| **US LLC** | US EIN, US bank account, US address | Recommended if founding team has any US presence |
| **Culqi (Peru)** | Peruvian RUC, local bank account | Peru-local payments: Yape, Plin, local cards, PEN pricing |
| **Both (recommended)** | US LLC for Stripe + RUC for Culqi | Full coverage: global cards via Stripe, local Peru via Culqi |

**Horario's two-gateway architecture is the correct approach.** Route payments based on the user's selected method:
- **Stripe**: International cards, users with US/EU billing addresses, USD-denominated global subscriptions.
- **Culqi** (via `secure-proxy+api.ts`): Peruvian cards, Yape wallet, PEN-denominated payments.

> Do **not** attempt to simulate Peruvian card behavior using Stripe test cards — Stripe's test card deck has no Peruvian BINs and will not reflect real Peruvian card declines or issuer behavior.

(source: https://www.linkedin.com/pulse/how-open-stripe-account-peru-mazino-oyolo-x3rqc) (source: https://www.rebill.com/en/blog/payment-gateways-peru)

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

> **2025 Dashboard note:** The legacy **Products** menu item was renamed to **Product catalog** in late 2024. If you see **Products** instead, it is the same destination. (source: https://docs.stripe.com/products-prices/manage-prices)

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
STRIPE_STARTER_MONTHLY_PRICE_ID=<YOUR_VALUE_HERE>   # $19.00/mo
STRIPE_STARTER_ANNUAL_PRICE_ID=<YOUR_VALUE_HERE>    # $182.40/yr
STRIPE_GROWTH_MONTHLY_PRICE_ID=<YOUR_VALUE_HERE>    # $39.00/mo
STRIPE_GROWTH_ANNUAL_PRICE_ID=<YOUR_VALUE_HERE>     # $374.40/yr
STRIPE_PRO_MONTHLY_PRICE_ID=<YOUR_VALUE_HERE>       # $79.00/mo
STRIPE_PRO_ANNUAL_PRICE_ID=<YOUR_VALUE_HERE>        # $758.40/yr
```

> **Exact UI location:** Product detail page → **Pricing** section → each price row has an ID like `price_1RAbcDEfGhIjKlMn` with a clipboard icon to its right.

> See `docs/manual-setup/SETUP_VERCEL.md` for where to paste these in Vercel environment variables.

✅ **Verify:** Each `price_` ID starts with `price_` and is distinct. Confirm all six are saved before proceeding.

---

> ⚠️ **GOTCHA: Price IDs are environment-specific — test IDs ≠ live IDs**
>
> Every `price_xxxx` ID you created in **Test mode** is **different** from the ID generated when you create the same products in **Live mode**. They are not interchangeable.
>
> **Fix:**
> - Use the IDs from **Test mode** in `.env.local` and in Vercel's **Preview** environment.
> - After completing the [Go-Live Checklist](#go-live-checklist), switch the Stripe Dashboard to **Live mode**, recreate all products/prices, and save the new live `price_` IDs to Vercel's **Production** environment separately.
> - Never mix test and live price IDs — Stripe will return `No such price: 'price_xxx'` if you use a test ID against the live API key.
>
> (source: https://docs.stripe.com/keys#test-live-modes)

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

| Symptom | Likely Cause | Fix | Source |
|---|---|---|---|
| "No such price" error at runtime | Using test `price_` ID with live secret key (or vice versa) | Ensure `STRIPE_SECRET_KEY` and all `price_` IDs are from the same Stripe mode | https://docs.stripe.com/keys#test-live-modes |
| Can't find "Product catalog" in sidebar | Dashboard UI updated; legacy label was "Products" | Look for **Product catalog** or use direct URL `https://dashboard.stripe.com/test/products` | https://docs.stripe.com/products-prices/manage-prices |
| Price ID clipboard icon not visible | Hovering over the product name, not the price row | Scroll to the **Pricing** section within the product detail page and hover each price row | https://docs.stripe.com/products-prices/manage-prices |

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

🔄 **UPDATED:** Stripe introduced a new versioning scheme in 2024 using a date + codename format (e.g., `2024-09-30.acacia`, `2025-05-28.basil`). Each SDK release is pinned to a specific API version. **Do not hardcode an old version string** such as `"2022-11-15"` — it causes TypeScript type errors with newer SDKs and means you miss security fixes and new features.

The recommended approach is to let the SDK use its own pinned version:

```typescript
// ✅ CORRECT — let the installed SDK pin the API version automatically
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ❌ AVOID — hardcoding a stale version string
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2022-11-15' as any,
});
```

If you must specify a version explicitly (e.g., for TypeScript type alignment), use the exact string from the `stripe` package's release notes for the version you have installed. As of mid-2025 the current version is `2025-05-28.basil` — always verify at [docs.stripe.com/api/versioning](https://docs.stripe.com/api/versioning).

> **Note:** The API version string does not auto-update when you upgrade the npm package. If you have hardcoded it, update it manually after reading the [Stripe changelog](https://docs.stripe.com/changelog).

(source: https://docs.stripe.com/api/versioning) (source: https://docs.stripe.com/sdks/versioning)

---

### 2.3 — Initialize Stripe in `secure-proxy+api.ts`

The Stripe client **must only be instantiated inside the API route file**, never in any file that is imported by client-side code (screens, components, hooks).

```typescript
// app/api/secure-proxy+api.ts

// MUST be the very first line — before any imports — forces Node.js runtime on Vercel.
// Without this, Vercel may run this function on the Edge runtime, which silently
// corrupts webhook bodies and breaks signature verification. See Gotcha below.
export const runtime = 'nodejs';

// ✅ CORRECT: Top-level import in an API route file (+api.ts suffix).
// This file is NEVER bundled into the Expo/React Native client.
import Stripe from 'stripe';

// Guard: fail loudly if this code somehow runs client-side
if (typeof window !== 'undefined') {
  throw new Error(
    '[secure-proxy] Stripe SDK was imported in a browser/RN context. ' +
    'This file must only run server-side. Check your import graph.'
  );
}

// Single shared instance — Vercel functions are stateless, but this pattern
// avoids re-initializing on every request within a warm invocation.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
// If you must pin the API version explicitly, match it to your installed SDK:
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-05-28.basil' });
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
> {
>   "browser": {
>     "stripe": false
>   }
> }
> ```
>
> 4. The `typeof window !== 'undefined'` guard at the top of `secure-proxy+api.ts` provides a runtime safety net but does **not** prevent the bundler crash — fix the import graph first.
>
> (source: https://docs.expo.dev/router/reference/api-routes/)

---

### Troubleshooting — Step 2

| Symptom | Likely Cause | Fix | Source |
|---|---|---|---|
| `Unable to resolve module 'crypto'` in Metro | `stripe` imported in client bundle | Check import graph; ensure `stripe` is only in `+api.ts` files | https://docs.expo.dev/router/reference/api-routes/ |
| `TypeError: stripe is not a function` at runtime | Default import used incorrectly | Use `import Stripe from 'stripe'` (capital S, default import) | https://github.com/stripe/stripe-node |
| `Error: No API key provided` | `STRIPE_SECRET_KEY` not set in Vercel env or `.env.local` | Add `STRIPE_SECRET_KEY=sk_test_<YOUR_VALUE_HERE>` to `.env.local` and Vercel dashboard | https://docs.stripe.com/keys |
| TypeScript: `Cannot find module 'stripe'` | Package not installed | Run `npm install stripe` — the package ships its own types since v10 | https://github.com/stripe/stripe-node |
| TypeScript errors with `apiVersion` string | Hardcoded stale version string | Remove explicit `apiVersion` or update it to the SDK-pinned version string | https://docs.stripe.com/api/versioning |

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
    accountId,        // Horario account ID (your internal ID, stored in Supabase)
    tier,             // 'starter' | 'growth' | 'pro'
    billingInterval,  // 'month' | 'year'
    successUrl,       // HTTPS URL on Vercel — Stripe does NOT accept myapp:// schemes here
    cancelUrl,        // HTTPS URL on Vercel — same restriction
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

    // IMPORTANT: {CHECKOUT_SESSION_ID} is a Stripe server-side template literal —
    // NOT a JavaScript template variable. Stripe replaces it after the session is
    // created and the customer is redirected. Do NOT interpolate this in JS.
    // See Gotcha below for the common mistake.
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,

    // Links this checkout to your internal account ID.
    // Available in webhook events as event.data.object.client_reference_id
    client_reference_id: accountId,

    // Subscription data: store tier in metadata for webhook handler
    subscription_data: {
      metadata: {
        accountId,
        tier,
        billingInterval,
      },
    },

    // Allow promotion codes entered by the user at checkout
    allow_promotion_codes: true,

    // Automatic tax calculation (requires tax settings configured in Stripe Dashboard)
    // automatic_tax: { enabled: true },
  };

  // Re-use existing Stripe customer to preserve billing history
  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId;
  }

  const session = await stripe.checkout.sessions.create(
    sessionParams,
    {
      // Idempotency key prevents duplicate sessions if the client retries.
      // Scoped to account + tier + interval + calendar day.
      idempotencyKey: `checkout-${accountId}-${tier}-${billingInterval}-${new Date().toISOString().split('T')[0]}`,
    }
  );

  if (!session.url) {
    return Response.json({ error: 'Failed to create checkout session URL' }, { status: 500 });
  }

  return Response.json({ checkoutUrl: session.url });
}
```

✅ **Verify:** Call the endpoint with the test `curl` command below and confirm you receive a `checkoutUrl` starting with `https://checkout.stripe.com/c/pay/`:

```bash
curl -X POST https://<YOUR_VALUE_HERE>.vercel.app/api/secure-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_VALUE_HERE>" \
  -d '{
    "action": "createCheckoutSession",
    "accountId": "test-account-001",
    "tier": "starter",
    "billingInterval": "month",
    "successUrl": "https://<YOUR_VALUE_HERE>.vercel.app/payment-success",
    "cancelUrl": "https://<YOUR_VALUE_HERE>.vercel.app/payment-cancel"
  }'
```

Expected response: `{ "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_..." }`

---

### 3.3 — `success_url` and `cancel_url` Must Be HTTPS

> ⚠️ **GOTCHA: Stripe Checkout `success_url` rejects `myapp://` custom URL schemes**
>
> **Symptom:** Stripe API returns a validation error when creating a checkout session if `success_url` or `cancel_url` contains a bare custom scheme like `myapp://payment-success`.
>
> **Cause:** Stripe Checkout only accepts `http://` and `https://` URLs for `success_url` and `cancel_url`. Custom mobile URL schemes are rejected at the API level. This is different from Stripe's mobile SDK (which has its own redirect handling) — Stripe's hosted Checkout page runs entirely in a browser and can only redirect to web URLs.
>
> **Fix:** Use one of two strategies:
>
> **Strategy A — Vercel intermediary page (simpler, recommended for Horario):**
> Set `success_url` to an HTTPS page on your Vercel deployment. That page immediately redirects the user back into the app via a custom scheme using JavaScript. On the server route at `/payment-success`, call `stripe.checkout.sessions.retrieve(sessionId)` to confirm the payment, then render a redirect:
>
> ```typescript
> // app/payment-success+api.ts (Vercel page or API route)
> // This page receives ?session_id={CHECKOUT_SESSION_ID} from Stripe
> export async function GET(request: Request) {
>   const url = new URL(request.url);
>   const sessionId = url.searchParams.get('session_id');
>   // Redirect into the app
>   return Response.redirect(`horario://billing/success?session_id=${sessionId}`, 302);
> }
> ```
>
> Pass the HTTPS URL when creating the session:
>
> ```typescript
> success_url: `https://<YOUR_VALUE_HERE>.vercel.app/payment-success?session_id={CHECKOUT_SESSION_ID}`,
> cancel_url:  `https://<YOUR_VALUE_HERE>.vercel.app/payment-cancel`,
> ```
>
> **Strategy B — Universal Links (iOS) / App Links (Android):**
> Configure your domain as a Universal Link so that `https://yourapp.com/payment-success` opens directly in your app rather than the browser. This requires additional native configuration beyond the scope of this document.
>
> (source: https://docs.stripe.com/mobile/digital-goods/checkout) (source: https://docs.stripe.com/payments/checkout/custom-success-page)

---

> ⚠️ **GOTCHA: `{CHECKOUT_SESSION_ID}` is a Stripe server-side template literal — not a JavaScript variable**
>
> **Symptom:** The `session_id` query parameter arrives at your `success_url` as the literal string `{CHECKOUT_SESSION_ID}` instead of a real session ID.
>
> **Cause:** `{CHECKOUT_SESSION_ID}` must appear as a **literal string** in the `success_url` you send to Stripe. Stripe replaces it server-side after the customer pays and is redirected. If you try to interpolate it in JavaScript at session-creation time (e.g., using backtick template literals), you are referencing a variable that does not yet exist.
>
> ```typescript
> // ✅ CORRECT — literal placeholder; Stripe fills it in after payment
> success_url: `https://yourapp.com/payment-success?session_id={CHECKOUT_SESSION_ID}`,
>
> // ❌ WRONG — session.id doesn't exist when creating the session
> success_url: `https://yourapp.com/payment-success?session_id=${session.id}`,
>
> // ❌ ALSO WRONG — double-interpolation garbles the literal
> const placeholder = '{CHECKOUT_SESSION_ID}';
> success_url: `https://yourapp.com/payment-success?session_id=${placeholder}`, // works, but fragile
> ```
>
> On your `/payment-success` page, read `session_id` from the URL query params and call `stripe.checkout.sessions.retrieve(sessionId)` to verify the payment server-side before granting access.
>
> (source: https://docs.stripe.com/payments/checkout/custom-success-page)

---

### 3.4 — Opening Checkout in the Mobile App

Stripe Checkout runs in a browser. On mobile, open the `checkoutUrl` using `expo-web-browser`, not a `WebView` component.

```typescript
// hooks/useStripeCheckout.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

export async function openStripeCheckout(checkoutUrl: string): Promise<void> {
  // The second argument to openAuthSessionAsync is the redirect URL your app
  // listens for — must match your Vercel intermediary page's redirect target.
  const redirectUrl = Linking.createURL('billing/success');

  const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, redirectUrl);

  if (result.type === 'success') {
    // The system browser intercepted the deep link redirect.
    // The webhook handles DB updates — navigate to a "processing" screen here.
    const parsed = Linking.parse(result.url);
    const sessionId = parsed.queryParams?.session_id as string | undefined;
    console.log('Checkout complete, session:', sessionId);
    // Navigate to a "processing" screen — do NOT grant access yet;
    // wait for the webhook to update subscription status in Supabase.
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

> ⚠️ **GOTCHA: `WebBrowser.openBrowserAsync()` cannot receive redirect data back from Stripe**
>
> **Symptom:** The browser opens and Stripe completes the flow, but the app never receives a callback or result object. The browser just closes.
>
> **Cause:** `WebBrowser.openBrowserAsync()` opens a one-way browser — it has no mechanism to detect or intercept a redirect back to your app. It returns only when the user manually closes the browser.
>
> **Fix:** Use `WebBrowser.openAuthSessionAsync(url, redirectUrl)` instead. This uses `ASWebAuthenticationSession` on iOS and Chrome Custom Tabs with an intent filter on Android — both actively watch for a redirect to `redirectUrl` and return control to your app with a typed result object.
>
> ```typescript
> // ❌ WRONG — one-way, no redirect interception
> await WebBrowser.openBrowserAsync(checkoutUrl);
>
> // ✅ CORRECT — intercepts redirect back to the app
> const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, Linking.createURL('billing/success'));
> ```
>
> Install if not already present:
>
> ```bash
> npx expo install expo-web-browser expo-linking
> ```
>
> (source: https://docs.expo.dev/versions/latest/sdk/webbrowser/) (source: https://dev.to/priyanshrastogi/accept-payments-in-universal-apps-with-stripe-checkout-jd8)

---

> ⚠️ **GOTCHA: Stripe Checkout in a `<WebView>` component does NOT work reliably**
>
> **Symptom:** The checkout page loads but card input fails, 3D Secure authentication hangs, or the page redirects to a blank screen.
>
> **Cause:** Stripe Checkout and Stripe.js rely on browser APIs, cross-origin i