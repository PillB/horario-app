# Horario — Supabase Migrations

Supabase project: `rfmdlzaqvmhbzbgjwhqn`
Dashboard SQL editor: https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/sql/new

---

## Execution order

Run these files **in the order listed**. Each file is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) — safe to re-run.

| # | File | Tables created | Required |
|---|------|----------------|---------|
| 1 | `20240101000000_forecast_tables.sql` | `shifts`, `external_signals`, `demand_targets` | Yes |
| 2 | `20240613120000_onboarding_progress.sql` | `onboarding_progress` | Yes |
| 3 | `20260327000001_core_tables.sql` | `workers`, `worker_availability`, `shift_templates`, `roster` | Yes |
| 4 | `20260328000001_usage_limits.sql` | `usage_limits` | Yes |
| 5 | `20260401000001_pos_sales.sql` | `pos_sales` | Yes |

---

## How to apply (Supabase Dashboard)

1. Open the [SQL Editor](https://supabase.com/dashboard/project/rfmdlzaqvmhbzbgjwhqn/sql/new).
2. Paste and run each file in order (copy from the file, paste into the editor, click **Run**).
3. Confirm each file completes with no errors before running the next.
4. After all five files have run, restart the Expo dev server — all DB operations will work.

## How to apply (Supabase CLI)

```bash
# Link once (uses project ref from supabase/config.toml or prompt)
supabase link --project-ref rfmdlzaqvmhbzbgjwhqn

# Push all migrations
supabase db push
```

---

## Table reference

### `shifts` (migration 1)
Historical shift records used as training data for demand forecasting.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` PK | auto-increment |
| `date` | `date` | shift date |
| `role` | `text` | e.g. `Barista` |
| `worker_id` | `text` | worker identifier |
| `hours` | `numeric(5,2)` | ≥ 0 |

RLS: anon read · service role full access

---

### `external_signals` (migration 1)
Demand boost/discount signals (events, promotions, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` PK | auto-increment |
| `date` | `date` | signal date |
| `role` | `text` | target role |
| `signal_type` | `text` | e.g. `event`, `promo` |
| `weight` | `numeric(10,4)` | demand multiplier |

RLS: anon read · service role full access

---

### `demand_targets` (migration 1)
AI/manual forecast output: required headcount per date × role.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` PK | auto-increment |
| `date` | `date` | |
| `role` | `text` | |
| `required` | `numeric(10,2)` | staffing target |
| `notes` | `text` | optional |
| `confidence` | `numeric(5,4)` | 0–1 |
| `lower_bound` | `numeric(10,2)` | optional |
| `upper_bound` | `numeric(10,2)` | optional |
| `source` | `text` | `model` or `manual` |

Unique constraint: `(date, role)` — proxy upserts with `onConflict: 'date,role'`.
RLS: anon read · service role full access

---

### `onboarding_progress` (migration 2)
Account-level onboarding step completion flags.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` PK | auto-increment |
| `account_id` | `text` | Clerk `userId` |
| `user_id` | `text` | Clerk `userId` (same value) |
| `workers_completed` | `boolean` | default `false` |
| `templates_completed` | `boolean` | default `false` |
| `forecast_completed` | `boolean` | default `false` |

Unique constraint: `(account_id, user_id)` — proxy upserts with `onConflict: 'account_id,user_id'`.
RLS: anon read + anon insert/update · service role full access

---

### `workers` (migration 3)
Worker profiles per tenant account.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `account_id` | `text` | Clerk `userId` |
| `name` | `text` | 1–100 chars |
| `role` | `text` | 1–100 chars |
| `skills` | `text[]` | default `{}` |
| `created_at` | `timestamptz` | auto |

Index: `(account_id)`
RLS: anon read · service role full access

---

### `worker_availability` (migration 3)
Recurring weekly availability windows per worker.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `account_id` | `text` | Clerk `userId` |
| `worker_id` | `uuid` FK | → `workers.id` cascade delete |
| `day_of_week` | `text` | `Mon`–`Sun` |
| `from_time` | `text` | `HH:MM` |
| `to_time` | `text` | `HH:MM`, must be > `from_time` |

Unique constraint: `(worker_id, day_of_week, from_time)` — proxy upserts with `onConflict: 'worker_id,day_of_week,from_time'`.
Indexes: `(worker_id)`, `(account_id)`
RLS: anon read · service role full access

---

### `shift_templates` (migration 3)
Reusable shift definitions per tenant account.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `account_id` | `text` | Clerk `userId` |
| `name` | `text` | 1–100 chars |
| `role` | `text` | 1–100 chars |
| `start_time` | `text` | `HH:MM` |
| `end_time` | `text` | `HH:MM`, must be > `start_time` |
| `coverage` | `integer` | ≥ 1, workers needed per slot |
| `created_at` | `timestamptz` | auto |

Index: `(account_id)`
RLS: anon read · service role full access

---

### `roster` (migration 3)
Assigned (Draft / Published) shifts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `account_id` | `text` | Clerk `userId` |
| `date` | `date` | shift date |
| `worker_id` | `uuid` FK | → `workers.id` restrict delete |
| `template_id` | `uuid` FK | → `shift_templates.id` restrict delete |
| `location` | `text` | max 200 chars |
| `status` | `text` | `Draft` or `Published` |
| `notified` | `boolean` | default `false` |
| `created_at` | `timestamptz` | auto |
| `updated_at` | `timestamptz` | auto-managed by trigger |

Indexes: `(account_id, date)`, `(worker_id, date)`
RLS: anon read · service role full access

---

### `usage_limits` (migration 4)
Per-user freemium usage counters.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `text` | Clerk `userId` |
| `account_id` | `text` | Clerk `userId` |
| `auto_assign_count` | `integer` | ≥ 0, incremented per auto-assign use |
| `created_at` | `timestamptz` | auto |
| `updated_at` | `timestamptz` | auto-managed by trigger |

Unique constraint: `(user_id, account_id)`
Index: `(user_id)`
RLS: anon read · service role full access

---

### `pos_sales` (migration 5)
Point-of-Sale revenue records uploaded by account owners to enrich demand forecasting.

Used by the forecast engine for:
- **Day-of-week seasonality** — computes per-weekday revenue index (e.g. Saturday = 1.35× average) to weight predictions
- **Linear trend detection** — OLS regression over the last 90 days detects whether demand is growing, flat, or declining
- **Revenue-per-worker-hour efficiency** — cross-references scheduled hours vs. revenue to surface overcapacity / understaffing
- **Capacity gap alerts** — flags dates where projected revenue implies more workers than currently scheduled

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `account_id` | `text` | Clerk `userId` — scopes data to the uploading tenant |
| `date` | `date` | Calendar date the revenue was recorded |
| `revenue` | `numeric(12,2)` | Total revenue in the owner's currency (≥ 0) |
  | `covers` | `integer` | Optional: number of customers / covers / transactions |
| `notes` | `text` | Optional label, max 500 chars (e.g. `Holiday weekend`) |
| `source` | `text` | `upload` (CSV/Excel file) or `manual` (typed directly) |
| `created_at` | `timestamptz` | auto |

Unique constraint: `(account_id, date)` — proxy upserts with `onConflict: 'account_id,date'`.
Indexes: `(account_id)`, `(account_id, date)`
RLS: anon read · service role full access

#### Accepted CSV/Excel upload format

The POS Upload section in the Scheduler accepts `.csv` files. Most POS systems (Square, Toast, Lightspeed, Shopify POS) support "Export as CSV". Excel files should be saved as CSV before uploading.

```
date,revenue,covers,notes
2026-01-01,1250.50,45,New Year's Day
2026-01-02,980.00,38,
2026-01-03,1105.75,41,Weekend promo
```

Column rules:
- **`date`** — required; accepts `YYYY-MM-DD`, `MM/DD/YYYY`, or `DD/MM/YYYY`; header row is auto-detected and skipped
- **`revenue`** — required; strips `$`, `€`, `£`, commas (e.g. `$1,250.50` → `1250.50`); must be ≥ 0
- **`covers`** — optional; integer count of customers or transactions
- **`notes`** — optional; free text label truncated to 500 chars

Up to **1 000 rows** accepted per upload. Duplicate dates within the same account are updated (upsert), not duplicated.

---

## Verification queries

After running all migrations, confirm tables exist with correct structure:

```sql
-- List all Horario tables
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'shifts', 'external_signals', 'demand_targets',
    'onboarding_progress', 'workers', 'worker_availability',
    'shift_templates', 'roster', 'usage_limits', 'pos_sales'
  )
order by table_name;
-- Expected: 10 rows

-- Confirm RLS is enabled on all tables
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'shifts', 'external_signals', 'demand_targets',
    'onboarding_progress', 'workers', 'worker_availability',
    'shift_templates', 'roster', 'usage_limits', 'pos_sales'
  )
order by tablename;
-- Expected: all rows show rowsecurity = true

-- After running autosave test — check data was persisted
select id, name, role, account_id from public.workers order by name;
select id, worker_id, day_of_week, from_time, to_time from public.worker_availability;
select id, name, role, start_time, end_time, coverage from public.shift_templates;
select id, date, worker_id, template_id, status from public.roster order by date;
select account_id, workers_completed, templates_completed, forecast_completed from public.onboarding_progress;

-- After uploading POS data — verify records landed correctly
select account_id, date, revenue, covers, source
from public.pos_sales
order by date desc
limit 20;

-- Day-of-week revenue summary (used by enhanced forecast engine)
select
  to_char(date, 'Dy') as weekday,
  round(avg(revenue), 2) as avg_revenue,
  round(avg(covers), 1) as avg_covers,
  count(*) as data_points
from public.pos_sales
group by to_char(date, 'Dy'), extract(dow from date)
order by extract(dow from date);
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Could not find the table 'public.workers'` | Migration 3 not run | Run `20260327000001_core_tables.sql` |
| `Could not find the table 'public.roster'` | Migration 3 not run | Run `20260327000001_core_tables.sql` |
| `Could not find the table 'public.worker_availability'` | Migration 3 not run | Run `20260327000001_core_tables.sql` |
| `Could not find the table 'public.shift_templates'` | Migration 3 not run | Run `20260327000001_core_tables.sql` |
| `Could not find the table 'public.onboarding_progress'` | Migration 2 not run | Run `20240613120000_onboarding_progress.sql` |
| `Could not find the table 'public.usage_limits'` | Migration 4 not run | Run `20260328000001_usage_limits.sql` |
| `Could not find the table 'public.pos_sales'` | Migration 5 not run | Run `20260401000001_pos_sales.sql` |
| POS upload returns 400 "table not found" | Migration 5 not run | Run `20260401000001_pos_sales.sql` |
| POS forecast shows no improvement over baseline | Not enough rows in `pos_sales` | Upload at least 14 days of revenue data; forecast engine needs ≥ 2 weeks for day-of-week seasonality |
| `duplicate key value violates unique constraint "pos_sales_account_date_unique"` | Uploading the same date twice | Expected — the proxy upserts on `(account_id, date)` so the row is updated, not rejected |
| `already exists` on constraint/policy | Migration re-run on existing DB | Safe to ignore — `IF NOT EXISTS` guards most objects; constraints without that guard need manual check |
| Data not persisting on reload | All of the above | Run all 5 migrations in order |

---

## Migration 5 setup checklist

After running `20260401000001_pos_sales.sql`, verify the following in the Supabase dashboard:

1. **Table Browser** → `pos_sales` exists with columns: `id`, `account_id`, `date`, `revenue`, `covers`, `notes`, `source`, `created_at`
2. **Authentication → Policies** → `pos_sales` shows two policies: `Anon read pos sales` and `Service role manages pos sales`
3. **Database → Indexes** → `pos_sales_account_id_idx` and `pos_sales_date_idx` exist
4. **SQL Editor** → run the day-of-week summary query above and confirm it returns data after your first upload

Once confirmed, the POS Upload section in the Scheduler → Demand Targets card is fully functional.
