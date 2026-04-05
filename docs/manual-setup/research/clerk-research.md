Now I have comprehensive research data. Let me compile the full gotcha report.Now I have all the data I need. Let me compile the comprehensive gotcha report.

---

# 🔐 Clerk Auth Integration: 15 Critical GOTCHAs for Horario (Expo SDK 53 + RN 0.79 + Vercel)

*Research-backed from Clerk docs, GitHub issues, npm changelogs, and Supabase docs — 2024–2025.*

---

## GOTCHA #1 — `@clerk/clerk-sdk-node` IS DEAD. DO NOT USE IT.

**PROBLEM:**
Starting October 8, 2024, the Node SDK entered a three-month notice period. January 10, 2025 marks the end of support for `@clerk/clerk-sdk-node`. Many tutorials and StackOverflow answers still reference it. If Horario's `secure-proxy+api.ts` imports from `@clerk/clerk-sdk-node`, it is running on an unmaintained package that will no longer receive security patches.

**FIX:**
Migrate to `@clerk/backend` and use `createClerkClient()` with a `secretKey` option. The correct pattern for a Vercel serverless route is:

```ts
// app/api/secure-proxy+api.ts  ← Node.js runtime, NOT Edge
import { createClerkClient } from '@clerk/backend'

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!,
})

export async function POST(request: Request) {
  const { isAuthenticated, toAuth } = await clerk.authenticateRequest(request, {
    authorizedParties: ['https://horario.vercel.app'],
  })
  if (!isAuthenticated) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { userId } = toAuth()
  // ... proxy to Stripe/Culqi
}
```

**SOURCE:** npm `@clerk/clerk-sdk-node` — "Express users can migrate to the `@clerk/express` package. For generic Node.js environments use `@clerk/backend`." | Clerk changelog 2025-01-10

---

## GOTCHA #2 — Session Token V1 Was Deprecated April 14, 2025

**PROBLEM:**
Version 1 of Clerk's session token format was deprecated on April 14, 2025. You must upgrade to version 2 via the **Updates** page in the Clerk Dashboard. If Horario was set up before April 2025, your JWT templates and RLS policies may reference claims that have changed between v1 and v2, silently breaking authentication without a clear error.

**FIX:**
1. Go to Clerk Dashboard → **Updates** → migrate to Session Token v2.
2. Every generated token has default claims that cannot be overridden by templates. Audit your JWT templates and RLS policies after upgrading — the `org_*` claims structure and other fields differ.
3. Test `getToken()` responses with `console.log(JSON.parse(atob(token.split('.')[1])))` after migrating.

**SOURCE:** Clerk changelog 2025-04-14: "As of today, April 14, 2025, version 1 of the session token format is deprecated."

---

## GOTCHA #3 — `tokenCache` Import Path Changed & Web Crashes Without Platform Guard

