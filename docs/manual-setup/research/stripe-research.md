Now I have comprehensive data. Let me compile the final structured report.I now have everything I need. Let me compile the comprehensive, structured report.

---

# 🔍 Stripe Integration Gotchas — Horario App (Expo SDK 53 + Vercel Serverless, 2024–2025)

---

## GOTCHA 1: Raw Body Destruction in Vercel/Next.js App Router Webhook Handler

**PROBLEM:**
Certain providers require access to the raw body inside the function to validate the signature from the request. In the Next.js/Expo Router App Router pattern on Vercel, the body is consumed by the framework before your code can read it. The `stripe.webhooks.constructEvent` function requires the raw, unparsed body — but when deployed on Vercel, some kind of processing happens to the `event.body`, meaning Stripe will not accept it. Specifically, using `await request.body()` instead of `await request.text()` is the root of the problem — Next.js (at least in the App Router) parses it automatically.

**FIX:**
Use `const rawBody = await request.text()` and return that directly to Stripe's verify call. The exact pattern for App Router is:

```ts
// app/api/stripe-webhook+api.ts  (Expo Router v5 API route)
export const runtime = "nodejs"; // ← CRITICAL, see Gotcha 2

export async function POST(request: Request) {
  const rawBody = await request.text(); // ← NOT .json(), NOT .body()
  const signature = request.headers.get("stripe-signature")!;
  const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  // ...
}
```

For the old Pages Router, export `export const config = { api: { bodyParser: false } }` and use the `micro` buffer helper.

**SOURCE:**
- <https://github.com/vercel/next.js/discussions/48885>
- <https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function>
- <https://webhooks.cc/blog/nextjs-app-router-webhook-handler>

---

## GOTCHA 2: Edge Runtime Silently Re-encodes the Webhook Body

**PROBLEM:**
If your webhook route runs on the Edge Runtime, some Vercel edge infrastructure may re-encode the request body during proxying, destroying the byte-level integrity that Stripe's HMAC signature check depends on. This means `constructEvent()` throws `No signatures found matching the expected signature` **only in production** (not locally with `stripe listen`), with no clear error message pointing to the runtime as the culprit.

**FIX:**
Force your webhook route to use the Node.js runtime by exporting `export const runtime = "nodejs"` at the top of the file. For Expo Router v5 API routes (`+api.ts` convention), this is especially important since Expo Router may default to Edge on Vercel without explicit declaration.

```ts
// app/api/stripe-webhook+api.ts
export const runtime = "nodejs"; // Prevents edge body re-encoding
```

**SOURCE:**
- <https://webhooks.cc/blog/nextjs-app-router-webhook-handler>
- <https://github.com/vercel/next.js/issues/60002>

---

## GOTCHA 3: `stripe-signature` Header Returns `undefined` in App Router

**PROBLEM:**
Stripe uses different webhook signing secrets for test mode and live mode. If signatures fail only in production (not locally), check the runtime first — then verify you're using the correct secret for each environment. A secondary issue found repeatedly in GitHub issues: `const stripeHeader = req.headers["stripe-signature"]` returns `undefined` always in the App Router because App Router uses the Web `Headers` API, not the Node.js `IncomingMessage` headers object.

**FIX:**
Use the Web API method:

```ts
const signature = request.headers.get("stripe-signature"); // ← Web API
// NOT: req.headers["stripe-signature"]  ← Node.js API style
```

Also ensure you're using the correct signing secret: `whsec_...` from the **Stripe Dashboard → Webhooks** (not the `stripe listen` CLI secret, which is different).

**SOURCE:**
- <https://github.com/vercel/next.js/issues/49739>
- <https://dev.to/nerdincode/debugging-stripe-webhook-signature-verification-errors-in-production-1h7c>

---

## GOTCHA 4: Webhook Signing Secret Mismatch — Test vs. Live Mode

**PROBLEM:**
Stripe signs test and live events with different secrets. If you mismatch them, signature verification will always fail — even if your code is perfect. This is an extremely common production failure that works fine locally. Additionally, the `stripe listen` CLI generates a **local** signing secret (starting with `whsec_`) that is **different** from the Dashboard endpoint secret — using the CLI secret in production always fails.

