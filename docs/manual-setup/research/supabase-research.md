Now I have comprehensive data from all 15 searches. Let me compile the full research report.Now I have all the data I need. Let me compile the comprehensive report.

---

# 🔬 Supabase Migration & RLS Gotchas — Master Research Report (2024–2025)
**Target Stack: Horario · Expo SDK 53 · React Native 0.79 · Expo Router v5 · Clerk Auth · Supabase (PostgreSQL + RLS) · Vercel Node.js**

---

## GOTCHA 1 — The `anon` vs `service_role` RLS Bypass Cliff

### 🔴 PROBLEM
When you create a Supabase client with the `service_role` key, all RLS policies are bypassed. This is intended for server-side admin operations like background jobs, migrations, and admin dashboards. The gotcha: A Supabase client with the `Authorization` header set to the service role API key will **always** bypass RLS. By default the `Authorization` header is the `apikey` used in `createClient`. If you are getting an RLS error, then you have a user session getting into the client or you initialized with the anon key.

This bites Expo/React Native developers because they mix clients — using `service_role` for admin ops but accidentally letting a Clerk JWT flow in.

### ✅ FIX
```typescript
// ❌ WRONG — in app/api/secure-proxy+api.ts (Horario's proxy)
// Never let service_role client inherit user auth headers
const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ✅ CORRECT — explicitly disable auth inheritance
const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
// Never forward Authorization headers to this client
```

For user-scoped operations, use the anon key client and pass the Clerk JWT as the bearer. Always add `authenticated` to the approved roles instead of nothing or `public`. Although this does not improve the query performance for the signed-in user it does eliminate `anon` users without taxing the database to process the rest of the RLS.

### 📌 SOURCE
- <https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z>
- <https://supabase.com/docs/guides/database/secure-data>

---

## GOTCHA 2 — `CREATE POLICY IF NOT EXISTS` Is Not a Thing in PostgreSQL

### 🔴 PROBLEM
Policies are SQL logic that you attach to a Postgres table. You can attach as many policies as you want to each table. But — unlike `CREATE TABLE IF NOT EXISTS` or `CREATE OR REPLACE FUNCTION` — **PostgreSQL has no `CREATE POLICY IF NOT EXISTS` syntax**. Running a migration twice (common when pasting SQL into the dashboard editor) throws:

```
ERROR: 42710: policy "Users can insert their own form reviews" for table "form_reviews" already exists
```

Even trying to create a policy with a different name can give the same error — the dashboard may show no policies, but they still exist in the catalog.

### ✅ FIX
Always write migrations idempotently using `DROP POLICY IF EXISTS` before `CREATE POLICY`:

```sql
-- ✅ Idempotent pattern — safe to run multiple times
DROP POLICY IF EXISTS "Users can view own schedule" ON schedules;
CREATE POLICY "Users can view own schedule"
  ON schedules FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);
```

Precede each `CREATE` statement with a `DROP ... IF EXISTS`. Apply this pattern across triggers, policies, functions, types, and other objects.

### 📌 SOURCE
- <https://github.com/orgs/supabase/discussions/35818>
- <https://github.com/coleam00/Archon/issues/738>

---

## GOTCHA 3 — Realtime Requires Manual Publication Registration Per Table

### 🔴 PROBLEM
You call `.channel('table').on('postgres_changes', ...)` but receive **no events**. Subscriptions appear to succeed but fire nothing. The reason: Go to your project's Publications settings, and under `supabase_realtime`, toggle on the tables you want to listen to. Tables are **not** in the publication by default.

The SQL equivalent for CLI-based migrations:
```sql
alter publication supabase_realtime add table your_table;
```
If you want to listen to Postgres changes, you can create a table and then add the table to the `supabase_realtime` publication.

### ✅ FIX
Add this at the **end** of every migration that creates a table needing realtime:

```sql
-- In your migration file, after CREATE TABLE:
ALTER PUBLICATION supabase_realtime ADD TABLE schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;

-- Then subscribe with proper cleanup in React Native:
useEffect(() => {
  const channel = supabase
    .channel('schedules-changes')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'schedules' },
        (payload) => handleChange(payload))
    .subscribe();

  return () => { supabase.removeChannel(channel); }; // ← CRITICAL
}, []);
```

**Note:** Postgres Changes are simple to use, but have some limitations as your application scales. The Supabase docs recommend using Broadcast via triggers for high-scale production scenarios.

### 📌 SOURCE
- <https://supabase.com/docs/guides/realtime/postgres-changes>
- <https://supabase.com/docs/guides/realtime/subscribing-to-database-changes>