**PROBLEM:**
Older tutorials and some blog posts (including Clerk's own earlier docs) show:
```ts
import { tokenCache } from '@clerk/clerk-expo/token-cache'  // ❌ OLD path
```
The current `@clerk/expo` v1+ path is:
```ts
import { tokenCache } from '@clerk/expo/token-cache'  // ✅ CORRECT
```
Additionally, `expo-secure-store` is unavailable on web, so if your Expo app targets web, the `tokenCache` import will crash at runtime.

**FIX:**
Use the built-in token cache from `@clerk/expo/token-cache` and pass it to `ClerkProvider`:
```tsx
import { ClerkProvider } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <Slot />
    </ClerkProvider>
  )
}
```
The `clerk-expo-starter` reference implementation creates the cache conditionally: `SecureStore` is not supported on the web, so the `createTokenCache` function returns `undefined` on web platforms.

**SOURCE:** Clerk Expo Quickstart (2025) | `clerk/clerk-expo-starter` on GitHub

---

## GOTCHA #4 — `SecureStore` Android Key Size Limit Silently Drops Tokens

**PROBLEM:**
Expo's SecureStore on Android has a key size limit. People have reported running into limits on some devices when writing large strings — the limit is 2 KiB, and larger values may fail silently. Clerk's JWT tokens for complex sessions (with org claims, custom metadata) can exceed this limit. The symptom is users appearing logged out on Android cold-start even though they authenticated successfully.

**FIX:**
- Keep custom JWT claims lean (<1.2 KB total for the session cookie, ideally much less for the SecureStore value).
- Implement a `deleteToken` alongside `getToken`/`saveToken` to handle errors gracefully:
```ts
const tokenCache = {
  async getToken(key: string) {
    try { return await SecureStore.getItemAsync(key) }
    catch { return null }
  },
  async saveToken(key: string, value: string) {
    try { await SecureStore.setItemAsync(key, value) }
    catch (e) { await SecureStore.deleteItemAsync(key) } // ← clear corrupted entries
  },
}
```

**SOURCE:** Expo GitHub issue #3963 — "SecureStore on Android is particularly tricky because of such high device fragmentation… people have reported running into limits on some devices when writing large strings."

---

## GOTCHA #5 — Stale JWT After `publicMetadata` Update (The Race Condition)

**PROBLEM:**
You update `publicMetadata` (e.g., `plan: 'pro'`) via your backend after a Stripe payment. The backend confirms success. But the client's next `getToken()` call still returns the **old token** with `plan: 'free'` because Clerk caches tokens for ~60 seconds. Your RLS policies or API guards see the old claim and deny access or show incorrect UI for up to 1 minute.

**FIX:**
If you use Clerk metadata and modify it server-side, the changes won't appear in the session token until the next refresh. To avoid race conditions, either force a JWT refresh after metadata changes or handle the delay in your application logic.

Force refresh immediately after the metadata update from the client:
```ts
// After your /api/upgrade-plan response returns 200:
const { getToken } = useAuth()
await getToken({ skipCache: true })  // ← forces a network round-trip to Clerk
// Now re-fetch your user/plan state
```
The `getToken({ skipCache: true })` option forces a session token refresh.

**SOURCE:** Clerk docs — "User metadata" + "Force a session token refresh"

---

## GOTCHA #6 — JWT Template Shortcodes Return `null` When Metadata Is Not Yet Set

**PROBLEM:**
You create a JWT template with:
```json
{ "plan": "{{user.public_metadata.plan}}" }
```
For **newly created users** who haven't gone through your onboarding webhook yet, `publicMetadata.plan` doesn't exist. The generated token will contain `"surname": null` (using the docs' example) — the shortcode resolves to `null` rather than being omitted. Your backend code doing `if (claims.plan === 'free')` will fail because `null !== 'free'`.

**FIX:**
Always null-guard claims on the backend:
```ts
const plan = (sessionClaims?.plan as string) ?? 'free'  // ← default fallback
```
And in your JWT template, use a static default where possible, or handle null in Supabase RLS:
```sql
-- RLS: treat null plan as 'free'
COALESCE((auth.jwt()->>'plan')::text, 'free') = 'free'
```
Ensure your `user.created` webhook fires and sets `publicMetadata.plan = 'free'` before users make their first authenticated request.

**SOURCE:** Clerk JWT templates docs — shortcodes resolve to `null` when the value is not set on the user object.

---

## GOTCHA #7 — JWT Templates Do NOT Include `sid` (Session ID) — They Are Not Session Tokens

**PROBLEM:**
Developers use `getToken({ template: 'supabase' })` and assume the resulting JWT is a full session token with all standard claims. It is not. For custom JWTs, Clerk automatically includes the `sub` (user ID) claim, but other default claims — such as `sid` (session ID) — are only included in session-bound tokens, not in custom JWTs. If your Supabase RLS or backend tries to read `sid` from a template token, it will be `undefined`.

**FIX:**
- Use the **session token** (no template) for standard Clerk middleware auth.
- Use **JWT templates** only for third-party integrations (Supabase, Hasura, Tinybird) that need specific claim shapes.
- If you need a token that includes both session-bound data (like `sid`) and additional claims, use a custom **session token** instead of a JWT template.

**SOURCE:** Clerk docs — "JWT templates" section on default vs. custom claims.

---

## GOTCHA #8 — Webhook Svix Verification Fails When Body Is Pre-Parsed (JSON Middleware)

**PROBLEM:**
Expo Router API routes with a global `express.json()` or Next.js body parser applied will **silently mutate** the raw body before it reaches your Svix verification call. The signature check then fails with `"WebhookVerificationError: No matching signature found"` for every single Clerk webhook event, making webhooks completely non-functional.

**FIX:**
You should watch out for frameworks that parse the request as JSON and then stringify it because this too will break the signature verification. You must pass the raw (string/bytes) representation of the request body to `wh.verify()`.

In your Expo Router API route (Node.js runtime):
```ts
// app/api/webhooks/clerk+api.ts
export async function POST(request: Request) {
  const rawBody = await request.text()  // ← MUST be text(), NOT .json()
  const svixId = request.headers.get('svix-id') ?? ''
  const svixTs = request.headers.get('svix-timestamp') ?? ''
  const svixSig = request.headers.get('svix-signature') ?? ''

  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!)
  const evt = wh.verify(rawBody, {
    'svix-id': svixId,
    'svix-timestamp': svixTs,
    'svix-signature': svixSig,
  }) as WebhookEvent
}
```
Alternatively, use Clerk's new first-party helper: use Clerk's `verifyWebhook` helper to verify the signature instead of raw `svix` calls.

**SOURCE:** Svix docs + GitHub expressjs/express#6025 — "Expected payload to be of type string or Buffer."

---

## GOTCHA #9 — `user.created` Webhook Payload Uses Snake_case, NOT camelCase

**PROBLEM:**
Clerk's frontend SDK (`useUser()`) returns camelCase: `user.primaryEmailAddressId`, `user.firstName`. But the webhook payload is **snake_case** like the Backend API:

```json
{
  "data": {
    "first_name": "Ana",
    "primary_email_address_id": "idn_xxx",
    "email_addresses": [{ "email_address": "ana@example.com" }]
  }
}
```

Developers copy frontend code into webhook handlers and get `undefined` for every field.

**FIX:**
The webhook payload's `data` field contains the Clerk User object in Backend API format. For `user.*` events, access email via `data.email_addresses.find(e => e.id === data.primary_email_address_id).email_address`.

```ts
case 'user.created': {
  const { id, first_name, last_name, email_addresses, primary_email_address_id } = evt.data
  const email = email_addresses.find(e => e.id === primary_email_address_id)?.email_address
  await supabase.from('users').insert({ clerk_id: id, email, first_name, last_name })
  break
}
```

**SOURCE:** Clerk webhooks overview docs — "for `user.*` events, the payload will always be the User object" in Backend API snake_case format.

---

## GOTCHA #10 — `updateUserMetadata()` Merges, Not Replaces (Deep Merge Gotcha)

**PROBLEM:**
The `updateUserMetadata()` function in the JS Backend SDK updates metadata using a **merge** strategy. If you previously set `publicMetadata: { plan: 'free', onboarded: true }` and then call:
```ts
await clerk.users.updateUserMetadata(userId, { publicMetadata: { plan: 'pro' } })
```
The result is `{ plan: 'pro', onboarded: true }` — the old keys are preserved. This is intentional but trips up developers who expect a full replace. Conversely, if you want to **replace** all metadata, you must explicitly set old keys to `null` or use `updateUser()` which **does** replace.

**FIX:**
- For **merge**: use `updateUserMetadata()` (safe for partial updates).
- For **full replace**: use `updateUser({ publicMetadata: { ...completeObject } })` which overwrites.
- When deleting a metadata key, explicitly pass `null`:
```ts
await clerk.users.updateUserMetadata(userId, {
  publicMetadata: { trialEndsAt: null }  // ← removes the key
})
```

**SOURCE:** Clerk `updateOrganization()` docs — "Updating this property will override the existing metadata. To merge metadata, use `updateOrganizationMetadata()`." (Same applies to users.)

---

## GOTCHA #11 — Custom `aud` Claim in Session Token Breaks `getAuth()` / `authenticateRequest()`

**PROBLEM:**
When a custom `aud` claim is added to the session token, `getAuth()` fails with `"Invalid JWT audience claim (aud). Expected 'undefined'. Make sure that this is a valid Clerk generated JWT." This happens if you add `"aud": "https://horario.vercel.app"` to your **main session token** (not a JWT template), thinking it hardens security. Clerk's own SDK doesn't expect `aud` on the default session token.

**FIX:**
- **Never** add `aud` to the default session token customization.
- If your Supabase or external service requires an `aud` claim, put it in a **JWT template** and call `getToken({ template: 'supabase' })` separately — never use that template as your primary auth token.
- If using `authenticateRequest()` on your proxy, pass `authorizedParties` instead of relying on `aud`:
```ts
await clerkClient.authenticateRequest(request, {
  authorizedParties: ['https://horario.vercel.app'],
})
```

**SOURCE:** Clerk GitHub issue #1507 — "`aud` claim breaks `getAuth()` in `getServerSideProps`"

---

## GOTCHA #12 — Session Cookie 4KB Limit Silently Breaks Auth on Web (Even in Expo Web)

**PROBLEM:**
Clerk stores the session token in a cookie, and most browsers limit cookie size to 4KB. Exceeding this limit will cause the cookie to not be set, which will break your app as Clerk depends on cookies to work properly. After accounting for the size of Clerk's default claims, the cookie can support up to **1.2KB of custom claims**.

Horario risk: if you embed `publicMetadata` (Stripe customer ID, Culqi token, plan, org info, etc.) all into the session token's custom claims, you can silently exceed 4KB. Users appear logged out with no error.

**FIX:**
If you need to store more than 1.2KB of metadata, store the extra data in your own database (Supabase) instead. Keep the JWT claims minimal:
```json
// ✅ LEAN - store only what's needed for gate checks
{ "plan": "pro", "stripe_customer_id": "cus_xxx" }

// ❌ DANGEROUS - don't embed full objects
{ "stripe_data": { ...fullCustomerObject }, "org": { ...allOrgData } }
```
Use a separate Supabase query for full profile data rather than bloating the token.

**SOURCE:** Clerk session tokens docs — "Exceeding this limit will cause the cookie to not be set, which will break your app."

---

## GOTCHA #13 — Old Clerk + Supabase JWT Template Integration Is Deprecated (April 2025)

**PROBLEM:**
All older tutorials (pre-April 2025) instruct you to:
1. Create a Supabase JWT template in Clerk Dashboard.
2. Call `getToken({ template: 'supabase' })`.
3. Pass that token to `supabaseClient.auth.setSession()`.
4. Write RLS policies with a custom `requesting_user_id()` function.

As of April 1st, 2025, the Clerk Supabase JWT template is considered deprecated. Going forward, the native Supabase third-party integration is the recommended way to integrate Clerk with Supabase.

**FIX:**
Clerk is now supported as a Supabase third-party authentication provider. This first-class integration allows Supabase to accept Clerk-signed session tokens, removing the need to create a custom JWT template and generate a specific token when interacting with Supabase.

New setup:
1. In Supabase Dashboard → Authentication → **Third-party Auth** → Add Clerk.
2. Pass your Clerk domain (e.g., `https://clerk.horario.app`).
3. Use the standard session token (no template) as the Supabase Bearer token.
4. **Critical RLS gotcha**: Clerk uses string-based identifiers whereas Supabase uses UUIDs. Since `auth.uid()` returns a UUID, this function cannot be used when accessing Supabase data with Clerk.

```sql
-- ✅ CORRECT for new Clerk+Supabase integration
CREATE POLICY "user_own_data" ON schedules
  USING ((auth.jwt() ->> 'sub') = user_id);

-- ❌ WRONG - auth.uid() returns NULL with Clerk JWTs
CREATE POLICY "user_own_data" ON schedules
  USING (auth.uid() = user_id);
```

**SOURCE:** Clerk docs — "Integrate Supabase with Clerk" + Supabase third-party auth docs (April 2025).

---

## GOTCHA #14 — `useUser().user.publicMetadata` On Client Is Stale After Server-Side Update

**PROBLEM:**
After your webhook updates `publicMetadata` (e.g., webhook fires after Stripe payment, sets `plan: 'pro'`), the `useUser()` hook in React Native still returns the **old** `publicMetadata` from the in-memory client-side User object. The data is fresh on the server but the client hasn't re-fetched. Users see the wrong plan in UI even after successful upgrade.

**FIX:**
Call `user.reload()` after your payment flow completes to force a re-fetch of the User object from Clerk's API:
```ts
const { user } = useUser()
const { getToken } = useAuth()

const handleUpgradeSuccess = async () => {
  await user?.reload()              // ← re-fetches publicMetadata from Clerk
  await getToken({ skipCache: true }) // ← gets fresh JWT with new claims
  // Now user.publicMetadata.plan === 'pro'
}
```
Also note: webhooks are **asynchronous** — there may be a 1–5 second delay between Stripe firing the event and your webhook handler updating Clerk. Add a short polling retry or optimistic UI for payment confirmation.

**SOURCE:** Clerk `useUser()` hook — `user.reload()` re-fetches the user object from the Clerk API, updating all metadata.

---

## GOTCHA #15 — Clerk Billing vs. User `publicMetadata` for SaaS Plans: Choose the Right Tool

**PROBLEM:**
Many Horario-style apps manually store billing state in `publicMetadata` (`plan: 'pro'`, `stripeCustomerId: 'cus_xxx'`). This works but creates a synchronization problem: Stripe webhooks → your backend → Clerk metadata → client JWT, with 3 failure points. Meanwhile, Clerk now has a native Billing product.

**The two patterns:**

| Approach | When to Use | Tradeoffs |
|---|---|---|
| `publicMetadata.plan` | Custom Stripe/Culqi integration, custom pricing logic, Peru-specific Yape/PagoEfectivo | Full control, but you own sync. Use `updateUserMetadata()` from webhook handler. |
| Clerk Billing (native) | Global Stripe only, standard subscription UI | Zero sync code, `<PricingTable />` components, built-in `has({ plan: 'pro' })` checks — but **no Culqi/Yape support** |

**FIX for Horario (mixed Stripe + Culqi):**
Since Culqi is Peru-only and Clerk Billing only supports Stripe, use the **hybrid approach**:
- Use **Clerk Billing** for global Stripe subscribers (`has({ plan: 'pro' })` on the server).
- Use **`publicMetadata.culqi_status`** for Culqi/Yape subscribers, verified via your own webhook.
- Gate features server-side combining both:
```ts
const { has, sessionClaims } = await auth()
const isPro = has({ plan: 'pro' }) || sessionClaims?.culqi_status === 'active'
```

**SOURCE:** Clerk Billing — "Clerk Billing helps you add subscriptions to your SaaS app with minimal code... Like users, Organizations can have their own subscriptions." | Clerk Organizations + Billing docs — "Clerk Billing is designed with Organizations in mind."

---

## 📋 Quick Reference: All 15 GOTCHAs at a Glance

| # | GOTCHA | Severity | Fixed By |
|---|---|---|---|
| 1 | `@clerk/clerk-sdk-node` is EOL (Jan 10 2025) | 🔴 Critical | Migrate to `@clerk/backend` + `createClerkClient()` |
| 2 | Session Token V1 deprecated April 14 2025 | 🔴 Critical | Dashboard → Updates → migrate to V2 |
| 3 | `tokenCache` import path changed in `@clerk/expo` v1+ | 🟠 High | `@clerk/expo/token-cache` (not `@clerk/clerk-expo/token-cache`) |
| 4 | SecureStore Android 2KB limit silently drops JWT tokens | 🟠 High | Keep tokens lean + wrap `saveToken` in try/delete |
| 5 | Stale JWT after `publicMetadata` update (60s cache) | 🟠 High | `getToken({ skipCache: true })` after metadata update |
| 6 | JWT template shortcodes resolve to `null` for new users | 🟡 Medium | Null-guard all claims + set metadata on `user.created` webhook |
| 7 | JWT templates don't include `sid` claim | 🟡 Medium | Use session tokens for auth, templates only for 3rd-party |
| 8 | Svix verification fails when body is pre-parsed | 🔴 Critical | Use `request.text()` not `request.json()` in webhook handler |
| 9 | Webhook payload is snake_case, frontend SDK is camelCase | 🟠 High | Use `first_name`, `email_addresses`, `primary_email_address_id` |
| 10 | `updateUserMetadata()` merges, doesn't replace | 🟡 Medium | Use `updateUser()` for full replace; pass `null` to delete keys |
| 11 | Custom `aud` claim breaks `getAuth()` / `authenticateRequest()` | 🔴 Critical | Never add `aud` to session token; use `authorizedParties` |
| 12 | Session cookie 4KB limit silently breaks web auth | 🟠 High | Keep custom claims <1.2KB; store rich data in Supabase |
| 13 | Old Clerk+Supabase JWT template approach deprecated April 2025 | 🔴 Critical | Use native third-party auth; replace `auth.uid()` with `auth.jwt()->>'sub'` |
| 14 | `useUser().publicMetadata` stale after server-side update | 🟡 Medium | Call `user.reload()` + `getToken({ skipCache: true })` |
| 15 | Clerk Billing doesn't support Culqi/Yape | 🟡 Medium | Hybrid: Clerk Billing for Stripe + `publicMetadata` for Culqi |