**FIX:**
Maintain separate environment variables in Vercel:
```bash
STRIPE_WEBHOOK_SECRET_TEST=whsec_test_xxxx   # from Dashboard test endpoint
STRIPE_WEBHOOK_SECRET_LIVE=whsec_live_xxxx   # from Dashboard live endpoint
```
Select the correct one based on `process.env.NODE_ENV` or `process.env.VERCEL_ENV`. Never use the `stripe listen` CLI secret in Vercel env vars.

**SOURCE:**
- <https://dev.to/nerdincode/debugging-stripe-webhook-signature-verification-errors-in-production-1h7c>
- <https://inventivehq.com/blog/stripe-webhooks-guide>

---

## GOTCHA 5: Duplicate Webhook Event Delivery — Must be Idempotent

**PROBLEM:**
Stripe will keep retrying for up to 3 days after a failed delivery. This means your webhook handler MUST be idempotent — you'll receive the same event multiple times if your handler fails. Vercel serverless functions can also time out mid-execution, causing Stripe to retry events that were partially processed (e.g., the database was updated but the confirmation email was not sent).

**FIX:**
Design your webhook handler to process events idempotently by checking for the event ID before processing: query your DB for the `stripe_event_id`, and if it already exists, return a `200` immediately without re-processing. The Stripe docs specifically recommend logging the event ID and checking before acting.

```ts
const existing = await supabase.from('stripe_events').select('id').eq('stripe_event_id', event.id).single();
if (existing.data) return new Response('Already processed', { status: 200 });
// ... process event, then insert event.id into stripe_events table
```

**SOURCE:**
- <https://docs.stripe.com/webhooks>
- <https://www.magicbell.com/blog/stripe-webhooks-guide>
- <https://medium.com/@sohail_saifii/handling-payment-webhooks-reliably-idempotency-retries-validation-69b762720bf5>

---

## GOTCHA 6: Webhook Replay Attack — 5-Minute Timestamp Tolerance

**PROBLEM:**
Stripe includes a timestamp in the `Stripe-Signature` header. Because this timestamp is part of the signed payload, it's also verified by the signature. The default tolerance is 5 minutes between the timestamp and the current time. If Vercel's cold-start delay + your processing time pushes past 5 minutes (extremely rare but possible in overloaded scenarios), or if your server clock is skewed, `constructEvent` will throw even for legitimate events.

**FIX:**
You can pass a custom tolerance (in seconds) to `constructEvent`. For Vercel serverless with occasional cold starts, 600 seconds (10 minutes) is a safer value — but **never set it to `0`** (disables protection):
```ts
stripe.webhooks.constructEvent(rawBody, sig, secret, 600); // 10-min tolerance
```
The default tolerance built into the Stripe SDK is 300 seconds (5 minutes).

**SOURCE:**
- <https://docs.stripe.com/webhooks>
- <https://deepwiki.com/stripe/stripe-dotnet/7-events-and-webhooks>

---

## GOTCHA 7: Stripe Checkout `success_url` — Cannot Use `myapp://` Custom Scheme Directly

**PROBLEM:**
Stripe's hosted Checkout page redirects the browser to `success_url` after payment. On mobile, you want this to deep-link back to your app. However, Stripe doesn't support custom URL schemes (e.g., `myapp://`) as the `success_url` directly — it only allows `http://` and `https://` URLs. Passing a bare `myapp://payment-success` as `success_url` will fail validation at the API level.

**FIX:**
Use one of two strategies:
1. **Universal Links (preferred for production):** Set a universal link as your `success_url` to direct your customer to your app after they complete the payment. Make sure to create a fallback page at your `success_url` in case the universal link fails. You can also define a custom URL scheme for your app and use it to link back as a fallback.
2. **Server-side page with redirect:** Set `success_url` to a Vercel page (e.g., `https://yourapp.vercel.app/payment-success?session_id={CHECKOUT_SESSION_ID}`), and that page immediately redirects with `window.location = "myapp://payment-success"` via JavaScript.

