# SETUP_SUPABASE.md

```markdown
# Supabase Setup — Horario

**Project:** `rfmdlzaqvmhbzbgjwhqn`
**Dashboard:** https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn
**SQL Editor:** https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/sql/new

Stack: Expo SDK 53 · React Native 0.79 · Expo Router v5 · Clerk Auth · Supabase PostgreSQL + RLS · Vercel Node.js

---

## Table of Contents

1. [Running the Migration](#1-running-the-migration)
2. [RLS Policy Verification](#2-rls-policy-verification)
3. [Enabling Realtime](#3-enabling-realtime)
4. [Service Role Key Security](#4-service-role-key-security)
5. [Connection Limits & Free Tier](#5-connection-limits--free-tier)
6. [Testing & Verification Queries](#6-testing--verification-queries)
7. [Troubleshooting](#7-troubleshooting)
8. [Setup Checklist](#8-setup-checklist)

---

## 1. Running the Migration

### 1.1 Open the migration file in VS Code

```bash
# From the Horario repo root:
code supabase/migrations/20260405000001_subscriptions.sql
```

Select all contents and copy:

- **macOS:** `Cmd+A` then `Cmd+C`
- **Windows/Linux:** `Ctrl+A` then `Ctrl+C`

✅ **Verify:** Your clipboard now holds the full SQL file. Confirm by checking the first line reads `-- Migration: subscriptions` (or the file's actual first comment).

---

### 1.2 Paste and run in the SQL editor

1. Open the [SQL Editor](https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/sql/new)
2. Click **New query** (top-left of the editor panel)
3. Click inside the editor body and paste (`Cmd+V` / `Ctrl+V`)
4. Click **Run** (▶ button, or `Cmd+Enter` / `Ctrl+Enter`)

✅ **Verify:** The **Results** panel at the bottom shows:

```
Success. No rows returned
```

or, if existing accounts were seeded into the `free` tier:

```
INSERT 0 <N>
```

where `<N>` is the number of rows seeded. Any red banner containing `ERROR:` means the migration did not complete — see [Troubleshooting](#7-troubleshooting).

---

### 1.3 What the migration creates

| Object | Type | Purpose |
|---|---|---|
| `subscriptions` | Table | Billing state per account |
| `idx_subscriptions_account_id` | Index | Fast lookup by account |
| `idx_subscriptions_stripe_customer_id` | Index | Stripe webhook routing |
| `idx_subscriptions_culqi_customer_id` | Index | Culqi/Yape webhook routing |
| RLS policies | Policies | `anon` read; `service_role` write |
| Seed rows | Data | Existing accounts → `free` tier |

---

### 1.4 Known migration gotchas

> ⚠️ **GOTCHA: PostgreSQL has no `CREATE POLICY IF NOT EXISTS` syntax**
>
> Unlike `CREATE TABLE IF NOT EXISTS`, there is no idempotent form of `CREATE POLICY`.
> Running a migration twice with bare `CREATE POLICY` statements throws:
>
> ```
> ERROR: 42710: policy "anon read subscriptions" for table "subscriptions" already exists
> ```
>
> **Fix already applied:** The migration uses the drop-before-create pattern on every policy:
>
> ```sql
> DROP POLICY IF EXISTS "anon read subscriptions" ON subscriptions;
> CREATE POLICY "anon read subscriptions"
>   ON subscriptions FOR SELECT
>   TO anon
>   USING (true);
> ```
>
> You do not need to change anything — this is documented so you understand why the pattern
> exists if you extend the migration file.
> ([Source: Supabase community discussion](https://github.com/orgs/supabase/discussions/35818))

> ⚠️ **GOTCHA: Running the migration twice is safe — here's exactly what happens**
>
> Every destructive statement in the migration is guarded:
>
> | Statement | Guard |
> |---|---|
> | `CREATE TABLE subscriptions` | `CREATE TABLE IF NOT EXISTS` |
> | `CREATE INDEX ...` | `CREATE INDEX IF NOT EXISTS` |
> | `CREATE POLICY ...` | Preceded by `DROP POLICY IF EXISTS` |
> | Seed `INSERT` | `INSERT ... ON CONFLICT (account_id) DO NOTHING` |
>
> Re-running produces the same success output with zero side effects.
> Existing subscription rows are untouched because of `ON CONFLICT DO NOTHING`.

---

## 2. RLS Policy Verification

### 2.1 Why RLS matters for billing data

Row-Level Security is the last line of defense between your billing records and an unauthenticated
HTTP request. Without RLS enabled, **any request that reaches the PostgREST API — including those
made with the public `anon` key — can read or modify every row** in the table. Stripe customer IDs,
subscription tiers, and payment status are all sensitive. RLS must be ON.

---

### 2.2 Verify RLS is enabled on all billing tables

Run this in the [SQL Editor](https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/sql/new):

```sql
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('subscriptions', 'usage_limits')
ORDER BY tablename;
```

✅ **Verify:** Expected output — both rows must show `true`:

| tablename | rls_enabled |
|---|---|
| subscriptions | true |
| usage_limits | true |

If any row shows `false`, run the fix immediately (see below).

---

### 2.3 All tables that MUST have RLS enabled

| Table | Contains | Risk if RLS is off |
|---|---|---|
| `subscriptions` | Tier, Stripe/Culqi IDs, billing dates | Full billing data exposure |
| `usage_limits` | Per-account feature quotas | Quota bypass |
| `accounts` | Clerk user/org mapping | Account enumeration |
| `schedules` | Business schedule config | Cross-tenant data leak |
| `bookings` | Appointment records | PII exposure |

---

### 2.4 Find ALL tables in your schema that have RLS disabled

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;
```

