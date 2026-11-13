-- =============================================================================
-- Migration: 20261113000103_worker_time_off.sql
-- CHG-098 — days off stored on the server
--
-- A worker's day off was kept in the browser / phone that entered it
-- (CHG-097), so another manager, or the same manager on another device, did
-- not see it and auto-assign there suggested the worker anyway. One row per
-- worker and date; deleting a worker deletes their days off.
--
-- Access is the same as every tenant table (20261018000001): no anon access,
-- authenticated may only SELECT rows of their own tenant, writes go through
-- the secure proxy with the service role.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.worker_time_off (
  id          uuid        primary key default gen_random_uuid(),
  account_id  text        not null,
  worker_id   uuid        not null references public.workers (id) on delete cascade,
  date        date        not null,
  reason      text        not null default '' check (char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  constraint worker_time_off_worker_date_key unique (worker_id, date)
);

create index if not exists worker_time_off_account_date_idx
  on public.worker_time_off (account_id, date);

alter table public.worker_time_off enable row level security;

revoke all on public.worker_time_off from anon;
revoke insert, update, delete, truncate on public.worker_time_off from authenticated;
grant select on public.worker_time_off to authenticated;

drop policy if exists "Tenant reads own rows" on public.worker_time_off;
create policy "Tenant reads own rows" on public.worker_time_off
  for select to authenticated
  using (account_id = (select private.current_account_id()));

comment on table public.worker_time_off is
  'One-off dates a worker cannot work. Auto-assign skips the worker on that date.';