```ts
// On your Vercel API route creating the session:
const session = await stripe.checkout.sessions.create({
  success_url: `https://yourdomain.com/payment-success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `https://yourdomain.com/payment-cancel`,
  // ...
});
```

**SOURCE:**
- <https://docs.stripe.com/mobile/digital-goods/checkout>
- <https://docs.stripe.com/payments/checkout/custom-success-page>
- <https://github.com/invertase/stripe-firebase-extensions/issues/587>

---

## GOTCHA 8: Expo Router — `Linking.createURL()` vs. `urlScheme` for 3DS/Bank Redirect

**PROBLEM:**
If you're relying on redirects (3D Secure, bank redirects), you need to pass a `urlScheme` to `initStripe`. To ensure you always use the proper `urlScheme`, pass `Linking.createURL('/--/')` in Expo Go and `Linking.createURL('')` in production builds. A common bug: passing `urlScheme: Linking.createURL('')` produces `myapp://` which is **not a valid URL** to Stripe's redirect validator (it expects a full URL, not just a scheme root). In production standalone builds this is acceptable, but Expo Go returns `exp://192.168.x.x:19000` which has a different format.

**FIX:**
`Linking.createURL()` ensures you're using the proper scheme, whether you're running in Expo Go or your production app. The `/--/` segment is necessary in Expo Go because it indicates that the substring after it corresponds to the deep link path.

```ts
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';

<StripeProvider
  publishableKey={STRIPE_PK}
  urlScheme={
    Constants.appOwnership === 'expo'
      ? Linking.createURL('/--/')   // Expo Go
      : Linking.createURL('')       // Standalone/production build
  }
>
```

Also register a `Linking` event listener at your app root and call `handleURLCallback(url)` from `useStripe()` to handle the redirect back.

**SOURCE:**
- <https://docs.expo.dev/versions/latest/sdk/stripe/>
- <https://github.com/expo/expo/issues/16852>
- <https://github.com/stripe/stripe-react-native/issues/1813>

---

## GOTCHA 9: Expo Router + Stripe PaymentSheet 3DS Redirect — `handleURLCallback` Never Fires

**PROBLEM:**
When making a payment with Stripe that requires leaving the app (e.g., using iDeal or 3DS bank redirect), Stripe uses a `returnURL` to catch payment details. The Expo Router tries to handle the URL and intercepts it before `handleURLCallback` can process it, causing the payment to appear stuck or never complete. This is a documented open issue with Expo Router v3+ where the file-based router's `Linking` configuration conflicts with Stripe's URL handler.

**FIX:**
Place `handleURLCallback` logic in the **root layout** (`app/_layout.tsx`) with a `useEffect` that runs before Expo Router processes the URL, using `Linking.addEventListener`:

```ts
// app/_layout.tsx
const { handleURLCallback } = useStripe();
useEffect(() => {
  const sub = Linking.addEventListener('url', async ({ url }) => {
    await handleURLCallback(url);
  });
  Linking.getInitialURL().then(url => { if (url) handleURLCallback(url); });
  return () => sub.remove();
}, [handleURLCallback]);
```

**SOURCE:**
- <https://github.com/expo/expo/issues/27179>
- <https://github.com/stripe/stripe-react-native/issues/1813>

---

## GOTCHA 10: `WebBrowser.openBrowserAsync()` vs. `openAuthSessionAsync()` for Checkout Redirect

**PROBLEM:**
When opening Stripe's hosted Checkout in an in-app browser (for billing portal or Checkout page via Expo), `WebBrowser.openBrowserAsync()` opens a one-way browser — it has **no mechanism to pass data back to the app** after redirect. If your `success_url` redirects to a custom scheme, the browser closes but your app receives no callback or result object.