✅ **Verify:** This query returns **zero rows**. Any table listed here is publicly readable and
writable via the `anon` key — treat this as a critical security finding.

**Fix for any table returned:**

```sql
-- Replace <table_name> with the actual table name from the query above
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
```

> ⚠️ **GOTCHA: Enabling RLS without adding policies locks out everyone — including your app**
>
> `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with zero policies means **no rows are returned
> for any role, including `service_role` when operating through PostgREST** (direct `psql`
> connections as the database superuser are unaffected).
>
> Always add at minimum a `service_role` write policy and an `authenticated` read policy
> immediately after enabling RLS on a new table:
>
> ```sql
> -- Minimum viable policies after enabling RLS on a new table
> DROP POLICY IF EXISTS "service_role manages <table_name>" ON public.<table_name>;
> CREATE POLICY "service_role manages <table_name>"
>   ON public.<table_name>
>   TO service_role
>   USING (true)
>   WITH CHECK (true);
>
> DROP POLICY IF EXISTS "authenticated read own rows" ON public.<table_name>;
> CREATE POLICY "authenticated read own rows"
>   ON public.<table_name> FOR SELECT
>   TO authenticated
>   USING ((select auth.uid()) = user_id);
> ```

---

### 2.5 Verify policies exist on the subscriptions table

```sql
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'subscriptions'
ORDER BY policyname;
```

✅ **Verify:** You should see at least two policies — one for `anon` SELECT and one for
`service_role` ALL.

---

## 3. Enabling Realtime

Realtime allows the Horario mobile app to receive live subscription tier changes without polling,
so the UI updates immediately after a successful Stripe or Culqi payment.

### 3.1 Dashboard navigation (2024/2025)

Supabase moved the Replication UI in late 2024. The correct path is now:

1. Go to **Database** (left sidebar) → **Replication**
   Direct link: `https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/database/replication`
2. Under **Sources**, confirm `supabase_realtime` publication is listed
3. Click **0 tables** (or the current table count) next to `supabase_realtime`
4. Find `subscriptions` in the table list
5. Toggle the row to **ON**
6. Click **Save**

✅ **Verify:** After saving, the table count next to `supabase_realtime` increments by 1 and
`subscriptions` shows a green toggle.

---

### 3.2 Enable Realtime via SQL (alternative — matches CLI migrations)

If you prefer SQL or are scripting this step:

```sql
-- Add subscriptions table to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
```

✅ **Verify:**

```sql
SELECT pubname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'subscriptions';
```

Expected: 1 row returned. Zero rows means the publication change did not apply.

---

### 3.3 Subscribe to tier changes in React Native

Add this hook to the screen that gates features by subscription tier:

```typescript
// hooks/useSubscriptionRealtime.ts
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase'; // your anon-key client
import { useSubscriptionStore } from '@/stores/subscriptionStore';