---

## GOTCHA 4 — The `service_role` Key Exposed in React Native Bundle = Full DB Access

### 🔴 PROBLEM
Unlike your anon key, your service role key is never safe to expose because it bypasses RLS. Only use your service role key on the backend. In a React Native / Expo app, **all `process.env` variables baked in at build time are visible in the JS bundle** — Metro bundler does not strip them. The most critical vulnerability is exposing the `service_role` key in client code, which grants unrestricted database access.

Affected pattern in Horario's Expo SDK 53 setup:
```typescript
// ❌ CRITICAL BUG — this goes into the app bundle
const supabase = createClient(url, process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);
```

### ✅ FIX
Never prefix `service_role` with `EXPO_PUBLIC_` or `VITE_`. The service role key should only exist in Edge Functions (as environment variables), server-side code, or CI/CD pipelines.

For Horario, route all admin operations through `app/api/secure-proxy+api.ts` (already Node.js, not Edge runtime):

```typescript
// app/api/secure-proxy+api.ts — server-side ONLY
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,           // no EXPO_PUBLIC_ prefix
  process.env.SUPABASE_SERVICE_ROLE_KEY! // stays server-side
);
```

If leaked: rotating a secret key is easy and painless — use the API Keys dashboard to create a new key, replace the compromised one, then delete it.

### 📌 SOURCE
- <https://supabase.com/docs/guides/database/secure-data>
- <https://supabase.com/docs/guides/api/api-keys>

---

## GOTCHA 5 — RLS Infinite Recursion (Error Code `42P17`)

### 🔴 PROBLEM
Your app returns HTTP 500 with:
```
{"code":"42P17","message":"infinite recursion detected in policy for relation \"profiles\""}
```
This usually means you are doing a select policy and in it doing a select on the same table. That can't work. You need to move the select and WHERE clause to a security definer function and call that in your policy.

Classic trigger: a `profiles` table with a SELECT policy that queries `profiles` to check a role column.

```sql
-- ❌ INFINITE RECURSION
CREATE POLICY "admins_read_all" ON profiles FOR SELECT
USING (
  auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin') -- queries itself!
);
```

### ✅ FIX
To avoid recursion caused by trying to select from the same table in a select policy for that table you need to use a security definer function to do the select call. This avoids RLS on the select call.

```sql
-- ✅ CORRECT: security definer function breaks the recursion
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER  -- runs as function owner, bypasses RLS
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE POLICY "admins_read_all" ON profiles FOR SELECT
TO authenticated
USING (is_admin()); -- no recursion
```

### 📌 SOURCE
- <https://github.com/orgs/supabase/discussions/33585>
- <https://github.com/orgs/supabase/discussions/1138>

---

## GOTCHA 6 — Migration History Desyncs: `duplicate key value violates unique constraint "schema_migrations_pkey"`

### 🔴 PROBLEM
Running `supabase db reset` throws `ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)`. This appears because the `schema_migrations` table gets out of sync or has broken data — the CLI tries to record a migration that's already been inserted.

This happens when:
- You paste SQL directly in the dashboard editor **and** use the CLI
- You run `supabase db pull` then `supabase db reset` without reconciling
- A partial migration failure leaves a half-recorded entry

### ✅ FIX
```bash
# Step 1: Check what's recorded vs what exists
npx supabase migrations list

# Step 2: Repair the migration history
npx supabase migration repair --status applied 20240101120000

# Step 3: If fully broken, reset the migration table
# In Supabase SQL editor:
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '0001'; -- the offending version

# Step 4: Re-run
npx supabase db push
```

**Best practice for Horario:** Never mix dashboard SQL editor runs with CLI migrations. Pick one workflow.

### 📌 SOURCE
- <https://github.com/supabase/cli/issues/2564>
- <https://github.com/supabase/cli/issues/4417>

---

## GOTCHA 7 — `upsert()` Error `42P10`: `onConflict` Column Must Have a Unique/Exclusion Constraint

### 🔴 PROBLEM
```typescript
await supabase.from('user_schedules').upsert(
  { user_id: uid, day: 'monday', slot: '09:00' },
  { onConflict: 'user_id,day' } // ← throws 42P10
);
```
Error: `there is no unique or exclusion constraint matching the ON CONFLICT specification`

The column passed to `onConflict` must be a UNIQUE key or primary key for `ON CONFLICT` to work — this is a PostgreSQL requirement. Merely indexing the column is not sufficient.

A second upsert gotcha: upsert multiple entries with interdependent unique values (e.g., swapping positions) produces `duplicate key value violates unique constraint` because Postgres enforces constraints row-by-row during the batch, not after.

