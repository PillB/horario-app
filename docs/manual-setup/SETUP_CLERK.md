# Clerk — Production Setup Guide

**Dashboard:** https://dashboard.clerk.com
**Stack:** Expo SDK 53 · React Native 0.79 · Expo Router v5 · `@clerk/expo` v3 · Vercel (Node.js runtime)

---

## Prerequisites

Before starting, confirm:

- [ ] Clerk account created at https://dashboard.clerk.com
- [ ] Application already created in Clerk Dashboard (you have a **Publishable Key** and **Secret Key**)
- [ ] `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are in `.env.local`
- [ ] `@clerk/expo` v3 is installed (`npm ls @clerk/expo` shows `3.x.x`)
- [ ] `@clerk/clerk-sdk-node` is **not** installed (EOL January 10, 2025 — see Step 2)
- [ ] Session Token V2 is active (see Step 0)

---

## Step 0 — Migrate to Session Token V2 (Critical Pre-Flight)

> **Do this before any JWT template work.** If skipped, JWT claims may silently differ from what you configured, and RLS policies may break without a clear error.

⚠️ **GOTCHA: Session Token V1 was deprecated April 14, 2025.**
If your Clerk app was created before April 2025, you are likely still on V1. V1 and V2 have different default claim structures — in particular, V2 nests organization claims under a compact `o` object with abbreviated keys, replacing the flat V1 top-level claims.

| V1 Claim (flat) | V2 Equivalent (nested under `o`) |
|---|---|
| `org_id` | `o.id` |
| `org_slug` | `o.slg` |
| `org_role` | `o.rol` |
| `org_permissions` | `o.per` |
| `org_feature_permissions` | `o.fpm` |

JWT templates and RLS policies written for V1 will break silently on V2 without this migration step.
(source: https://clerk.com/changelog/2025-04-14-session-token-jwt-v2)

**Fix:**
1. Go to **Dashboard → [Your App] → Updates**
2. Find the **Session Token V2** migration card
3. Click **Migrate to V2**
4. After migrating, decode a live token and confirm the new claim structure

🔄 **UPDATED: If you have RLS policies that reference organization claims, use `COALESCE()` to handle both V1 and V2 shapes during and after migration:**

```sql
-- Handles both V1 flat claims and V2 nested claims during migration window
COALESCE(
  auth.jwt() ->> 'org_id',
  auth.jwt() -> 'o' ->> 'id'
) = <YOUR_ORG_ID_HERE>
```

Once all active sessions have rotated to V2 tokens (allow 24–48 hours), you can simplify to the V2-only form:

```sql
auth.jwt() -> 'o' ->> 'id' = <YOUR_ORG_ID_HERE>
```

✅ **Verify:** Decode a token from `getToken()` in your app and confirm:

```javascript
const token = await getToken();
const payload = JSON.parse(atob(token.split('.')[1]));
console.log(payload);
// V2 tokens: org claims appear as payload.o.id, payload.o.rol, etc.
// V1 tokens: org claims appear as payload.org_id, payload.org_role, etc.
// Confirm you see the V2 shape before proceeding.
```

| Symptom | Likely Cause | Fix | Source |
|---|---|---|---|
| RLS policies stop working after migration | V2 restructures `org_*` claims | Use `COALESCE(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')` during transition | https://clerk.com/docs/guides/sessions/session-tokens |
| `org_*` claims missing entirely from token | V2 active; policies still reference V1 flat keys | Update RLS to reference `o->>'id'`, `o->>'rol'`, etc. | https://supabase.com/docs/guides/auth/third-party/clerk |

---

## Step 1 — Configure JWT Template for Subscription Tier

The secure proxy at `app/api/secure-proxy+api.ts` reads `horario_tier` from the Clerk JWT to authorize tier-gated actions without a round-trip to Supabase. This template injects subscription claims into every token issued when the client calls `getToken({ template: 'horario' })`.

> **Note:** This is a **custom** JWT template for Horario's internal billing claims. It is distinct from the deprecated `supabase` JWT template (see Step 8 for the current Clerk + Supabase integration). Custom templates for non-Supabase purposes remain fully supported and recommended.

### 1.1 — Create the Template

1. **Dashboard → Configure → JWT Templates → + New template**
2. Select **Blank** (not a pre-built integration template)
3. Set fields exactly as follows:

| Field | Value |
|---|---|
| **Template name** | `horario` ← exact, case-sensitive; must match `getToken({ template: 'horario' })` |
| **Token lifetime** | `60` seconds |
| **Allowed clock skew** | `5` seconds (default) |

4. In the **Claims** JSON editor, replace all existing content with:

```json
{
  "horario_tier": "{{user.public_metadata.horario_tier}}",
  "horario_status": "{{user.public_metadata.horario_status}}",
  "horario_period_end": "{{user.public_metadata.horario_period_end}}"
}
```

5. Click **Apply changes**

⚠️ **GOTCHA: `publicMetadata` shortcodes resolve to JSON `null` — not `""` or `"free"` — when unset.**
When a brand-new user has no `horario_tier` set, the expression `{{user.public_metadata.horario_tier}}` resolves to JSON `null`. Your secure proxy and any client-side tier checks **must** treat `null` as `"free"`. This is especially important for newly created users before your `user.created` webhook fires.
(source: https://clerk.com/docs/backend-requests/making/jwt-templates)

```typescript
// ✅ Correct — handle null from JWT
const tier = (payload.horario_tier as string) ?? 'free';

// ❌ Wrong — will be null for new users
const tier = payload.horario_tier; // will be null, not "free"
```

⚠️ **GOTCHA: JWT templates do NOT include the `sid` (session ID) claim.**
Custom JWT templates are not session tokens. Clerk automatically includes `sub` (user ID) in template tokens, but `sid` and other session-bound claims are only present in the standard session token (no template). If your Supabase RLS or backend tries to read `sid` from a `horario` template token, it will be `undefined`. Use the standard session token (no template) for session-bound auth checks; use templates only for third-party integrations.
(source: https://clerk.com/docs/backend-requests/making/jwt-templates)

⚠️ **GOTCHA: JWTs are cached by Clerk for up to the token lifetime (60 seconds).**
After you update a user's `publicMetadata` (e.g., after payment confirmation), the client will continue using the old cached token for up to 60 seconds. Tier changes are **not instant** in the app.

**Why 60 seconds is the recommended minimum:**
- Clerk's minimum token lifetime is 30 seconds
- Setting it lower than 60s increases auth server load with no practical security benefit for billing tier claims
- 60 seconds is acceptable for subscription tier — a brief delay after payment is expected behavior, not a bug

**To force an immediate refresh after payment confirmation:**

```typescript
// In your billing success screen — force a fresh token
const { getToken } = useAuth();
const freshToken = await getToken({ template: 'horario', skipCache: true });
// skipCache forces a new token fetch from Clerk's server
```

⚠️ **GOTCHA: Session cookie 4 KB limit silently breaks web auth.**
Clerk stores the session token in a cookie, and most browsers limit cookie size to 4 KB. After accounting for Clerk's default claims, the cookie can support up to **1.2 KB of custom claims**. If you later add Stripe customer IDs, Culqi tokens, org data, etc. to the session token, you can silently exceed 4 KB — users appear logged out with no error message. Keep custom claims lean; store rich profile data in Supabase instead.
(source: https://clerk.com/docs/backend-requests/resources/session-tokens)

```json
// ✅ LEAN — only what gate checks need
{ "horario_tier": "pro", "horario_status": "active", "horario_period_end": "2026-05-05T00:00:00Z" }

// ❌ DANGEROUS — do not embed full objects in JWT claims
{ "stripe_data": { "...fullCustomerObject": true }, "org": { "...allOrgData": true } }
```

### 1.2 — Test the JWT Template in the Dashboard

1. **Dashboard → Configure → JWT Templates → horario**
2. Click the **Test** tab (top right of the template editor)
3. Select any test user from the **User** dropdown
4. Click **Generate token**
5. Copy the token and paste it into https://jwt.io

**Expected decoded payload for a new user (no metadata set):**

```json
{
  "sub": "user_2abc123def456",
  "horario_tier": null,
  "horario_status": null,
  "horario_period_end": null,
  "iat": 1716000000,
  "exp": 1716000060,
  "iss": "https://<YOUR_CLERK_DOMAIN>.clerk.accounts.dev"
}
```

**Expected decoded payload after payment (metadata set):**

```json
{
  "sub": "user_2abc123def456",
  "horario_tier": "starter",
  "horario_status": "active",
  "horario_period_end": "2026-05-05T00:00:00Z",
  "iat": 1716000000,
  "exp": 1716000060,
  "iss": "https://<YOUR_CLERK_DOMAIN>.clerk.accounts.dev"
}
```

✅ **Verify:** The Test tab generates a token successfully AND the decoded payload at jwt.io shows exactly the three `horario_*` claims. If the claims are missing entirely (not even `null`), the Handlebars syntax is wrong — re-check for typos in the JSON.

| Symptom | Likely Cause | Fix | Source |
|---|---|---|---|
| Claims missing entirely (not even null) | Typo in Handlebars expression | Re-check `{{user.public_metadata.horario_tier}}` — no extra spaces | https://clerk.com/docs/backend-requests/making/jwt-templates |
| Template name mismatch error at runtime | Wrong template name in `getToken()` | Name must be exactly `horario` — no caps, no hyphens | https://clerk.com/docs/backend-requests/making/jwt-templates |
| Test button shows "No users found" | No users exist in this Clerk app yet | Create a test user under **Users → Create user** | — |
| Token lifetime field missing | You selected a pre-built template type | Delete and recreate — choose **Blank** | — |

---

## Step 2 — Install Clerk Backend SDK

The Backend SDK is required for server-side operations: updating `publicMetadata` after payment, verifying tokens in the secure proxy, and processing webhooks.

### 2.1 — Install

```bash
npm install @clerk/backend
```

✅ **Verify:**

```bash
npm ls @clerk/backend
# Expected: @clerk/backend@1.x.x (or higher)
```

⚠️ **GOTCHA: `@clerk/clerk-sdk-node` reached end-of-life January 10, 2025. Do NOT use it.**
It no longer receives security patches. Any existing code importing from `@clerk/clerk-sdk-node` must be migrated immediately. Many older tutorials and StackOverflow answers still reference it — ignore them.
(source: https://www.npmjs.com/package/clerk-sdk-node)

```typescript
// ❌ Dead — do not use
import Clerk from '@clerk/clerk-sdk-node';

// ✅ Correct — use @clerk/backend
import { createClerkClient } from '@clerk/backend';
```

### 2.2 — Initialize in `secure-proxy+api.ts`

```typescript
// app/api/secure-proxy+api.ts
// Node.js runtime (NOT Edge) — required for @clerk/backend
import { createClerkClient } from '@clerk/backend';

// Initialize once at module scope (not inside the handler)
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!,
});

export async function POST(request: Request) {
  const { isAuthenticated, toAuth } = await clerkClient.authenticateRequest(request, {
    // Use authorizedParties instead of a custom aud claim — see GOTCHA below
    authorizedParties: ['https://<YOUR_DOMAIN>.vercel.app'],
  });

  if (!isAuthenticated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId } = toAuth();
  // ... proxy to Stripe/Culqi
}
```

⚠️ **GOTCHA: Never add a custom `aud` claim to the default session token.**
Adding `"aud": "https://horario.vercel.app"` to your **main session token** customization will cause `authenticateRequest()` to throw `"Invalid JWT audience claim (aud). Expected 'undefined'."` — Clerk's own SDK does not expect `aud` on the default session token. Use `authorizedParties` on `authenticateRequest()` instead. If a downstream service (e.g., Supabase) requires an `aud` claim, put it in a dedicated **JWT template** and fetch it separately with `getToken({ template: '...' })` — never use that template token as your primary auth credential.
(source: https://github.com/clerkinc/clerk-sdk-node/issues/1507)

### 2.3 — Add Environment Variables

Add to `.env.local`:

```bash
CLERK_SECRET_KEY=<YOUR_CLERK_SECRET_KEY_FROM_DASHBOARD>
# Already present:
# EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_<YOUR_VALUE_HERE>
```

Add to **Vercel Dashboard → [Project] → Settings → Environment Variables**:

| Key | Value | Environments |
|---|---|---|
| `CLERK_SECRET_KEY` | `sk_live_<YOUR_VALUE_HERE>` | Production, Preview, Development |
| `CLERK_WEBHOOK_SECRET` | `whsec_<YOUR_VALUE_HERE>` (from Step 4) | Production, Preview, Development |

✅ **Verify:** After adding to Vercel, redeploy and check function logs:

```typescript
// Add temporarily to any API route
console.log('Clerk key present:', !!process.env.CLERK_SECRET_KEY);
// Expected: Clerk key present: true
```

| Symptom | Likely Cause | Fix | Source |
|---|---|---|---|
| `secretKey is required` error | `CLERK_SECRET_KEY` not in env | Add to `.env.local` AND Vercel env vars | — |
| `Invalid API key` 401 from Clerk | Using publishable key as secret key | Secret key starts with `sk_`, publishable with `pk_` | — |
| Works locally, fails on Vercel | Env var not added to Vercel | Dashboard → Settings → Environment Variables | — |

---

## Step 3 — Update `publicMetadata` After Payment

After a successful payment (Stripe webhook or Culqi webhook), you must update the user's `publicMetadata` in Clerk so the next JWT issued contains the new tier.

### 3.1 — The Update Function

```typescript
// lib/clerk-metadata.ts
import { createClerkClient } from '@clerk/backend';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export interface SubscriptionMetadata {
  horario_tier: 'free' | 'starter' | 'pro' | 'enterprise';
  horario_status: 'active' | 'past_due' | 'canceled' | 'trialing';
  horario_period_end: string; // ISO 8601, e.g. "2026-05-05T00:00:00Z"
}

export async function updateSubscriptionMetadata(
  clerkUserId: string,
  metadata: SubscriptionMetadata,
): Promise<void> {
  await clerkClient.users.updateUserMetadata(clerkUserId, {
    publicMetadata: {
      horario_tier: metadata.horario_tier,
      horario_status: metadata.horario_status,
      horario_period_end: metadata.horario_period_end,
    },
  });
}
```

⚠️ **GOTCHA: `updateUserMetadata()` MERGES — it does NOT replace the entire `publicMetadata` object.**
If the user already has `{ horario_tier: 'starter', other_key: 'value' }` and you call `updateUserMetadata` with `{ horario_tier: 'pro' }`, the result is `{ horario_tier: 'pro', other_key: 'value' }`. The `other_key` is preserved. This is intentional and safe for Horario's use case (you only manage the three `horario_*` keys), but if you ever need to **fully replace** metadata, use `clerkClient.users.updateUser()` instead. To **delete** a key, explicitly set it to `null`.
(source: https://clerk.com/docs/references/backend/user/update-user-metadata)

```typescript
// ✅ To downgrade/cancel — explicitly null out values
await clerkClient.users.updateUserMetadata(userId, {
  publicMetadata: {
    horario_tier: 'free',
    horario_status: 'canceled',
    horario_period_end: null, // explicit null removes the key on next merge
  },
});

// ✅ To fully replace all metadata (wipes keys not mentioned)
await clerkClient.users.updateUser(userId, {
  publicMetadata: {
    horario_tier: 'free',
    horario_status: 'active',
    horario_period_end: null,
  },
});
```

⚠️ **GOTCHA: `useUser().user.publicMetadata` on the client is stale after a server-side update.**
After your webhook updates `publicMetadata` (e.g., `plan: 'pro'` after Stripe payment), the `useUser()` hook still returns the **old** in-memory User object. The data is fresh on the server but the client has not re-fetched. Call `user.reload()` and `getToken({ skipCache: true })` after your payment flow to force a re-fetch:
(source: https://clerk.com/docs/references/react/use-user)

```typescript
const { user } = useUser();
const { getToken } = useAuth();

const handleUpgradeSuccess = async () => {
  // Add a short delay — webhooks are async, allow ~3s for processing
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await user?.reload();                        // re-fetches publicMetadata from Clerk
  await getToken({ skipCache: true });         // gets fresh JWT with updated claims
  // Now user.publicMetadata.horario_tier reflects the new value
};
```

### 3.2 — Getting the Clerk `userId` from a Stripe Webhook

You must store the Clerk `userId` in Stripe customer metadata **at checkout creation time**. There is no other reliable way to recover it from a webhook payload later.

**At checkout creation (in secure-proxy or checkout handler):**

```typescript
// When creating a Stripe Checkout Session, store clerkUserId in customer metadata
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: userEmail,
  metadata: {
    clerk_user_id: clerkUserId, // ← store this — you'll need it in the webhook
  },
  subscription_data: {
    metadata: {
      clerk_user_id: clerkUserId, // ← also on the subscription for renewal events
    },
  },
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `https://<YOUR_DOMAIN>.vercel.app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `https://<YOUR_DOMAIN>.vercel.app/billing/cancel`,
});
```

**In the Stripe webhook handler:**

```typescript
// Retrieve clerkUserId from the event payload
function getClerkUserIdFromStripeEvent(event: Stripe.Event): string | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      return session.metadata?.clerk_user_id ?? null;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      return subscription.metadata?.clerk_user_id ?? null;
    }
    default:
      return null;
  }
}
```

### 3.3 — Getting the Clerk `userId` from a Culqi Webhook

Culqi does not support arbitrary metadata on charges/subscriptions in the same way as Stripe. Store the mapping in your Supabase `subscriptions` table instead:

```typescript
// In your Culqi checkout initiation — store the mapping in Supabase
await supabase.from('culqi_customer_map').insert({
  culqi_order_id: culqiOrder.id,  // Culqi's order ID
  clerk_user_id: clerkUserId,      // Clerk user ID
  created_at: new Date().toISOString(),
});

// In your Culqi webhook handler — look up the mapping
const { data: mapping } = await supabase
  .from('culqi_customer_map')
  .select('clerk_user_id')
  .eq('culqi_order_id', event.data.id)
  .single();

const clerkUserId = mapping?.clerk_user_id;
```

> **Clerk Billing vs. `publicMetadata` for Horario:** Clerk now has a native Billing product with `has({ plan: 'pro' })` checks and built-in `<PricingTable />` components — but it **only supports Stripe**. Since Horario integrates Culqi for Peru-based payments (Yape, PagoEfectivo), use the hybrid approach: Clerk Billing for global Stripe subscribers, and `publicMetadata.culqi_status` (managed via your Culqi webhook) for Culqi/Yape subscribers. Gate features server-side combining both signals:
>
> ```typescript
> const { has, sessionClaims } = await auth();
> const isPro = has({ plan: 'pro' }) || sessionClaims?.culqi_status === 'active';
> ```
>
> (source: https://clerk.com/docs/billing/overview)

### 3.4 — Error Handling When Clerk API Is Down

```typescript
// app/api/webhooks/stripe+api.ts
import { updateSubscriptionMetadata } from '@/lib/clerk-metadata';

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const clerkUserId = session.metadata?.clerk_user_id;
  if (!clerkUserId) {
    console.error('CRITICAL: No clerk_user_id in Stripe session metadata', {
      sessionId: session.id,
    });
    // Still update Supabase — it is the source of truth for billing
    await updateSupabaseSubscription(session);
    return;
  }

  // 1. Always update Supabase first (source of truth)
  await updateSupabaseSubscription(session);

  // 2. Update Clerk metadata (for JWT claims — best effort)
  try {
    await updateSubscriptionMetadata(clerkUserId, {
      horario_tier: 'starter',
      horario_status: 'active',
      horario_period_end: getPeriodEnd(session),
    });
  } catch (clerkError) {
    // Log for manual recovery — do NOT throw; webhook must return 200
    console.error('Clerk metadata update failed — manual recovery needed', {
      clerkUserId,
      sessionId: session.id,
      error: clerkError,
    });
    // The secure proxy can fall back to Supabase for tier if JWT claim is stale
  }
}
```

> **Recovery strategy:** Your `secure-proxy+api.ts` should fall back to querying Supabase for tier if `payload.horario_tier` is `null` but the user has an active subscription in the DB. The JWT claim is a performance optimization, not the sole source of truth.

✅ **Verify metadata update worked:**

```bash
# Via Clerk Dashboard: Dashboard → Users → [select user] → Metadata tab → Public
# Expected:
# {
#   "horario_tier": "starter",
#   "horario_status": "active",
#   "horario_period_end": "2026-05-05T00:00:00Z"
# }

# Or via Clerk Management API:
curl https://api.clerk.com/v1/users/<YOUR_CLERK_USER_ID_HERE> \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  | jq '.public_metadata'
```

| Symptom | Likely Cause | Fix | Source |
|---|---|---|---|
| Metadata update succeeds but JWT still shows old tier | JWT is cached (60s TTL) | Wait 60s or call `getToken({ skipCache: true })` | https://clerk.com/docs/backend-requests/making/jwt-templates |
| `User not found` 404 from Clerk API | Wrong `clerkUserId` format | Must start with `user_` — check Stripe metadata was stored correctly | — |
| Metadata shows `{}` after update | Passed empty object to `updateUserMetadata` | Log the payload before sending to confirm it is populated | — |
| Webhook receives 200 but metadata never updates | `updateUserMetadata` threw silently | Add explicit try/catch with error logging | — |

---

## Step 4 — Clerk Webhook for `user.created`

When a new user signs up, Clerk sends a `user.created` webhook. Use this to auto-provision a `subscriptions` row in Supabase with the `free` tier — so the user has a valid subscription record before their first API call, and so JWT template shortcodes don't resolve to `null` on the first request.

### 4.1 — Create the Webhook Endpoint in the Dashboard

1. **Dashboard → Configure → Webhooks → + Add endpoint**
2. Set fields:

| Field | Value |
|---|---|
| **Endpoint URL** | `https://<YOUR_DOMAIN>.vercel.app/api/clerk-webhook` |
| **Message Filtering** | Select `user.created` only |
| **Version** | Leave as default |

3. Click **Create**
4. On the endpoint detail page, reveal and copy the **Signing Secret** (format: `whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
5. Save it as `CLERK_WEBHOOK_SECRET` in `.env.local` and Vercel env vars

> **Why a dedicated `/api/clerk-webhook` route?**
> Mixing webhook handling into `secure-proxy+api.ts` complicates signature verification and raw body parsing. A dedicated route is cleaner and easier to debug.

✅ **Verify the endpoint was created:** The webhook endpoint page shows status **Enabled** and lists `user.created` under subscribed events.

### 4.2 — Install the Svix SDK

Clerk uses [Svix](https://svix.com) to sign and deliver webhooks. You must verify the Svix signature — do not skip this; unauthenticated webhook endpoints are a critical security vulnerability.

```bash
npm install svix
```

✅ **Verify:**

```bash
npm ls svix
# Expected: svix@1.x.x
```

### 4.3 — Handle the Raw Body Issue on Vercel

⚠️ **GOTCHA: Svix verification fails if the request body has been parsed before verification.**
Svix signature verification requires the **raw, unparsed request body** as a string. If any middleware (or your own code) calls `await request.json()` before the Svix check, the signature verification will throw `"WebhookVerificationError: No matching signature found"` for every webhook delivery, making the endpoint completely non-functional.

**The fix:** Use `await request.text()` to get the raw body string, then parse it yourself after verification.

```typescript
// ✅ Correct — raw body for Svix verification
const rawBody = await request.text();    // raw string — pass this to wh.verify()
const payload = JSON.parse(rawBody);     // parse AFTER verification

// ❌ Wrong — body already consumed/mutated
const payload = await request.json();   // cannot use for Svix verification
```

⚠️ **GOTCHA: If using Express-style middleware, `bodyParser.raw()` returns a Buffer, not a string.**
You may need `.toString()` before passing to `wh.verify()`. In Expo Router API routes (Vercel Node.js runtime), `request.text()` returns a plain string and works correctly without conversion.
(source: https://github.com/svix/svix-webhooks/issues/1463)

### 4.4 — Complete Webhook Handler

Create `app/api/clerk-webhook+api.ts`:

```typescript
// app/api/clerk-webhook+api.ts
// Node.js runtime (not Edge) — required for Svix and Supabase client
import { Webhook } from 'svix';
import { createClient } from '@supabase/supabase-js';

// Clerk user.created event shape — webhook payload uses snake_case (Backend API format)
// ⚠️ This is NOT the same as the camelCase used by useUser() / the frontend SDK
interface ClerkUserCreatedEvent {
  type: 'user.created';
  data: {
    id: string;                          // "user_2abc123def456"
    email_addresses: Array<{
      id: string;
      email_address: string;             // snake_case — NOT emailAddress
      verification: { status: string };
    }>;
    primary_email_address_id: string;    // snake_case — NOT primaryEmailAddressId
    first_name: string | null;           // snake_case — NOT firstName
    last_name: string | null;            // snake_case — NOT lastName
    image_url: string;
    created_at: number;                  // Unix timestamp in milliseconds
    updated_at: number;
  };
  object: 'event';
  timestamp: number;
}

// Service-role Supabase client — bypasses RLS for provisioning
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function POST(request: Request): Promise<Response> {
  // Step 1: Get Svix headers for signature verification
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json(
      { error: 'Missing Svix headers — this endpoint only accepts Clerk webhooks' },
      { status: 400 },
    );
  }

  // Step 2: Read raw body (MUST be text(), NOT json() — see GOTCHA above)
  const rawBody = await request.text();

  // Step 3: Verify Sv