export function useSubscriptionRealtime(accountId: string) {
  const setTier = useSubscriptionStore((s) => s.setTier);

  useEffect(() => {
    if (!accountId) return;

    const channel = supabase
      .channel(`subscription-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'subscriptions',
          // Filter server-side to only this account's row
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const updated = payload.new as { tier: string; status: string };
          setTier(updated.tier, updated.status);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to subscription changes');
        }
      });

    // CRITICAL: remove the channel on unmount to avoid connection leaks
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, setTier]);
}
```

---

### 3.4 Realtime gotchas

> ⚠️ **GOTCHA: Table not in the publication = silent failure**
>
> Calling `.on('postgres_changes', ...)` on a table not added to `supabase_realtime`
> succeeds (no error thrown) but fires **zero events**. This is the most common reason
> Realtime "doesn't work."
>
> **Fix:** Run the verification query in [3.2](#32-enable-realtime-via-sql-alternative--matches-cli-migrations).
> If 0 rows are returned, run `ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;`
>
> ([Source: Supabase Realtime docs](https://supabase.com/docs/guides/realtime/postgres-changes))

> ⚠️ **GOTCHA: Free plan caps Realtime at 200 concurrent connections**
>
> The Supabase free tier allows a maximum of **200 concurrent Realtime connections** across
> your entire project. On Horario, each active mobile session that calls `useSubscriptionRealtime`
> consumes one connection.
>
> **At 200 active users simultaneously, new connections are silently dropped** — the subscribe
> callback receives `'CHANNEL_ERROR'` instead of `'SUBSCRIBED'`.
>
> **Mitigation on free plan:**
> - Only subscribe when the user is on a paywalled screen, not globally in `_layout.tsx`
> - Unsubscribe aggressively on blur events using `useFocusEffect`
> - Poll as fallback: if `status !== 'SUBSCRIBED'` after 5 seconds, fall back to a REST fetch
>
> **Long-term fix:** Upgrade to Pro ($25/mo) for 500 concurrent connections, or use
> [Broadcast via triggers](https://supabase.com/docs/guides/realtime/broadcast) which is
> more efficient at scale.

> ⚠️ **GOTCHA: `filter` param on `postgres_changes` requires the column to be indexed**
>
> The `filter: 'account_id=eq.${accountId}'` in the subscription above pushes filtering
> to the server. Without an index on `account_id`, this degrades to a full table scan on
> every change event. The migration creates `idx_subscriptions_account_id` — confirm it
> exists before enabling Realtime at scale:
>
> ```sql
> SELECT indexname FROM pg_indexes
> WHERE tablename = 'subscriptions'
>   AND indexname = 'idx_subscriptions_account_id';
> ```

---

## 4. Service Role Key Security

### 4.1 What the service role key does

The `SUPABASE_SERVICE_ROLE_KEY` is a signed JWT with the `role: service_role` claim. When
Supabase's PostgREST receives a request bearing this token, it **skips every RLS policy on
every table for the entire request**. There are no exceptions.

This key is necessary for Horario's webhook handlers (Stripe, Culqi) which must write to
`subscriptions` on behalf of any user. It must **never** leave the server.

---

### 4.2 How the secure proxy enforces server-only usage

All writes to `subscriptions` flow through `app/api/secure-proxy+api.ts`, which runs in
Vercel's Node.js runtime (not Edge). The service role client is initialized once, at module
scope, with auth inheritance explicitly disabled:

```typescript
// app/api/secure-proxy+api.ts
import { createClient } from '@supabase/supabase-js';

// ✅ CORRECT: service role client with auth inheritance disabled
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,   // no token refresh — this is a server process
      persistSession: false,     // no session storage — stateless per request
    },
  }
);

// ❌ WRONG patterns — never do these:
// 1. const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
//    — missing auth options allows accidental session inheritance
//
// 2. Forwarding the incoming request's Authorization header to supabaseAdmin
//    — a malformed or attacker-controlled JWT could interfere with client behavior
//
// 3. Importing supabaseAdmin into any file under app/ that is not an API route
//    — Expo's bundler may include it in the client JS bundle
```

The anon-key client used in the mobile app never receives the service role key:

```typescript
// lib/supabase.ts  (bundled into the mobile app)
import { createClient } from '@supabase/supabase-js';

// Only the anon key goes here — safe to ship in the client bundle
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
);
```

Note the `EXPO_PUBLIC_` prefix: Expo only inlines environment variables with this prefix into
the client bundle. Variables without it (like `SUPABASE_SERVICE_ROLE_KEY`) are unavailable
at runtime in the app — this is a build-time guardrail, not a runtime check.

---

### 4.3 Verify the service role key is not exposed in your app bundle

After building, confirm the key is absent from the JS bundle:

```bash
# Build a production bundle and grep for the key prefix
npx expo export --platform ios 2>/dev/null
grep -r "service_role" dist/ && echo "🔴 KEY FOUND IN BUNDLE" || echo "✅ Key not in bundle"
```

✅ **Verify:** Output is `✅ Key not in bundle`. Any other result is a critical security issue.

---

### 4.4 If the service role key is leaked — immediate rotation steps

If `SUPABASE_SERVICE_ROLE_KEY` appears in a git commit, client bundle, log output, or error
message, treat it as compromised and rotate within minutes:

1. Open **Project Settings → API**
   (`https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/settings/api`)
2. Under **Project API keys**, click **Reveal** next to `service_role`
3. Click **Rotate** (or **Regenerate**) and confirm
4. The old key is immediately invalidated — all in-flight requests using it will receive `401`
5. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel:
   - **Vercel Dashboard → Horario project → Settings → Environment Variables**
   - Update the value for all three environments: **Production**, **Preview**, **Development**
6. Redeploy: `vercel --prod` or trigger a redeploy from the Vercel dashboard
7. Confirm webhooks are functioning by triggering a test event from the Stripe and Culqi dashboards

✅ **Verify:** Run a test webhook delivery and confirm the proxy returns `200 OK` with the
new key in place.

> ⚠️ **GOTCHA: Rotating the service role key does NOT revoke existing JWTs issued to end users**
>
> The service role key and the JWT secret are separate. Rotating the API key only invalidates
> server-to-server calls. End-user sessions (signed with `JWT_SECRET`) are unaffected.
> If you believe user sessions are compromised, rotate the JWT secret under
> **Project Settings → Configuration → JWT Secret**.

---

## 5. Connection Limits & Free Tier

### 5.1 Current Supabase free tier limits (2025)

| Resource | Free Tier Limit | Pro Tier ($25/mo) |
|---|---|---|
| Database size | 500 MB | 8 GB (then $0.125/GB) |
| Monthly Active Users (Auth) | 50,000 MAU | 100,000 MAU |
| Storage | 1 GB | 100 GB |
| Bandwidth | 5 GB/month | 250 GB/month |
| Realtime connections | 200 concurrent | 500 concurrent |
| Edge Function invocations | 500,000/month | 2,000,000/month |
| Database connections (pooled via pgBouncer) | 60 | 120 |
| Point-in-time recovery | ❌ | ✅ (7 days) |
| Daily backups | ✅ (7 days retained) | ✅ (30 days retained) |

> ⚠️ **GOTCHA: Free projects pause after 1 week of inactivity**
>
> Supabase automatically pauses free-tier projects that receive no database activity for
> 7 days. The first request after a pause triggers a cold-start that takes **20–30 seconds**
> before the database becomes available. During this window, all API calls return `503`.
>
> **Workarounds (free tier):**
> - Set up a cron job (e.g., via GitHub Actions or cron-job.org) to ping your project's
>   REST API every 5 days:
>   ```bash
>   curl https://rfmdlzaqvmhbzbgjwhqn.supabase.co/rest/v1/ \
>     -H "apikey: $SUPABASE_ANON_KEY"
>   ```
> - Upgrade to Pro — pausing is disabled on paid plans.
>
> ([Source: Supabase Free Plan docs](https://supabase.com/docs/guides/platform/managing-your-usage))

---

### 5.2 When to upgrade from free to Pro

Upgrade to Pro ($25/month) when **any** of the following is true:

- [ ] You have paying Horario customers (production billing must not pause)
- [ ] Your database is approaching 400 MB (leave headroom for migrations)
- [ ] You regularly see > 150 concurrent mobile sessions (Realtime connection headroom)
- [ ] You need point-in-time recovery (required for PCI compliance conversations with Culqi)
- [ ] Your team needs audit logs for Stripe/Culqi webhook debugging beyond 7 days

---

### 5.3 Database connection pooling

Vercel's serverless functions create a new process per invocation. Without connection pooling,
each invocation opens a new PostgreSQL connection. At scale, this exhausts the free tier's
60-connection limit and causes `too many connections` errors.

Horario's `secure-proxy+api.ts` must connect via the **pooler URL** (PgBouncer), not the
direct connection string:

```bash
# ✅ CORRECT — use the pooler URL in Vercel env vars
# Found at: Project Settings → Database → Connection pooling → Connection string
DATABASE_URL=<pooler-url-from-supabase-dashboard-connection-pooling>

# ❌ WRONG — direct connection string (fine for local psql, bad for serverless)
DATABASE_URL=<direct-url-from-supabase-dashboard-database-settings>
```

✅ **Verify:** Run a load test with 10 concurrent requests to `app/api/secure-proxy+api.ts`
and confirm no `too many connections` errors in Vercel's function logs.

---

## 6. Testing & Verification Queries

All queries below run in the [SQL Editor](https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/sql/new).

---

### 6.1 Inspect the most recently created subscriptions

```sql
SELECT
  account_id,
  tier,
  status,
  stripe_customer_id,
  culqi_customer_id,
  created_at,
  updated_at
FROM public.subscriptions
ORDER BY created_at DESC
LIMIT 10;
```

✅ **Verify:** All existing accounts appear with `tier = 'free'` and `status = 'active'`.
The `stripe_customer_id` and `culqi_customer_id` columns are `NULL` until a payment is made.

---

### 6.2 Count subscriptions by tier (sanity check after migrations)

```sql
SELECT
  tier,
  status,
  count(*) AS account_count
FROM public.subscriptions
GROUP BY tier, status
ORDER BY tier, status;
```

✅ **Verify:** Every account appears in exactly one tier. No account appears in multiple rows
(would indicate a missing `UNIQUE` constraint on `account_id`).

---

### 6.3 Simulate a tier upgrade (local/staging only)

> 🚨 **Do NOT run in production.** Use only against a local Supabase instance or a staging project.

```sql
-- Simulate Stripe upgrading an account to the 'starter' tier
UPDATE public.subscriptions
SET
  tier = 'starter',
  status = 'active',
  stripe_subscription_id = 'sub_test_XXXXXXXXXXXXXXXXXXXXXXXX',
  stripe_customer_id = 'cus_test_XXXXXXXXXXXXXXXXXXXXXXXX',
  updated_at = now()
WHERE account_id = 'demo-account-id-replace-me';
```

✅ **Verify:** The Realtime hook in your running simulator fires and updates the UI tier badge
without a manual refresh.

---

### 6.4 Reset to free tier (local/staging only)

> 🚨 **Do NOT run in production.**

```sql
UPDATE public.subscriptions
SET
  tier = 'free',
  status = 'active',
  stripe_subscription_id = NULL,
  stripe_customer_id = NULL,
  culqi_customer_id = NULL,
  updated_at = now()
WHERE account_id = 'demo-account-id-replace-me';
```

---

### 6.5 Verify indexes exist

```sql
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'subscriptions'
ORDER BY indexname;
```

✅ **Verify:** You see at minimum:

| indexname | indexdef |
|---|---|
| `idx_subscriptions_account_id` | `CREATE INDEX ... ON subscriptions(account_id)` |
| `idx_subscriptions_culqi_customer_id` | `CREATE INDEX ... ON subscriptions(culqi_customer_id)` |
| `idx_subscriptions_stripe_customer_id` | `CREATE INDEX ... ON subscriptions(stripe_customer_id)` |
| `subscriptions_pkey` | `CREATE UNIQUE INDEX ... ON subscriptions(id)` |

---

### 6.6 Confirm no duplicate subscriptions per account

```sql
SELECT
  account_id,
  count(*) AS row_count
FROM public.subscriptions
GROUP BY account_id
HAVING count(*) > 1;
```

✅ **Verify:** Zero rows returned. Any row here means the `UNIQUE` constraint on `account_id`
is missing or was dropped. Fix immediately:

```sql
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_account_id_key UNIQUE (account_id);
```

---

### 6.7 Confirm Realtime publication (repeat of 3.2 for convenience)

```sql
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
```

✅ **Verify:** `subscriptions` appears in the results.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERROR: 42710: policy "..." already exists` | Migration run twice on a database that had policies from an earlier non-idempotent version | Add `DROP POLICY IF EXISTS "..." ON <table>;` before each `CREATE POLICY` in the migration file, then re-run |
| `ERROR: 42P01: relation "subscriptions" does not exist` | Migration did not run or ran in wrong schema | Open SQL Editor, verify you pasted the full file, confirm `search_path` is `public`, re-run |
| `SELECT` returns 0 rows on `subscriptions` despite data existing | RLS is enabled but the querying role has no SELECT policy | Run query 2.2 to check `rowsecurity`; add an appropriate policy per section 2.4 |
| Realtime events never fire in the app | Table not added to `supabase_realtime` publication | Run `ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;` |
| Realtime subscription status is `CHANNEL_ERROR` | 200 concurrent connection limit hit on free plan | Unsubscribe on screen blur; upgrade to Pro for 500 connections |
| `401 Unauthorized` on all API calls after key rotation | Old service role key still set in Vercel env vars | Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel for all environments and redeploy |
| `too many connections` errors in Vercel function logs | Using direct connection URL instead of pooler URL | Switch `DATABASE_URL` to the PgBouncer pooler URL with `?pgbouncer=true` |
| App returns `503` on first request of the day | Free project paused due to inactivity | Set up keep-alive ping cron (section 5.2) or upgrade to Pro |
| Service role client behaves as if RLS is active (returns limited rows) | Client was initialized with anon key by mistake | Verify `process.env.SUPABASE_SERVICE_ROLE_KEY` is set in Vercel and not shadowed by `EXPO_PUBLIC_` variant |
| `stripe_customer_id` column not found in webhook handler | Migration has not been run on this environment | Confirm migration ran; check column exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'subscriptions';` |
| Tier change in DB does not update UI | `useSubscriptionRealtime` hook not mounted, or channel not removed on prior unmount causing duplicate channels | Ensure hook is mounted once per session; verify `supabase.removeChannel(channel)` runs on cleanup |
| `INSERT` seed step inserts 0 rows | No existing accounts in the `accounts` table | Expected on a fresh project — accounts will be seeded as they sign up |
| Duplicate key error on seed INSERT | `ON CONFLICT DO NOTHING` missing from seed statement in migration | Update seed statement to use `INSERT ... ON CONFLICT (account_id) DO NOTHING` |

---

## 8. Setup Checklist

Complete these steps in order. Check each box only after verifying success.

- [ ] **Migration file opened** — `supabase/migrations/20260405000001_subscriptions.sql` opened in VS Code, full contents copied
- [ ] **Migration executed** — Pasted into SQL Editor, clicked **Run**, received `Success` or `INSERT 0 N` output (no red `ERROR` banners)
- [ ] **Tables created** — `SELECT * FROM public.subscriptions LIMIT 1;` returns without error (even if 0 rows on fresh project)
- [ ] **RLS enabled on all tables** — Query 2.2 returns `true` for all billing tables; query 2.4 returns 0 rows
- [ ] **Policies verified** — Query 2.5 shows at least one `anon` SELECT policy and one `service_role` ALL policy on `subscriptions`
- [ ] **Indexes verified** — Query 6.5 shows all four expected indexes
- [ ] **No duplicate subscriptions** — Query 6.6 returns 0 rows
- [ ] **Realtime publication enabled** — `subscriptions` added via Dashboard or SQL; query 6.7 confirms 1 row
- [ ] **Realtime hook integrated** — `useSubscriptionRealtime` added to the appropriate screen; channel cleanup (`removeChannel`) confirmed
- [ ] **Service role key not in bundle** — `grep -r "service_role" dist/` returns no matches after production build
- [ ] **Pooler URL in use** — `DATABASE_URL` in Vercel points to `*.pooler.supabase.com:6543` with `?pgbouncer=true`
- [ ] **Keep-alive configured** — Cron job pings project REST API every 5 days (or Pro plan active)
- [ ] **Tier simulation tested** — Query 6.3 run on staging; Realtime hook updates UI without refresh
- [ ] **Key rotation runbook read** — Section 4.4 reviewed by at least one team member; rotation steps bookmarked
```