### ✅ FIX
```sql
-- ✅ Add the required constraint explicitly
ALTER TABLE user_schedules
  ADD CONSTRAINT user_schedules_user_day_unique UNIQUE (user_id, day);

-- Now onConflict works:
```
```typescript
await supabase.from('user_schedules').upsert(
  { user_id: uid, day: 'monday', slot: '09:00' },
  { onConflict: 'user_id,day' } // ✅ works
);
```

For the batch-swap problem, use a `DEFERRABLE INITIALLY DEFERRED` constraint or perform updates sequentially.

### 📌 SOURCE
- <https://github.com/orgs/supabase/discussions/36532>
- <https://supabase.com/docs/reference/javascript/upsert>

---

## GOTCHA 8 — Realtime Channels Leak: `TooManyChannels` / React StrictMode Double-Subscribe

### 🔴 PROBLEM
Each time you call `supabase.channel('topic').subscribe()`, a new channel is created unless you properly clean it up. `useEffect` runs multiple times due to missing or incorrect dependencies, components unmount without cleaning up their channels, and React StrictMode causes effects to run twice.

In Expo / React Native with Expo Router v5, navigation causes components to mount/unmount frequently — every unmounted screen without cleanup leaks a channel.

### ✅ FIX
```typescript
// ✅ Always return cleanup in useEffect
useEffect(() => {
  const channelName = `bookings:${userId}`;

  // Guard against StrictMode double-run
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings',
        filter: `user_id=eq.${userId}` }, handleInsert)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('✅ Realtime connected');
    });

  return () => {
    supabase.removeChannel(channel); // ← prevents leak
  };
}, [userId]);
```

Monitor active channels:
```typescript
// Debug: count active channels
console.log(supabase.getChannels().length); // if climbing → you have a leak
```

### 📌 SOURCE
- <https://supabase.com/docs/guides/troubleshooting/realtime-too-many-channels-error>
- <https://github.com/supabase/realtime-js/issues/169>

---

## GOTCHA 9 — Free Tier: 200 Realtime Concurrent Peak Connections

### 🔴 PROBLEM
The free plan has a limit of 200 peak realtime connections. Developers can hit the connection cap quite quickly during testing — and once hit, realtime database listening stops working altogether.

When you exceed a limit, errors appear in the backend logs and client-side messages in the WebSocket connection. Some limits cause a Channel join to be refused with WebSocket messages: "Too many channels currently joined for a single connection" or "Too many total concurrent connections for a project."

The Pro plan raises this to 500; even then: "the realtime concurrent connections is capped at 500 on the $25/month plan."

### ✅ FIX
- Use **Broadcast via DB triggers** (`realtime.broadcast_changes()`) instead of raw `postgres_changes` for high-fan-out scenarios — 1 server connection instead of N client connections.
- Implement connection multiplexing: one channel per user session, multiple event types filtered server-side.
- Monitor in Dashboard → Realtime Inspector.

```sql
-- ✅ Server-side broadcast trigger (1 connection, not N)
CREATE OR REPLACE TRIGGER broadcast_booking_changes
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION realtime.broadcast_changes(
    'topic:bookings', TG_OP, TG_OP, 'bookings', NEW, OLD
  );
```

### 📌 SOURCE
- <https://supabase.com/docs/guides/realtime/limits>
- <https://github.com/orgs/supabase/discussions/31123>

---

## GOTCHA 10 — Free Tier: 500 MB DB → Read-Only Mode + 7-Day Pause

### 🔴 PROBLEM
Two distinct free-tier killers:

**A) DB Size:** Free plan projects enter read-only mode when you exceed the 500 MB limit. Once in read-only mode, you can upgrade to Pro (8 GB limit), disable Spend Cap for auto-scaling, or disable read-only mode and reduce your database size.

**B) Inactivity Pause:** On the free-tier plan, projects that are inactive for more than 7 days are paused. Supabase sends warning emails before pausing. This will silently break all Horario API routes on Vercel.

A hidden size bomb: `net._http_response` (430 MB) and `supabase_functions.hooks` (111 MB) can silently consume quota — developers don't realize these internal tables accumulate data.

### ✅ FIX
```sql
-- Check actual size breakdown
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;

-- Clean up internal HTTP response table if needed
TRUNCATE net._http_response;
```

For pause prevention, add a keep-alive ping to your Vercel cron or Expo background task:
```typescript
// app/api/keepalive+api.ts
export async function GET() {
  await supabase.from('_health').select('1').limit(1);
  return Response.json({ ok: true });
}
```

