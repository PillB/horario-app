-- =============================================================================
-- Migration: POS sales data for demand forecasting
-- Created:   2026-04-01
-- Depends:   20260327000001_core_tables.sql
--
-- Adds pos_sales table to store uploaded Point-of-Sale revenue data.
-- This data enriches demand forecasting with real revenue signals:
--   - Day-of-week seasonality (e.g., Saturdays avg 35% higher revenue)
--   - Trend detection (growing / declining business)
--   - Revenue-per-worker-hour efficiency metrics
--   - Overcapacity / understaffing gap analysis
-- =============================================================================

create table if not exists public.pos_sales (
  id           uuid           primary key default gen_random_uuid(),
  account_id   text           not null,
  date         date           not null,
  revenue      numeric(12,2)  not null check (revenue >= 0),
  -- covers = number of customers / covers / transactions (optional)
  covers       integer        check (covers is null or covers >= 0),
  notes        text           check (notes is null or char_length(notes) <= 500),
  source       text           not null default 'upload'
                              check (source in ('upload', 'manual')),
  created_at   timestamptz    not null default now()
);

-- One revenue record per account per date (upsert on conflict)
do $$ begin
  alter table public.pos_sales
    add constraint pos_sales_account_date_unique
    unique (account_id, date);
exception when duplicate_object then
  null;
end $$;

create index if not exists pos_sales_account_id_idx
  on public.pos_sales (account_id);

create index if not exists pos_sales_date_idx
  on public.pos_sales (account_id, date);

alter table public.pos_sales enable row level security;

drop policy if exists "Anon read pos sales" on public.pos_sales;
create policy "Anon read pos sales"
  on public.pos_sales for select
  using (auth.role() = 'anon');

drop policy if exists "Service role manages pos sales" on public.pos_sales;
create policy "Service role manages pos sales"
  on public.pos_sales for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
