# SETUP_CLERK.md

```markdown
# Clerk — Production Setup Guide

**Dashboard:** https://dashboard.clerk.com  
**Stack:** Expo SDK 53 · React Native 0.79 · Expo Router v5 · Clerk @clerk/expo v3 · Vercel (Node.js runtime)

---

## Prerequisites

Before starting, confirm:

- [ ] Clerk account created at https://dashboard.clerk.com
- [ ] Application already created in Clerk Dashboard (you have a **Publishable Key** and **Secret Key**)
- [ ] `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are in `.env.local`
- [ ] `@clerk/expo` v3 is installed (`npm ls @clerk/expo` shows `3.x.x`)
- [ ] Session Token V2 is active (see ⚠️ GOTCHA in Step 0)

---

## Step 0 — Migrate to Session Token V2 (Critical Pre-Flight)

> **Do this before any JWT template work.** If skipped, JWT claims may silently differ
> from what you configured.

⚠️ **GOTCHA: Session Token V1 was deprecated April 14, 2025.**
If your Clerk app was created before April 2025, you are likely still on V1.
V1 and V2 have different default claim structures. JWT templates and RLS policies
written for V1 may break silently on V2 without this migration step.
[Source: Clerk changelog 2025-04-14](https://clerk.com/changelog)

**Fix:**
1. Go to **Dashboard → [Your App] → Updates**
2. Find the **Session Token V2** migration card
3. Click **Migrate to V2**
4. After migrating, decode a live token and confirm the new claim structure

✅ **Verify:** Decode a token from `getToken()` in your app:
```javascript
const token = await getToken();
const payload = JSON.parse(atob(token.split('.')[1]));
console.log(payload); // Should NOT contain deprecated v1-only fields
```

| Symptom | Cause | Fix |
|---|---|---|
| RLS policies stop working after migration | V2 changes claim names | Re-audit all `auth.jwt()` references in Supabase |
| `org_*` claims missing | V2 restructures org claims | Update any org-based RLS rules |

---

## Step 1 — Configure JWT Template for Subscription Tier

The secure proxy at `app/api/secure-proxy+api.ts` reads `horario_tier` from the
Clerk JWT to authorize tier-gated actions without a round-trip to Supabase.
This template injects subscription claims into every token issued when the client
calls `getToken({ template: 'horario' })`.

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

⚠️ **GOTCHA: `publicMetadata` renders as `null`, not empty string, when unset.**  
When a brand-new user has no `horario_tier` set, the Handlebars expression
`{{user.public_metadata.horario_tier}}` resolves to JSON `null` — not `""` or `"free"`.
Your secure proxy and any client-side tier checks **must** treat `null` as `"free"`.
[Source: Clerk JWT Templates docs](https://clerk.com/docs/backend-requests/making/jwt-templates)

```typescript
// ✅ Correct — handle null from JWT
const tier = payload.horario_tier ?? 'free';

// ❌ Wrong — will evaluate to falsy for null
const tier = payload.horario_tier || 'free'; // works, but be explicit about null
const tier = payload.horario_tier;           // will be null for new users
```

⚠️ **GOTCHA: JWTs are cached by Clerk for up to the token lifetime (60 seconds).**  
After you update a user's `publicMetadata` (e.g., after payment confirmation),
the client will continue using the old cached token for up to 60 seconds.
Tier changes are **not instant** in the app.

**Why 60 seconds is already the minimum you should use:**
- Clerk's minimum token lifetime is 30 seconds
- Setting it lower than 60s increases auth server load with no practical security benefit
  for billing tier claims
- 60 seconds is acceptable for subscription tier — a 60-second delay after payment
  is expected behavior, not a bug

**To force an immediate refresh after payment confirmation:**
```typescript
// In your billing success screen — force a fresh token
const { getToken } = useAuth();
const freshToken = await getToken({ template: 'horario', skipCache: true });
// skipCache forces a new token fetch from Clerk's server
```

> **Note on `skipCache`:** As of `@clerk/expo` v3, pass `skipCache: true` to bypass
> the local token cache. This still respects Clerk's server-side 60s TTL, but ensures
> you're not using a locally-stale token.

### 1.2 — Test the JWT Template in the Dashboard

1. **Dashboard → Configure → JWT Templates → horario**
2. Click the **Test** tab (top right of the template editor)
3. Select any test user from the **User** dropdown
4. Click **Generate token**
5. Copy the token and paste it into [https://jwt.io](https://jwt.io)

**Expected decoded payload for a new user (no metadata set):**
```json
{
  "sub": "user_2abc123def456",
  "horario_tier": null,
  "horario_status": null,
  "horario_period_end": null,
  "iat": 1716000000,
  "exp": 1716000060,
  "iss": "https://your-clerk-domain.clerk.accounts.dev"
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
  "iss": "https://your-clerk-domain.clerk.accounts.dev"
}
```

✅ **Verify:** The Test tab generates a token successfully AND the decoded payload at
jwt.io shows exactly the three `horario_*` claims. If the claims are missing entirely
(not even `null`), the Handlebars syntax is wrong — re-check for typos in the JSON.

| Symptom | Cause | Fix |
|---|---|---|
| Claims missing entirely (not even null) | Typo in Handlebars expression | Re-check `{{user.public_metadata.horario_tier}}` — no extra spaces |
| Template name mismatch error at runtime | Wrong template name in `getToken()` | Name must be exactly `horario` — no caps, no hyphens |
| Test button shows "No users found" | No users exist in this Clerk app yet | Create a test user under **Users → Create user** |
| Token lifetime field missing | You selected a pre-built template type | Delete and recreate — choose **Blank** |

---

## Step 2 — Install Clerk Backend SDK

The Backend SDK is required for server-side operations: updating `publicMetadata`
after payment, verifying tokens in the secure proxy, and processing webhooks.

### 2.1 — Install

```bash
npm install @clerk/backend
```

✅ **Verify:**
```bash
npm ls @clerk/backend
# Expected: @clerk/backend@1.x.x (or higher)
```

⚠️ **GOTCHA: Do NOT use `@clerk/clerk-sdk-node` — it reached end-of-life January 10, 2025.**  
It no longer receives security patches. Any existing code importing from
`@clerk/clerk-sdk-node` must be migrated immediately.
[Source: npm @clerk/clerk-sdk-node deprecation notice, 2025-01-10](https://www.npmjs.com/package/clerk-sdk-node)

```typescript
// ❌ Dead — do not use
import Clerk from '@clerk/clerk-sdk-node';

// ✅ Correct — use @clerk/backend
import { createClerkClient } from '@clerk/backend';
```

### 2.2 — Initialize in `secure-proxy+api.ts`

```typescript
// app/api/secure-proxy+api.ts
import { createClerkClient } from '@clerk/backend';

// Initialize once at module scope (not inside the handler)
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!,
});
```

### 2.3 — Add Environment Variables

Add to `.env.local`:
```bash
CLERK_SECRET_KEY=<your-clerk-secret-key-from-dashboard>
# Already present as EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx
```

Add to **Vercel Dashboard → [Project] → Settings → Environment Variables**:

| Key | Value | Environments |
|---|---|---|
| `CLERK_SECRET_KEY` | `sk_live_xxx...` | Production, Preview, Development |
| `CLERK_WEBHOOK_SECRET` | `whsec_xxx...` (from Step 4) | Production, Preview, Development |

✅ **Verify:** After adding to Vercel, redeploy and check:
```bash
# In a test API route or via Vercel function logs:
console.log('Clerk key present:', !!process.env.CLERK_SECRET_KEY);
# Expected: Clerk key present: true
```

| Symptom | Cause | Fix |
|---|---|---|
| `secretKey is required` error | `CLERK_SECRET_KEY` not in env | Add to `.env.local` AND Vercel env vars |
| `Invalid API key` 401 from Clerk | Using publishable key as secret key | Secret key starts with `sk_`, publishable with `pk_` |
| Works locally, fails on Vercel | Env var not added to Vercel | Dashboard → Settings → Environment Variables |

---

## Step 3 — Update publicMetadata After Payment

After a successful payment (Stripe webhook or Culqi webhook), you must update the
user's `publicMetadata` in Clerk so the next JWT issued contains the new tier.

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

⚠️ **GOTCHA: `updateUserMetadata` MERGES — it does NOT replace the entire `publicMetadata` object.**  
If the user already has `{ horario_tier: 'starter', other_key: 'value' }` and you call
`updateUserMetadata` with `{ horario_tier: 'pro' }`, the result is
`{ horario_tier: 'pro', other_key: 'value' }`. The `other_key` is preserved.

This is intentional and safe for Horario's use case — you're only managing the
three `horario_*` keys. However, if you ever need to **clear** a key, you must
explicitly set it to `null`:

```typescript
// ✅ To downgrade/cancel — explicitly null out values
await clerkClient.users.updateUserMetadata(userId, {
  publicMetadata: {
    horario_tier: 'free',
    horario_status: 'canceled',
    horario_period_end: null, // explicit null to clear the value
  },
});
```

[Source: Clerk updateUserMetadata docs](https://clerk.com/docs/references/backend/user/update-user-metadata)

### 3.2 — Getting the Clerk userId from a Stripe Webhook

You must store the Clerk `userId` in Stripe customer metadata **at checkout creation time**.
There is no other reliable way to recover it from a webhook payload later.

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
  success_url: `https://your-domain.vercel.app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `https://your-domain.vercel.app/billing/cancel`,
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

### 3.3 — Getting the Clerk userId from a Culqi Webhook

Culqi does not support arbitrary metadata on charges/subscriptions in the same way
as Stripe. Store the mapping in your Supabase `subscriptions` table instead:

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

### 3.4 — Error Handling When Clerk API Is Down

Clerk's API has SLAs but is not infallible. If Clerk is down during your payment
webhook, the metadata update will fail — but the payment already succeeded.
You must handle this to avoid a paid user being stuck on the free tier.

```typescript
// app/api/webhooks/stripe+api.ts (or similar)
import { updateSubscriptionMetadata } from '@/lib/clerk-metadata';

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const clerkUserId = session.metadata?.clerk_user_id;
  if (!clerkUserId) {
    console.error('CRITICAL: No clerk_user_id in Stripe session metadata', {
      sessionId: session.id,
    });
    // Still update Supabase — source of truth for billing
    await updateSupabaseSubscription(session);
    return;
  }

  // 1. Always update Supabase first (your source of truth)
  await updateSupabaseSubscription(session);

  // 2. Update Clerk metadata (for JWT claims — best effort)
  try {
    await updateSubscriptionMetadata(clerkUserId, {
      horario_tier: 'starter',
      horario_status: 'active',
      horario_period_end: getPeriodEnd(session),
    });
  } catch (clerkError) {
    // Log for manual recovery — do NOT throw, webhook must return 200
    console.error('Clerk metadata update failed — manual recovery needed', {
      clerkUserId,
      sessionId: session.id,
      error: clerkError,
    });
    // The secure proxy can fall back to Supabase for tier if JWT claim is stale
  }
}
```

> **Recovery strategy:** Your `secure-proxy+api.ts` should fall back to querying
> Supabase for tier if `payload.horario_tier` is `null` but the user has an active
> subscription in the DB. The JWT claim is a performance optimization, not the sole
> source of truth.

✅ **Verify metadata update worked:**
```bash
# Using Clerk Dashboard
# Dashboard → Users → [select user] → Metadata tab → Public
# Should show:
{
  "horario_tier": "starter",
  "horario_status": "active",
  "horario_period_end": "2026-05-05T00:00:00Z"
}
```

Or via Clerk Management API:
```bash
curl https://api.clerk.com/v1/users/user_2abc123def456 \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  | jq '.public_metadata'
```

| Symptom | Cause | Fix |
|---|---|---|
| Metadata update succeeds but JWT still shows old tier | JWT is cached (60s TTL) | Wait 60s or call `getToken({ skipCache: true })` |
| `User not found` 404 from Clerk API | Wrong `clerkUserId` format | Must start with `user_` — check Stripe metadata was stored correctly |
| Metadata shows `{}` after update | Passed empty object to `updateUserMetadata` | Log the payload before sending to confirm it's populated |
| Webhook receives 200 but metadata never updates | `updateUserMetadata` threw silently | Add explicit try/catch with error logging |

---

## Step 4 — Clerk Webhook for `user.created`

When a new user signs up, Clerk sends a `user.created` webhook. Use this to
auto-provision a `subscriptions` row in Supabase with the `free` tier — so the user
has a valid subscription record before their first API call.

### 4.1 — Create the Webhook Endpoint in the Dashboard

1. **Dashboard → Configure → Webhooks → + Add endpoint**
2. Set fields:

| Field | Value |
|---|---|
| **Endpoint URL** | `https://YOUR-DOMAIN.vercel.app/api/clerk-webhook` |
| **Message Filtering** | Select `user.created` only |
| **Version** | Leave as default |

3. Click **Create**
4. On the endpoint detail page, reveal and copy the **Signing Secret**
   (format: `whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
5. Save it as `CLERK_WEBHOOK_SECRET` in `.env.local` and Vercel env vars

> **Why a dedicated `/api/clerk-webhook` route?**  
> Mixing webhook handling into `secure-proxy+api.ts` complicates signature
> verification and raw body parsing. A dedicated route is cleaner and easier to debug.

✅ **Verify the endpoint was created:** The webhook endpoint page shows status
**Enabled** and lists `user.created` under subscribed events.

### 4.2 — Install the Svix SDK

Clerk uses [Svix](https://svix.com) to sign and deliver webhooks. You must verify
the Svix signature — do not skip this; unauthenticated webhook endpoints are a
critical security vulnerability.

```bash
npm install svix
```

✅ **Verify:**
```bash
npm ls svix
# Expected: svix@1.x.x
```

### 4.3 — Handle the Raw Body Issue on Vercel

⚠️ **GOTCHA: Vercel's Node.js runtime parses the request body before it reaches your handler.**  
Svix signature verification requires the **raw, unparsed request body** as a string or
`Buffer`. If you call `await request.json()` before verifying the signature, the
signature check will fail.

**The fix:** Use `await request.text()` to get the raw body string, then parse it
yourself after verification.

```typescript
// ✅ Correct — raw body for verification
const rawBody = await request.text();               // raw string for Svix
const payload = JSON.parse(rawBody);               // parse after verification

// ❌ Wrong — body already consumed/transformed
const payload = await request.json();              // can't use for Svix verification
```

### 4.4 — Complete Webhook Handler

Create `app/api/clerk-webhook+api.ts`:

```typescript
// app/api/clerk-webhook+api.ts
// Node.js runtime (not Edge) — required for Svix and Supabase client
import { Webhook } from 'svix';
import { createClient } from '@supabase/supabase-js';

// Svix webhook event type for user.created
interface ClerkUserCreatedEvent {
  type: 'user.created';
  data: {
    id: string;                          // Clerk user ID, e.g. "user_2abc123def456"
    email_addresses: Array<{
      id: string;
      email_address: string;
      verification: { status: string };
    }>;
    primary_email_address_id: string;    // ID of the primary email in email_addresses
    first_name: string | null;
    last_name: string | null;
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

  // Step 2: Read raw body (MUST be text(), not json() — see GOTCHA above)
  const rawBody = await request.text();

  // Step 3: Verify Svix signature
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('CLERK_WEBHOOK_SECRET is not set');
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: ClerkUserCreatedEvent;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkUserCreatedEvent;
  } catch (verifyError) {
    console.error('Svix signature verification failed:', verifyError);
    return Response.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  // Step 4: Handle the event
  if (event.type !== 'user.created') {
    // Return 200 for unhandled event types — Svix will retry on non-2xx
    return Response.json({ message: 'Event type not handled' }, { status: 200 });
  }

  const { id: clerkUserId, email_addresses, primary_email_address_id, first_name, last_name } =
    event.data;

  // Find the primary email address
  const primaryEmail = email_addresses.find(
    (e) => e.id === primary_email_address_id,
  )?.email_address;

  // Step 5: Provision free-tier subscription row in Supabase
  const { error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      account_id: clerkUserId,           // Clerk user ID — FK to auth layer
      tier: 'free',
      status: 'active',
      created_at: new Date().toISOString(),
    });

  if (subscriptionError) {
    // Idempotency: if row already exists (e.g., duplicate webhook delivery), ignore
    if (subscriptionError.code === '23505') {
      // PostgreSQL unique constraint violation — already provisioned
      return Response.json({ message: 'Already provisioned' }, { status: 200 });
    }
    console.error('Failed to provision subscription for new user:', {
      clerkUserId,
      error: subscriptionError,
    });
    // Return 500 so Svix retries the webhook delivery
    return Response.json({ error: 'Provisioning failed' }, { status: 500 });
  }

  console.log('Provisioned free tier for new user:', { clerkUserId, primaryEmail });
  return Response.json({ message: 'User provisioned' }, { status: 200 });
}
```

### 4.5 — `user.created` Payload Structure (Exact Field Names)

For reference — the complete shape of `event.data` for `user.created`:

```typescript
// Clerk user.created event.data — exact field names as of 2025
{
  id: "user_2abc123def456",                    // ← use this as account_id in Supabase
  object: "user",
  external_id: null,
  primary_email_address_id: "idn_2abc123",
  primary_phone_number_id: null,
  primary_web3_wallet_id: null,
  username: null,
  first_name: "María",
  last_name: "García",
  profile_image_url: "https://img.clerk.com/...",
  image_url: "https://img.clerk.com/...",
  has_image: true,
  public_metadata: {},                          // ← empty on creation
  private_metadata: {},
  unsafe_metadata: {},
  email_addresses: [
    {
      id: "idn_2abc123",
      object: "email_address",
      email_address: "maria@example.com",
      reserved: false,
      verification: {
        status: "verified",
        strategy: "email_code"
      },
      linked_to: []
    }
  ],
  phone_numbers: [],
  web3_wallets: [],
  external_accounts: [],
  created_at: 1716000000000,                   // milliseconds (not seconds!)
  updated_at: 1716000000000
}
```

✅ **Verify the webhook is working:**
1. **Dashboard → Configure → Webhooks → [your endpoint]**
2. Create a new test user: **Dashboard → Users → Create user**
3. Return to the webhook endpoint page and check **Recent deliveries**
4. The delivery should show **Status: 200** and the response body `{"message":"User provisioned"}`
5. In Supabase: `SELECT * FROM subscriptions WHERE account_id = 'user_2abc123def456'`
   — should return one row with `tier: 'free'`, `status: 'active'`

| Symptom | Cause | Fix |
|---|---|---|
| `401 Invalid webhook signature` | Using wrong secret | Use the **Signing Secret** from the webhook endpoint page — NOT your Clerk Secret Key |
| `400 Missing Svix headers` | Testing with curl without headers | Use the **Send test event** button in Clerk Dashboard instead |
| Webhook shows `500` in delivery log | Supabase insert failed | Check `SUPABASE_SERVICE_ROLE_KEY` is set and `subscriptions` table exists |
| Same `user.created` delivered twice | Svix retries on timeout | Add idempotency check (`23505` unique constraint) — already in handler above |
| Webhook endpoint not found (404) | Route file not deployed | Confirm `app/api/clerk-webhook+api.ts` exists and Vercel deployment succeeded |

---

## Step 5 — Token Retrieval in Expo (Client-Side)

### 5.1 — Setup: `ClerkProvider` with `tokenCache`

```typescript
// app/_layout.tsx
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';  // ← correct path for v3
import { Slot } from 'expo-router';

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <Slot />
    </ClerkProvider>
  );
}
```

⚠️ **GOTCHA: Import path changed in `@clerk/expo` v3.**  
The old path `@clerk/clerk-expo/token-cache` no longer exists. The correct import is:
```typescript
import { tokenCache } from '@clerk/expo/token-cache';  // ✅ v3
import { tokenCache } from '@clerk/clerk-expo/token-cache'; // ❌ old — will throw
```
[Source: @clerk/expo v3 migration guide](https://clerk.com/docs/upgrade-guides/expo-v3)

⚠️ **GOTCHA: `expo-secure-store` is unavailable on web — crashes if not guarded.**  
The built-in `tokenCache` from `@clerk/expo/token-cache` handles this automatically
for native targets. If you're also targeting web (Expo Router web), confirm that the
built-in cache handles the web case (it passes `undefined` on web). If you implement
a custom `tokenCache`, guard it:
```typescript
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const tokenCache = Platform.OS === 'web'
  ? undefined  // ClerkProvider accepts undefined tokenCache for web
  : {
      getToken: (key: string) => SecureStore.getItemAsync(key),
      saveToken: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    };
```

⚠️ **GOTCHA: SecureStore on Android has a 2 KiB value size limit.**  
Large JWTs (with many claims, org claims, etc.) may fail silently on some Android
devices. Keep your `horario` JWT template lean — the three `horario_*` claims are
well within limits. If you add more claims in the future, test on a physical Android
device.
[Source: Expo SecureStore docs — known limitations](https://docs.expo.dev/versions/latest/sdk/securestore/)

### 5.2 — Calling `getToken` in Components

```typescript
// hooks/useHorarioToken.ts
import { useAuth } from '@clerk/expo';
import { useCallback } from 'react';

export function useHorarioToken() {
  const { getToken, isSignedIn } = useAuth();

  const getHorarioToken = useCallback(async (): Promise<string | null> => {
    // ⚠️ Always check isSignedIn first
    if (!isSignedIn) return null;

    const token = await getToken({ template: 'horario' });

    // ⚠️ getToken returns null if the user is signed out or session expired
    if (!token) {
      console.warn('getToken returned null — user may be signed out');
      return null;
    }

    return token;
  }, [getToken, isSignedIn]);

  return { getHorarioToken };
}
```

⚠️ **GOTCHA: `getToken()` returns `null` if the user is not signed in.**  
This is not an error — it's expected behavior. Never assume `getToken()` returns a
string. Always null-check before using the token in API calls.

```typescript
// ✅ Correct usage
const { getHorarioToken } = useHorarioToken();

async function callSecureProxy(action: string, params: object) {
  const token = await getHorarioToken();
  if (!token) {
    // Handle unauthenticated state — redirect to sign-in or show error
    router.push('/sign-in');
    return;
  }

  const response = await fetch('/api/secure-proxy', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, params }),
  });
  // ...
}
```

⚠️ **GOTCHA: `getToken()` is async and adds network latency on cache miss.**  
Each `getToken()` call that misses the local cache makes a network request to Clerk's
servers (~50–200ms). Do not call it inside a render loop or on every keystroke.
Cache the token for the duration of a single API request sequence:

```typescript
// ✅ Get the token once per user-initiated action, reuse within the same flow
async function handleCheckout() {
  const token = await getHorarioToken();  // one call
  if (!token) return;

  // Reuse `token` for all calls in this flow — don't call getToken() again
  await createCheckoutSession(token, planId);
  await logCheckoutInitiated(token, planId);
}
```

✅ **Verify `getToken` works:**
```typescript
// Add to a test screen temporarily
import { useAuth } from '@clerk/expo';

export default function TestScreen() {
  const { getToken } = useAuth();

  async function testToken() {
    const token = await getToken({ template: 'horario' });
    if (!token) {
      console.log('❌ getToken returned null — not signed in?');
      return;
    }
    const payload = JSON.parse(atob(token.split('.')[1]));
    console.log('✅ Token payload:', JSON.stringify(payload, null, 2));
    // Should log: { sub: "user_xxx", horario_tier: null, ... }
  }

  return <Button title="Test Token" onPress={testToken} />;
}
```

| Symptom | Cause | Fix |
|---|---|---|
| `getToken` always returns `null` | User not signed in | Check `isSignedIn` before calling `getToken` |
| `Cannot read property 'getToken' of undefined` | `useAuth` called outside `ClerkProvider` | Ensure component is inside `<ClerkProvider>` in layout |
| Module not found: `@clerk/expo/token-cache` | Old `@clerk/expo` version | `npm install @clerk/expo@latest` |
| Token works in Expo Go but not in production build | Missing scheme in app config | Add `scheme` to `app.json` (see Step 6) |

---

## Step 6 — Allowed Redirect URLs for Billing

Clerk validates redirect URLs during OAuth flows and billing redirects. Any URL not
on the allowlist will result in a redirect error.

### 6.1 — Configure Redirect URLs in Dashboard

1. **Dashboard → Configure → Paths**
2. Scroll to **Redirect URLs** section
3. Click **+ Add redirect URL** for each of the following:

| URL | Purpose |
|---|---|
| `https://YOUR-DOMAIN.vercel.app/billing/success` | Stripe/Culqi post-payment success |
| `https://YOUR-DOMAIN.vercel.app/billing/cancel` | Stripe/Culqi post-payment cancel |
| `exp://localhost:8081` | Expo Go development (local) |
| `exp://localhost:8081/--/billing/success` | Expo Go dev — billing deep link |
| `horario://billing/success` | Production native app — billing success deep link |
| `horario://billing/cancel` | Production native app — billing cancel deep link |
| `horario://` | Root deep link scheme |

> **Replace `YOUR-DOMAIN`** with your actual Vercel domain.
> For preview deployments, also add `https://*.vercel.app/billing/success` using a
> wildcard (Clerk supports `*` wildcards in redirect URLs).

### 6.2 — Configure App Scheme in `app.json`

The `horario://` deep link scheme must be registered in your Expo app config:

```json
// app.json
{
  "expo": {
    "name": "Horario",
    "slug": "horario",
    "scheme": "horario",
    "ios": {
      "bundleIdentifier": "com.yourcompany.horario"
    },
    "android": {
      "package": "com.yourcompany.horario",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "horario"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

✅ **Verify the scheme is registered:**
```bash
npx uri-scheme list
# Expected output should include: horario
```

✅ **Verify redirect URLs saved:** After adding, the **Redirect URLs** list in the
Clerk Dashboard should show all entries. There is no save button — changes apply
immediately on add/remove.

| Symptom | Cause | Fix |
|---|---|---|
| `Redirect URL not on allowlist` error | URL missing from Clerk config | Add the exact URL to Dashboard → Configure → Paths |
| Deep link opens browser instead of app | Scheme not registered | Add `scheme: "horario"` to `app.json` |
| Works in Expo Go, fails in production build | Expo Go uses `exp://`, production uses `horario://` | Add both to allowlist |
| Preview deploy redirect fails | Exact preview URL not added | Add wildcard `https://*.vercel.app/billing/*` |

---

## Step 7 — Testing the Full Billing Flow

Follow these steps in order to verify the complete payment → tier update → JWT
refresh cycle works end-to-end.

### 7.1 — Pre-Test Checklist

- [ ] JWT template `horario` is active (Step 1)
- [ ] `CLERK_SECRET_KEY` is set in Vercel env vars (Step 2)
- [ ] Clerk webhook endpoint is configured and shows **Enabled** (Step 4)
- [ ] `CLERK_WEBHOOK_SECRET` is set in Vercel env vars (Step 4)
- [ ] A test user exists in Clerk with email you can sign in with

### 7.2 — Step-by-Step Test Flow

**Step A — Confirm baseline JWT (tier should be null):**
```typescript
const token = await getToken({ template: 'horario' });
const payload = JSON.parse(atob(token.split('.')[1]));
console.log('Before payment:', payload.horario_tier);
// Expected: null
```

**Step B — Initiate test checkout:**
1. In your app, trigger the checkout flow for the `starter` plan
2. Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC
3. Complete the checkout

**Step C — Verify Stripe webhook fired (within ~5 seconds of payment):**
1. **Stripe Dashboard → Developers → Webhooks → [your endpoint]**
2. Check **Recent deliveries** — should show `checkout.session.completed` with status `200`

**Step D — Verify Clerk metadata updated (within ~10 seconds):**
```bash
curl https://api.clerk.com/v1/users/USER_ID \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  | jq '.public_metadata'
# Expected:
# {
#   "horario_tier": "starter",
#   "horario_status": "active",
#   "horario_period_end": "2026-05-05T00:00:00Z"
# }
```

**Step E — Force JWT refresh and verify new tier:**
```typescript
// Wait at least 60 seconds OR use skipCache to force refresh
const freshToken = await getToken({ template: 'horario', skipCache: true });
const payload = JSON.parse(atob(freshToken.split('.')[1]));
console.log('After payment:', payload.horario_tier);
// Expected: "starter"
```

**Step F — Verify Supabase subscription row updated:**
```sql
-- Run in Supabase SQL Editor
SELECT account_id, tier, status, updated_at
FROM subscriptions
WHERE account_id = 'user_2abc123def456';
-- Expected: tier = 'starter', status = 'active'
```

### 7.3 — Expected Timeline

```
T+0s    User clicks "Pay" in app
T+1s    Stripe Checkout page loads
T+15s   User completes payment
T+16s   Stripe sends checkout.session.completed webhook to Vercel
T+17s   Vercel handler runs: updates Supabase + calls Clerk updateUserMetadata
T+18s   Clerk publicMetadata updated
T+18s   App navigates to /billing/success
T+78s   Old JWT expires; next getToken() call issues fresh token with horario_tier: "starter"
        (or immediately if skipCache: true is used on the success screen)
```

### 7.4 — How to Force an Immediate JWT Refresh

```typescript
// app/billing/success.tsx
import { useEffect } from 'react';
import { useAuth } from '@clerk/expo';

export default function BillingSuccessScreen() {
  const { getToken } = useAuth();

  useEffect(() => {
    // Trigger a fresh token fetch on the success screen
    // This will reflect the new tier in the app without waiting for the 60s cache
    const refreshToken = async () => {
      // Add a small delay to allow webhook processing to complete
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const token = await getToken({ template: 'horario', skipCache: true });
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        console.log('Tier after payment:', payload.horario_tier);
      }
    };
    refreshToken();
  }, []);

  // ... rest of success screen
}
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `horario_tier` is `null` after payment | Webhook hasn't fired yet OR Clerk metadata update failed | Check Stripe webhook delivery logs; verify `CLERK_SECRET_KEY` is correct in Vercel |
| `horario_tier` is `null` in JWT but shows in Clerk Dashboard | JWT is still cached (60s TTL) | Wait 60s or call `getToken({ skipCache: true })` |
| JWT claims missing entirely (not even null) | Template name mismatch | Confirm `getToken({ template: 'horario' })` — exact spelling, no caps |
| Clerk webhook returns 401 | Using Clerk Secret Key instead of Svix Signing Secret | `CLERK_WEBHOOK_SECRET` must be the `whsec_...` value from the webhook endpoint page |
| New users not getting `subscriptions` row | Webhook endpoint not receiving events | Check Clerk Dashboard → Webhooks → Recent deliveries for errors |
| `updateUserMetadata` succeeds but metadata is wrong | Merge behavior — old keys persisted | Explicitly set old keys to `null` if removing them |
| App crashes on Android after sign-in | SecureStore token size exceeded 2 KiB | Reduce JWT claims; implement try/catch in custom tokenCache |
| Deep link returns to browser after payment | `horario://` scheme not in redirect allowlist | Add `horario://billing/success` to Clerk Dashboard → Paths |
| `Cannot find module '@clerk/expo/token-cache'` | Outdated `@clerk/expo` version | `npm install @clerk/expo@latest` |
| Supabase RLS denies requests after Session Token V2 migration | V2 changed JWT claim structure | Re-audit all `auth.jwt()->>` references in Supabase policies |
| Webhook delivers successfully in test, fails in production | Environment variable missing on Vercel | Confirm `CLERK_WEBHOOK_SECRET` is set for **Production** environment in Vercel |
| `getToken` returns `null` intermittently on iOS | Session refresh race condition | Implement retry with exponential backoff: retry up to 3x with 500ms delay |
| Stripe metadata missing `clerk_user_id` | Checkout session created before user was identified | Ensure user is signed in before initiating checkout; log `clerkUserId` at checkout creation |

---

## Final Checklist

- [ ] **Session Token V2 migration complete** — Dashboard → Updates
- [ ] **JWT template `horario` created** with exact name `horario` — Dashboard → Configure → JWT Templates
- [ ] **Template claims JSON** contains all three `horario_*` claims with correct Handlebars syntax
- [ ] **Token lifetime set to 60 seconds** in template settings
- [ ] **JWT template tested** via the Test tab — decoded payload shows `horario_*` claims (value: `null` for new users)
- [ ] **`@clerk/backend` installed** — `npm ls @clerk/backend` shows `1.x.x`+
- [ ] **`@clerk/clerk-sdk-node` removed** — `npm ls @clerk/clerk-sdk-node` shows nothing
- [ ] **`CLERK_SECRET_KEY` added** to `.env.local` AND Vercel environment variables (all environments)
- [ ] **Clerk webhook endpoint created** for `user.created` — Dashboard → Configure → Webhooks
- [ ] **`CLERK_WEBHOOK_SECRET` (`whsec_...`)** added to `.env.local` AND Vercel environment variables
- [ ] **Svix signature verification** implemented in `app/api/clerk-webhook+api.ts`
- [ ] **Raw body read via `request.text()`** (not `request.json()`) in webhook handler
- [ ] **Stripe checkout stores `clerk_user_id`** in session `metadata` at creation time
- [ ] **All redirect URLs added** to Dashboard → Configure → Paths (web + deep links)
- [ ] **`scheme: "horario"`** set in `app.json`
- [ ] **Full billing flow tested end-to-end** — payment → webhook → metadata update → fresh JWT shows new tier
```