### 📌 SOURCE
- <https://supabase.com/docs/guides/platform/database-size>
- <https://github.com/travisvn/supabase-pause-prevention>

---

## GOTCHA 11 — `moddatetime()` / `updated_at` Trigger: Extension Schema Path Error

### 🔴 PROBLEM
After running `supabase db reset --linked`, migrations fail with `ERROR: function moddatetime() does not exist`. The extension `moddatetime` must be installed in the `extensions` schema, but the trigger references it without the schema qualifier.

```sql
-- ❌ Fails: function moddatetime() does not exist
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);
```

Also: rerunning `CREATE OR REPLACE FUNCTION update_updated_at_column()` is safe, but **`CREATE TRIGGER` will error** if the trigger already exists — there's no `CREATE OR REPLACE TRIGGER`.

### ✅ FIX
```sql
-- ✅ Option A: Use moddatetime with full schema path
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

DROP TRIGGER IF EXISTS handle_updated_at ON profiles;
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- ✅ Option B: Write your own (no extension dependency)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON schedules;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

Option B is **preferred for Horario** — it avoids the `moddatetime` extension path issue entirely.

### 📌 SOURCE
- <https://github.com/supabase/cli/issues/151>
- <https://github.com/supabase/cli/issues/4198>

---

## GOTCHA 12 — RLS Policy Performance: `auth.uid()` Called Per Row

### 🔴 PROBLEM
An RLS policy using `auth.uid() = user_id` without wrapping in a subquery causes the function to be called for every single row evaluated. For a table with 10,000 rows, this executes 10,000 subqueries per `SELECT`.

```sql
-- ❌ SLOW: auth.uid() re-evaluated per row
CREATE POLICY "own rows" ON schedules FOR SELECT
USING (auth.uid() = user_id);
```

The recommended pattern is to wrap `auth.uid()` in a `SELECT` subquery so it is evaluated once and cached: `(select auth.uid()) = user_id`.

### ✅ FIX
```sql
-- ✅ FAST: auth.uid() evaluated once, result cached
CREATE POLICY "own rows" ON schedules FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);  -- parenthesized SELECT = memoized

-- ✅ ALSO: Always specify TO authenticated to short-circuit anon users
-- This prevents the policy from even running for unauthenticated requests
```

Also ensure indexes exist on the RLS predicate columns:
```sql
CREATE INDEX idx_schedules_user_id ON schedules(user_id);
```

### 📌 SOURCE
- <https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv>
- <https://supabase.com/docs/guides/getting-started/ai-prompts/database-rls-policies>

---

## GOTCHA 13 — The `anon` Key Is Safe to Expose — **Only If RLS Is Enabled**

### 🔴 PROBLEM
Developers either over-secure (hiding the anon key unnecessarily) or under-secure (exposing the anon key on tables **without** RLS). Your anon key is safe to expose with RLS enabled, because row access permission is checked against your access policies and the user's JSON Web Token (JWT). But any table without RLS enabled in the `public` schema will be accessible to the public using the anon role.

This key is intentionally public and safe to use in browsers/mobile apps — only if RLS is properly configured. If RLS is disabled on a table, anyone with the anon key can perform full CRUD operations on all data.

In Horario, using Clerk JWT (not Supabase Auth), you need an extra step: the Clerk JWT must be forwarded as the Supabase auth token.

### ✅ FIX
```typescript
// ✅ Safe pattern: anon key in app, Clerk JWT forwarded
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, // ✅ safe to expose
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

**RLS audit checklist** — run in SQL editor:
```sql
-- Find tables in public schema with RLS disabled
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN (
    SELECT relname FROM pg_class WHERE relrowsecurity = true
  );
```

### 📌 SOURCE
- <https://supabase.com/docs/guides/database/secure-data>
- <https://supabase.com/docs/guides/api/securing-your-api>

---

## GOTCHA 14 — Supavisor Connection Pooler: Use `6543`, Not `5432`, for Serverless

### 🔴 PROBLEM
After January 15, 2024, PgBouncer was disabled and projects need to use Supavisor. The number of connections allowed is based on the compute add-on selected for your database.

