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
9. [References](#9-references)

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

> ⚠️ **GOTCHA: The SQL Editor has a hard 60-second timeout**
>
> The Dashboard SQL Editor enforces a 1-minute execution limit. Migrations that create indexes
> on large tables, change column types, or backfill data on millions of rows will be killed
> mid-execution with no partial rollback guarantee, leaving your schema in an inconsistent state.
>
> **Fix:** For long-running statements, either:
> - Prepend `SET statement_timeout = '10min';` to your SQL session before running
> - Use `CREATE INDEX CONCURRENTLY` (note: cannot run inside a transaction block)
> - Connect via `psql`, TablePlus, or pgAdmin directly to bypass the dashboard timeout
>
> ```sql
> -- Option A: Extend timeout for the current session in SQL Editor
> SET statement_timeout = '10min';
> CREATE INDEX CONCURRENTLY idx_bookings_created_at ON bookings(created_at);
> ```
>
> Note also that the Supabase API (used by `supabase-js`) has a default max statement timeout
> of 8 seconds for client queries, with a hard ceiling of 2 minutes.
> (source: https://supabase.com/docs/guides/troubleshooting/avoiding-timeouts-in-long-running-queries-6nmbdN)

---

### 1.3 What the migration creates

| Object | Type | Purpose |
|---|---|---|
| `subscriptions` | Table | Billing state per account |
| `idx_subscriptions_account_id` | Index | Fast lookup by account |
| `idx_subscriptions_stripe_customer_id` | Index | Stripe webhook routing |
| `idx_subscriptions_culqi_customer_id` | Index | Culqi/Yape webhook routing |
| RLS policies | Policies | `authenticated` read own row; `service_role` write |
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
> Even if the Dashboard's policy list appears empty, the policies may still exist in the
> catalog — the UI can lag behind the actual state.
>
> **Fix already applied:** The migration uses the drop-before-create pattern on every policy:
>
> ```sql
> DROP POLICY IF EXISTS "authenticated read own subscriptions" ON subscriptions;
> CREATE POLICY "authenticated read own subscriptions"
>   ON subscriptions FOR SELECT
>   TO authenticated
>   USING ((SELECT auth.uid()) = user_id);
> ```
>
> Apply this same pattern across triggers, functions, types, and any other objects you add.
> You do not need to change anything — this is documented so you understand why the pattern
> exists if you extend the migration file.
> (source: https://github.com/orgs/supabase/discussions/35818)

> ⚠️ **GOTCHA: Running the migration twice is safe — here's exactly what happens**
>
> Every destructive statement in the migration is guarded:
>
> | Statement | Guard |
> |---|---|
> | `CREATE TABLE subscriptions` | `CREATE TABLE IF NOT EXISTS` |
> | `CREATE INDEX ...` | `CREATE INDEX IF NOT EXISTS` |
> | `CREATE POLICY ...` | Preceded by `DROP POLICY IF EXISTS` |
> | `CREATE TRIGGER ...` | Preceded by `DROP TRIGGER IF EXISTS` |
> | Seed `INSERT` | `INSERT ... ON CONFLICT (account_id) DO NOTHING` |
>
> Re-running produces the same success output with zero side effects.
> Existing subscription rows are untouched because of `ON CONFLICT DO NOTHING`.

> ⚠️ **GOTCHA: `moddatetime()` trigger fails with "function does not exist" after `db reset`**
>
> If your migration uses the `moddatetime` extension for `updated_at` automation, it must be
> installed with a schema qualifier. Without it, `supabase db reset --linked` fails with:
>
> ```
> ERROR: function moddatetime() does not exist
> ```
>
> Additionally, there is no `CREATE OR REPLACE TRIGGER` in PostgreSQL — re-running a migration
> with a bare `CREATE TRIGGER` throws an error if the trigger already exists.
>
> **Preferred fix for Horario:** Avoid the `moddatetime` extension entirely and use a
> self-contained function instead:
>
> ```sql
> CREATE OR REPLACE FUNCTION public.update_updated_at_column()
> RETURNS TRIGGER LANGUAGE plpgsql AS $$
> BEGIN
>   NEW.updated_at = NOW();
>   RETURN NEW;
> END;
> $$;
>
> DROP TRIGGER IF EXISTS set_updated_at ON subscriptions;
> CREATE TRIGGER set_updated_at
>   BEFORE UPDATE ON subscriptions
>   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
> ```
>
> This pattern has zero extension dependencies and is safe to run multiple times.
> (source: https://github.com/supabase/cli/issues/151)

> ⚠️ **GOTCHA: Never mix Dashboard SQL Editor runs with CLI migrations**
>
> Running SQL directly in the Dashboard editor does not record the change in
> `supabase_migrations.schema_migrations`. If you later run `supabase db reset` or
> `supabase db push` via the CLI, it will attempt to reapply migrations that were already
> partially applied, causing `duplicate key value violates unique constraint "schema_migrations_pkey"`.
>
> **Fix:** Pick one workflow and stick to it for each environment:
> - **Dashboard SQL Editor** for one-off exploration and hotfixes
> - **CLI + migration files** for all version-controlled schema changes
>
> If the migration history becomes desynced, repair it:
>
> ```bash
> # Check what's recorded vs what exists on disk
> npx supabase migrations list
>
> # Mark a specific migration as already applied
> npx supabase migration repair --status applied 20260405000001
>
> # Then push remaining migrations
> npx supabase db push
> ```
>
> (source: https://github.com/supabase/cli/issues/2564)

---

## 2. RLS Policy Verification

### 2.1 Why RLS matters for billing data

Row-Level Security is the last line of defense between your billing records and an unauthenticated
HTTP request. Without RLS enabled, **any request that reaches the PostgREST API — including those
made with the public `anon` key — can read or modify every row** in the table. Stripe customer IDs,
subscription tiers, and payment status are all sensitive. RLS must be ON.

The `anon` key is intentionally public and safe to include in the mobile app bundle — **but only
when RLS is correctly configured on every table**. Any table in the `public` schema with RLS
disabled is fully readable and writable by anyone who knows your project URL.
(source: https://supabase.com/docs/guides/database/secure-data)

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

If any row shows `false`, run the fix immediately (see section 2.4).

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
> immediately after enabling RLS on a new table. Specifying `TO authenticated` (rather than
> omitting the role clause) also prevents the policy from running at all for unauthenticated
> requests, reducing unnecessary database load:
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
>   USING ((SELECT auth.uid()) = user_id);
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

✅ **Verify:** You should see at least two policies — one for `authenticated` SELECT (scoped to
the user's own row) and one for `service_role` ALL.

---

### 2.6 RLS performance: always use the memoized `auth.uid()` pattern

🔄 **UPDATED:** A bare `auth.uid() = user_id` in a `USING` clause causes the function to be
re-evaluated for every row scanned. On a `schedules` or `bookings` table with 10,000 rows,
this means 10,000 subquery executions per `SELECT`. Wrap it in a `SELECT` subquery to memoize
the result:

```sql
-- ❌ SLOW: auth.uid() re-evaluated per row
CREATE POLICY "own rows" ON schedules FOR SELECT
USING (auth.uid() = user_id);

-- ✅ FAST: auth.uid() evaluated once, result cached for the query
CREATE POLICY "own rows" ON schedules FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);
```

Also ensure an index exists on every column referenced in a `USING` clause:

```sql
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
```

(source: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)

---

### 2.7 Avoid RLS infinite recursion (error code `42P17`)

If a SELECT policy on a table queries the same table to evaluate itself, PostgreSQL throws:

```
{"code":"42P17","message":"infinite recursion detected in policy for relation \"profiles\""}
```

Classic trigger: a `profiles` table whose SELECT policy checks a `role` column by querying `profiles`.

```sql
-- ❌ INFINITE RECURSION: policy queries the table it's protecting
CREATE POLICY "admins_read_all" ON profiles FOR SELECT
USING (
  auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin')
);
```

**Fix:** Break the recursion with a `SECURITY DEFINER` function, which executes as its owner
and bypasses RLS on the inner query:

```sql
-- ✅ CORRECT: security definer function breaks the recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "admins_read_all" ON profiles;
CREATE POLICY "admins_read_all" ON profiles FOR SELECT
TO authenticated
USING (public.is_admin());
```

(source: https://github.com/orgs/supabase/discussions/33585)

---

### 2.8 Views silently bypass RLS by default

> ⚠️ **GOTCHA: SQL Editor views are owned by a superuser and ignore RLS**
>
> Views created through the Dashboard SQL Editor are owned by `supabase_admin`, a superuser.
> PostgreSQL automatically creates views with `SECURITY DEFINER` semantics when owned by a
> superuser, meaning they bypass RLS on all underlying tables entirely — every row is returned
> to every caller.
>
> ```typescript
> // You think this is RLS-protected — it is NOT if the view owner is a superuser:
> const { data } = await supabase.from('user_schedule_view').select('*');
> // Returns ALL rows for ALL users!
> ```
>
> **Fix:** All current Supabase projects run PostgreSQL 15+. Set `security_invoker = true` to
> make the view obey the RLS policies of the underlying tables:
>
> ```sql
> -- For new views:
> CREATE OR REPLACE VIEW user_schedule_view
> WITH (security_invoker = true) AS
>   SELECT s.*, u.display_name
>   FROM schedules s
>   JOIN profiles u ON u.id = s.user_id;
>
> -- For existing views:
> ALTER VIEW user_schedule_view SET (security_invoker = true);
> ```
>
> (source: https://supabase.com/docs/guides/database/postgres/row-level-security)

---

### 2.9 `upsert()` requires a unique constraint on the conflict column(s)

> ⚠️ **GOTCHA: `onConflict` column must have a UNIQUE or PRIMARY KEY constraint**
>
> Passing a column to `onConflict` that is merely indexed (not uniquely constrained) throws:
>
> ```
> ERROR 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
> ```
>
> ```typescript
> // ❌ Throws 42P10 if (user_id, day) has no UNIQUE constraint — even with an index
> await supabase.from('user_schedules').upsert(
>   { user_id: uid, day: 'monday', slot: '09:00' },
>   { onConflict: 'user_id,day' }
> );
> ```
>
> **Fix:** Add the required constraint explicitly in a migration:
>
> ```sql
> ALTER TABLE user_schedules
>   ADD CONSTRAINT user_schedules_user_day_unique UNIQUE (user_id, day);
> ```
>
> For batch upserts that swap unique values (e.g., reordering positions), use a
> `DEFERRABLE INITIALLY DEFERRED` constraint or perform updates sequentially to avoid
> row-by-row constraint violations during the batch.
> (source: https://github.com/orgs/supabase/discussions/36532)

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

If you prefer SQL or are scripting this step, add the following at the **end** of any migration
that creates a table requiring realtime events:

```sql
-- Add tables to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
```

✅ **Verify:**

```sql
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
```

Expected: one row per enrolled table. Zero rows means the publication change did not apply.

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
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Realtime] Channel error — may have hit connection limit');
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
> succeeds with no error thrown, but fires **zero events**. This is the most common reason
> Realtime "doesn't work."
>
> **Fix:** Run the verification query in [3.2](#32-enable-realtime-via-sql-alternative--matches-cli-migrations).
> If 0 rows are returned, run:
> ```sql
> ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
> ```
>
> (source: https://supabase.com/docs/guides/realtime/postgres-changes)

> ⚠️ **GOTCHA: Free plan caps Realtime at 200 concurrent connections**
>
> The Supabase free tier allows a maximum of **200 concurrent Realtime connections** across
> your entire project. On Horario, each active mobile session that calls `useSubscriptionRealtime`
> consumes one connection. Once exceeded, new connections are refused with WebSocket messages:
> `"Too many channels currently joined"` or `"Too many total concurrent connections"` — the
> subscribe callback receives `'CHANNEL_ERROR'` instead of `'SUBSCRIBED'`.
>
> **Mitigation on free plan:**
> - Only subscribe when the user is on a paywalled screen, not globally in `_layout.tsx`
> - Unsubscribe aggressively on blur events using `useFocusEffect`
> - Poll as fallback: if `status !== 'SUBSCRIBED'` after 5 seconds, fall back to a REST fetch
> - Debug active channel count: `console.log(supabase.getChannels().length)` — if climbing, you have a leak
>
> **Long-term fix:** Upgrade to Pro ($25/mo) for 500 concurrent connections, or use
> server-side Broadcast via triggers which multiplexes many users over far fewer server connections.
>
> (source: https://supabase.com/docs/guides/realtime/limits)

> ⚠️ **GOTCHA: React StrictMode and Expo Router v5 cause double-subscribe channel leaks**
>
> React StrictMode runs effects twice in development. Expo Router v5 also mounts and unmounts
> screens during navigation. Every `supabase.channel().subscribe()` call without a matching
> `removeChannel()` in the cleanup function creates a persistent, leaked channel.
>
> The hook in section 3.3 already handles this correctly via the `return () => supabase.removeChannel(channel)`
> teardown. Verify your implementation matches this pattern exactly — missing the `return`
> statement is the most common mistake.
>
> ```typescript
> // ✅ Correct cleanup prevents StrictMode double-subscribe leak
> return () => {
>   supabase.removeChannel(channel);
> };
> ```
>
> (source: https://supabase.com/docs/guides/troubleshooting/realtime-too-many-channels-error)

> ⚠️ **GOTCHA: `filter` param on `postgres_changes` requires an index on the filter column**
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

> ⚠️ **GOTCHA: `postgres_changes` does not scale to high fan-out — use Broadcast triggers instead**
>
> For tables receiving frequent writes with many concurrent subscribers (e.g., `bookings`
> in a large Horario deployment), raw `postgres_changes` creates one server-side listener
> per client connection. Supabase recommends using Broadcast via database triggers for
> high-scale scenarios — this maintains a single server connection regardless of subscriber count:
>
> ```sql
> -- ✅ Server-side broadcast trigger (1 server connection, not N)
> CREATE OR REPLACE TRIGGER broadcast_booking_changes
>   AFTER INSERT OR UPDATE OR DELETE ON bookings
>   FOR EACH ROW EXECUTE FUNCTION realtime.broadcast_changes(
>     'topic:bookings', TG_OP, TG_OP, 'bookings', NEW, OLD
>   );
> ```
>
> (source: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)

---

## 4. Service Role Key Security

### 4.1 What the service role key does

The `SUPABASE_SERVICE_ROLE_KEY` is a signed JWT with the `role: service_role` claim. When
Supabase's PostgREST receives a request bearing this token, it **skips every RLS policy on
every table for the entire request**. There are no exceptions.

This key is necessary for Horario's webhook handlers (Stripe, Culqi) which must write to
`subscriptions` on behalf of any user. It must **never** leave the server.
(source: https://supabase.com/docs/guides/database/secure-data)

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
  process.env.SUPABASE_URL!,             // no EXPO_PUBLIC_ prefix — server-only
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // never expose this key client-side
  {
    auth: {
      autoRefreshToken: false,   // no token refresh — this is a server process
      persistSession: false,     // no session storage — stateless per request
    },
  }
);

// ❌ WRONG patterns — never do these:
//
// 1. const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
//    — missing auth options allows accidental session inheritance from a Clerk JWT
//    — a user's Authorization header flowing into the service_role client can cause
//      confusing RLS errors or unexpected behavior
//
// 2. Forwarding the incoming request's Authorization header to supabaseAdmin
//    — a malformed or attacker-controlled JWT could interfere with client behavior
//
// 3. Importing supabaseAdmin into any file under app/ that is not an API route
//    — Expo's Metro bundler may include it in the client JS bundle
//
// 4. Prefixing the key with EXPO_PUBLIC_
//    — EXPO_PUBLIC_ variables are baked into the JS bundle at build time and are
//      visible to anyone who unpacks the app binary
```

The anon-key client used in the mobile app never receives the service role key. For Clerk JWT
integration, the client forwards the Clerk token as the Supabase auth bearer:

```typescript
// lib/supabase.ts  (bundled into the mobile app)
import { createClient } from '@supabase/supabase-js';

// ✅ Only the anon key goes here — safe to ship in the client bundle
// ✅ Clerk JWT is forwarded so Supabase RLS receives the user's identity
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, // safe to expose WITH RLS enabled
  {
    global: {
      fetch: async (url, options = {}) => {
        const clerkToken = await getToken({ template: 'supabase' });
        const headers = new Headers(options?.headers);
        if (clerkToken) headers.set('Authorization', `Bearer ${clerkToken}`);
        return fetch(url, { ...options, headers });
      },
    },
  }
);
```

Note the `EXPO_PUBLIC_` prefix: Expo only inlines environment variables with this prefix into
the client bundle. Variables without it (like `SUPABASE_SERVICE_ROLE_KEY`) are unavailable
at runtime in the app — this is a build-time guardrail, not a runtime check.
(source: https://supabase.com/docs/guides/api/api-keys)

---

### 4.3 Verify the service role key is not exposed in your app bundle

After building, confirm the key is absent from the JS bundle:

```bash
# Build a production bundle and grep for the key prefix
npx expo export --platform ios 2>/dev/null
grep -r "service_role" dist/ && echo "🔴 KEY FOUND IN BUNDLE" || echo "✅ Key not in bundle"
```

✅ **Verify:** Output is `✅ Key not in bundle`. Any other result is a critical security issue
requiring immediate key rotation (see section 4.4) and a full audit of which environment
variable names have the `EXPO_PUBLIC_` prefix.

---

### 4.4 If the service role key is leaked — immediate rotation steps

If `SUPABASE_SERVICE_ROLE_KEY` appears in a git commit, client bundle, log output, or error
message, treat it as compromised and rotate within minutes:

1. Open **Project Settings → API**
   (`https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/settings/api`)
2. Under **Project API keys**, click **Reveal** next to `service_role`
3. Click **Generate a new key** (available in the API Keys dashboard), then delete the old