**FIX:**
Use `WebBrowser.openAuthSessionAsync(url, redirectUrl)` instead — it opens the URL and actively watches for a redirect back to `redirectUrl` (your app's scheme), then returns control to your app with a result object. On iOS, this uses `ASWebAuthenticationSession`; on Android, it uses Chrome Custom Tabs with an intent filter.

```ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

const redirectUrl = Linking.createURL('payment-complete');
const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, redirectUrl);
if (result.type === 'success') {
  const params = Linking.parse(result.url); // extract session_id etc.
}
```

**SOURCE:**
- <https://docs.expo.dev/versions/latest/sdk/webbrowser/>
- <https://dev.to/priyanshrastogi/accept-payments-in-universal-apps-with-stripe-checkout-jd8>

---

## GOTCHA 11: Stripe Billing Portal — Must Be Configured in Dashboard Before API Use

**PROBLEM:**
Calling `stripe.billingPortal.sessions.create({ customer: '...', return_url: '...' })` in a fresh Stripe account (especially test mode) throws a `This customer portal configuration does not exist` or `No default portal configuration found` error. This blocks development and is not clearly explained in the error message.

**FIX:**
The Customer Portal must be configured in the Dashboard first. If you haven't set up your customer portal, see the customer portal guide. Go to **Stripe Dashboard → Settings → Billing → Customer Portal** and configure it (enable features, set allowed products, etc.) for **both test mode and live mode separately**. The `return_url` passed at session creation time overrides the Dashboard default.

```ts
const session = await stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,
  return_url: 'https://yourapp.vercel.app/account', // web fallback
});
// Then open session.url via WebBrowser.openAuthSessionAsync on mobile
```

**SOURCE:**
- <https://docs.stripe.com/customer-management/configure-portal>
- <https://docs.stripe.com/customer-management/integrate-customer-portal>
- <https://superwall.com/docs/support/web-checkout/3771535881-why-am-i-seeing-an-error-occurred-while-loading-the-stripe-portal-in-the-manage-subscription-page>

---

## GOTCHA 12: Stripe Billing Portal `return_url` — Mobile App Cannot Be a Deep Link

**PROBLEM:**
Just like `success_url`, the `return_url` for the Billing Portal **cannot be a bare custom scheme** (`myapp://`). Stripe only accepts `https://` URLs for `return_url` in the portal. If you pass a custom scheme, the API rejects it or the browser simply doesn't redirect after the user clicks "Return to app."

**FIX:**
The `return_url` is required if a default return URL isn't set in the Dashboard configuration. Use an `https://` URL pointing to a Vercel page that then immediately redirects to your app's custom scheme via a JS redirect. Alternatively, set a universal link as the `return_url`:

```ts
// Server-side: use an HTTPS intermediary page
return_url: 'https://yourapp.com/portal-return' 
// That page does: window.location.href = 'myapp://portal-return';
```

**SOURCE:**
- <https://docs.stripe.com/api/customer_portal/sessions/create>
- <https://docs.stripe.com/customer-management/integrate-customer-portal>

---

## GOTCHA 13: Stripe API Version — New Date+Name Scheme; Your Hardcoded Version is Stale

**PROBLEM:**
Many tutorials and Stripe SDK examples still show `apiVersion: "2022-11-15"` or similar. Since the **2024-09-30.acacia** release, Stripe has a new versioning model with date + codename. Each major release (Acacia, Basil, Clover, Dahlia) includes changes that are not backward-compatible with previous releases. Upgrading to a new major release can require updates to existing code. Hardcoding an old version string causes TypeScript type errors with new SDKs and means you miss security fixes and new features.

**FIX:**
The current API version (as of this writing) is `2026-03-25.dahlia`. Each SDK version is pinned to a specific API version — so simply installing the latest `stripe` npm package automatically uses the correct version. Let the SDK pick its pinned version rather than hardcoding:

```ts
// ✅ Correct — let SDK pin the version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ❌ Avoid hardcoding old versions
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2022-11-15" });
```

If you must specify, match the exact version from `stripe` package's release notes.

**SOURCE:**
- <https://docs.stripe.com/api/versioning>
- <https://docs.stripe.com/sdks/versioning>
- <https://github.com/stripe/stripe-node/releases>

---

## GOTCHA 14: Stripe Subscription — Duplicate Customer Creation on Retry

**PROBLEM:**
In serverless environments, network timeouts cause client-side retries. Without idempotency keys, calling `stripe.customers.create()` or `stripe.subscriptions.create()` twice creates **two separate Stripe customers or subscriptions** for the same user, leading to double-billing. This is especially dangerous in Expo apps where users tap "Pay" multiple times.

**FIX:**
To perform an idempotent request, provide an additional `idempotencyKey` element to the request options. Stripe's idempotency works by saving the resulting status code and body of the first request made for any given idempotency key, regardless of whether it succeeds or fails. Use a stable, deterministic key (e.g., `userId + planId`):

```ts
const customer = await stripe.customers.create(
  { email: user.email, metadata: { userId: user.id } },
  { idempotencyKey: `create-customer-${user.id}` }
);

const subscription = await stripe.subscriptions.create(
  { customer: customer.id, items: [{ price: priceId }] },
  { idempotencyKey: `create-sub-${user.id}-${priceId}` }
);
```

Idempotency keys expire from the system after 24 hours — generate a new key whenever the request payload changes.

**SOURCE:**
- <https://docs.stripe.com/api/idempotent_requests>
- <https://stripe.com/blog/idempotency>
- <https://dev.to/apoorvtomar/maximizing-payment-reliability-harnessing-the-power-of-idempotency-keys-in-your-stripe-integration-28hn>

---

## GOTCHA 15: Peru — Stripe Does NOT Support Peruvian Merchant Accounts

**PROBLEM:**
This is the most critical architecture-level gotcha for **Horario**. While Stripe supports businesses in Brazil and Mexico, many other Latin American countries are excluded from the platform's services. Peru is **not a supported country for Stripe merchant accounts** as of 2025. To overcome the lack of official support for Peru, businesses need to form a US-based LLC, obtain an EIN, and have a US bank account.

**Practical Impact:**
- You **cannot** create a Stripe account as a Peru-registered business.
- Peruvian users **can pay** with international cards (Visa/MC) on a Stripe account registered in a supported country (US, EU, etc.).
- Stripe has **no Yape, PEN (Sol), or local Peruvian bank transfer support**.
- Culqi is a popular Peruvian payment gateway that supports local cards and digital wallets such as Yape and Plin, with a fee structure of 3.44% + IGV for national cards/wallets and 3.99% + IGV for international cards.

**FIX / Architecture Decision:**
Your two-gateway strategy (`Stripe` for global + `Culqi` for Peru/Yape) is **exactly correct**. Route based on user's selected payment method:
- **Stripe**: International cards, users who have US/EU billing addresses, global subscriptions.
- **Culqi**: Peruvian cards, Yape wallet, PEN-denominated payments.

Do **not** attempt to use Stripe test cards in test mode to simulate Peruvian cards — Stripe's test card deck doesn't have specific Peruvian card BINs and the behavior won't reflect real Peruvian card declines/fees.

**SOURCE:**
- <https://www.zintego.com/blog/stripes-global-availability-a-list-of-supported-countries/>
- <https://www.linkedin.com/pulse/how-open-stripe-account-peru-mazino-oyolo-x3rqc>
- <https://www.rebill.com/en/blog/payment-gateways-peru>
- <https://stripe.com/global>

---

## GOTCHA 16: Vercel Serverless 4.5 MB Body Size Limit

**PROBLEM:**
The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB. If a Vercel Function receives a payload in excess of the limit, it returns a `413: FUNCTION_PAYLOAD_TOO_LARGE` error. This is not an issue for typical Stripe webhook payloads (which are small JSON), but becomes relevant if you're proxying payment data or handling large metadata through your `secure-proxy+api.ts`.

**FIX:**
Keep your `secure-proxy` handler lean — never pass file data through it. For any attachment or large payload, use pre-signed Supabase Storage URLs instead of routing through the Vercel function. Stripe webhook payloads are well under 100KB, so this only matters for your proxy endpoints.

**SOURCE:**
- <https://vercel.com/docs/functions/limitations>
- <https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions>

---

## GOTCHA 17: `{CHECKOUT_SESSION_ID}` Template — Literal String, Not a Variable

**PROBLEM:**
The `{CHECKOUT_SESSION_ID}` placeholder in the `success_url` is a literal string that must be added exactly as written. You must not substitute it with a Checkout Session ID — this substitution happens automatically after your customer pays and is redirected. A frequent bug is developers trying to interpolate this string in JavaScript (e.g., `` `...?session_id=${sessionId}` ``) when creating the session — but at creation time, there's no session ID yet.

**FIX:**
```ts
// ✅ Correct — literal template variable, Stripe fills it in
success_url: `https://yourapp.com/payment-success?session_id={CHECKOUT_SESSION_ID}`,

// ❌ Wrong — sessionId doesn't exist yet when creating the session
success_url: `https://yourapp.com/payment-success?session_id=${session.id}`,
```

Then on your `/payment-success` page, read `session_id` from the URL query params and call your backend to look up the session with `stripe.checkout.sessions.retrieve(sessionId)`.

**SOURCE:**
- <https://docs.stripe.com/payments/checkout/custom-success-page>

---

## GOTCHA 18: `stripe listen` CLI Webhook Secret ≠ Dashboard Endpoint Secret

**PROBLEM:**
When testing locally with `stripe listen --forward-to localhost:3000/api/webhook`, Stripe CLI generates a **temporary local signing secret** (e.g., `whsec_...abc`). Developers frequently copy this into their `.env` and then into Vercel's production environment variables. The result: webhooks silently fail in production with "No signatures found" because the CLI secret is **ephemeral and not the same** as the Dashboard-registered endpoint secret.

**FIX:**
Maintain two clearly separate variables:
```bash
# .env.local (local dev only, from `stripe listen` output, never commit)
STRIPE_WEBHOOK_SECRET=whsec_cli_temp_secret

# Vercel Dashboard environment variables (from Dashboard → Webhooks → endpoint secret)
STRIPE_WEBHOOK_SECRET_TEST=whsec_dashboard_test_secret
STRIPE_WEBHOOK_SECRET_LIVE=whsec_dashboard_live_secret
```

Use a selection helper:
```ts
const secret = process.env.NODE_ENV === 'development'
  ? process.env.STRIPE_WEBHOOK_SECRET      // CLI secret
  : process.env.STRIPE_WEBHOOK_SECRET_LIVE; // Dashboard secret
```

**SOURCE:**
- <https://vercel.com/templates/next.js/subscription-starter>
- <https://github.com/vercel/nextjs-subscription-payments/issues/240>
- <https://inventivehq.com/blog/stripe-webhooks-guide>

---

## Summary Table

| # | Gotcha | Severity | Platform |
|---|--------|----------|----------|
| 1 | Raw body destroyed — use `request.text()` | 🔴 Critical | Vercel/Node |
| 2 | Edge runtime re-encodes body — force `nodejs` | 🔴 Critical | Vercel |
| 3 | `stripe-signature` header uses Web API `.get()` | 🔴 Critical | App Router |
| 4 | Test/Live webhook secret mismatch | 🔴 Critical | All |
| 5 | Duplicate webhook events — must be idempotent | 🟠 High | All |
| 6 | 5-min timestamp tolerance — clock skew on cold start | 🟡 Medium | Vercel |
| 7 | `success_url` rejects `myapp://` custom schemes | 🔴 Critical | Mobile |
| 8 | `urlScheme` — Expo Go vs. production builds differ | 🔴 Critical | Expo |
| 9 | Expo Router intercepts Stripe 3DS return URL | 🔴 Critical | Expo Router |
| 10 | `openBrowserAsync` can't receive redirect data back | 🟠 High | Expo |
| 11 | Billing Portal must be Dashboard-configured first | 🟠 High | Stripe |
| 12 | Portal `return_url` must be `https://` not `myapp://` | 🟠 High | Mobile |
| 13 | Old hardcoded `apiVersion` — use SDK-pinned version | 🟡 Medium | All |
| 14 | Duplicate customer/sub on retry — use idempotency keys | 🔴 Critical | All |
| 15 | **Peru is NOT a Stripe-supported country for merchants** | 🔴 Critical | Architecture |
| 16 | Vercel 4.5 MB body limit on proxy routes | 🟡 Medium | Vercel |
| 17 | `{CHECKOUT_SESSION_ID}` is a literal, not JS template | 🟡 Medium | All |
| 18 | CLI webhook secret ≠ Dashboard endpoint secret | 🔴 Critical | Dev/Prod |