Vercel serverless functions (Horario's `app/api/secure-proxy+api.ts`) create a **new DB connection per invocation**. Using the direct connection string (port `5432`) on the free tier's shared CPU exhausts the connection pool almost immediately under load.

The Supavisor connection string looks like `postgres://postgres.YOURREF:YOURPASS@aws-0-us-west-1.pooler.supabase.com:6543/postgres` — find it in Project Settings → Database → Connection pooling. The PgBouncer string used port 6543 on the old `db.xxx.supabase.co` host — migration requires updating the hostname, not just the port.

### ✅ FIX
```typescript
// In app/api/secure-proxy+api.ts — use pooler URL, not direct URL
// ❌ Direct connection (exhausts pool on serverless)
// postgres://postgres:pass@db.xxx.supabase.co:5432/postgres

// ✅ Supavisor pooler (transaction mode, built for serverless)
// postgres://postgres.xxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

// The supabase-js client uses the REST API (port 443) so it's already pooled.
// Only relevant if you use a raw Postgres client (e.g., pg, postgres.js, Drizzle)
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_POOLER_URL!, {
  max: 1, // ← important for serverless: 1 connection per function instance
});
```

### 📌 SOURCE
- <https://supabase.com/blog/supavisor-postgres-connection-pooler>
- <https://www.restack.io/docs/supabase-knowledge-supabase-connection-pooling>

---

## GOTCHA 15 — SQL Editor 60-Second Timeout Kills Long Migrations

### 🔴 PROBLEM
The Dashboard's SQL Editor has a 1-minute timeout limit. Certain queries — like indexing a large table or changing a column's data type — are inherently time-consuming and will be killed mid-execution.

The default maximum statement execution time is 8 seconds for API users, with a global limit of 2 minutes as a safeguard. This means even the `supabase-js` client can time out on expensive migrations you run programmatically.

For Horario, creating indexes on large `schedules` or `bookings` tables, or running `ALTER TABLE ... ADD COLUMN` with a default value on millions of rows, will hit this wall.

### ✅ FIX
```sql
-- Option A: Increase statement timeout for your session (SQL Editor)
SET statement_timeout = '10min';

-- Then run your long migration:
CREATE INDEX CONCURRENTLY idx_bookings_created_at ON bookings(created_at);

-- Option B: Use CONCURRENTLY to avoid table lock (still slow but won't block)
-- Note: CONCURRENTLY cannot run inside a transaction block

-- Option C: Connect via psql / TablePlus / pgAdmin directly
-- psql "postgresql://postgres:YOURPASS@db.YOURREF.supabase.co:5432/postgres"
```

For longer transactions, use Supavisor or direct connections instead of the dashboard editor. Dashboard and client queries have a max-configurable timeout of 60 seconds.

Also note the **default row return limit**: the Supabase API caps results at 1,000 rows by default. Override via project Settings → API → "Max rows."

### 📌 SOURCE
- <https://supabase.com/docs/guides/troubleshooting/avoiding-timeouts-in-long-running-queries-6nmbdN>
- <https://supabase.com/docs/guides/database/postgres/timeouts>

---

## GOTCHA BONUS — Views Silently Bypass RLS (Security Definer by Default)

### 🔴 PROBLEM
Views bypass RLS by default because they are usually created with the `postgres` user. This is a feature of Postgres, which automatically creates views with `SECURITY DEFINER`. If you create a `VIEW` through the SQL Editor, the owner is `supabase_admin` — a superuser — which bypasses RLS entirely.

```typescript
// You think this is RLS-protected — it is NOT if the view bypasses it:
const { data } = await supabase.from('user_schedule_view').select('*');
// Returns ALL rows for all users!
```

### ✅ FIX
In Postgres 15 and above (all current Supabase projects), you can make a view obey the RLS policies of the underlying tables when invoked by `anon` and `authenticated` roles by setting `security_invoker = true`.

```sql
-- ✅ Postgres 15+: Make view respect underlying table RLS
CREATE OR REPLACE VIEW user_schedule_view
WITH (security_invoker = true) AS
  SELECT s.*, u.display_name
  FROM schedules s
  JOIN profiles u ON u.id = s.user_id;

-- For existing views:
ALTER VIEW user_schedule_view SET (security_invoker = true);
```

### 📌 SOURCE
- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://dev.to/datadeer/postgres-views-the-hidden-security-gotcha-in-supabase-ckd>

---

## 📊 Quick Reference Matrix

| # | Gotcha | Error Code / Symptom | Severity |
|---|--------|---------------------|----------|
| 1 | `service_role` + user session = RLS errors | RLS 403 on admin client | 🔴 Critical |
| 2 | `CREATE POLICY IF NOT EXISTS` doesn't exist | `42710` policy already exists | 🟠 High |
| 3 | Table not in `supabase_realtime` publication | Silent: no events received | 🟠 High |
| 4 | `service_role` key in Expo bundle | Full DB exposed in binary | 🔴 Critical |
| 5 | RLS self-referencing policy | `42P17`