-- =============================================================================
-- Migration: compliance_fixes
-- Created:   2026-04-03
-- Depends:   20260401000001_pos_sales.sql
--
-- Resolves the following audit findings:
--
--   1. RLS data-leak: anon SELECT policies on every table exposed ALL rows to
--      any anonymous caller regardless of account_id.  Replaced with policies
--      that scope reads to the account_id embedded in the Clerk JWT (the 'sub'
--      claim, or the custom 'account_id' claim when present).
--
--   2. Missing updated_at triggers on public.workers and
--      public.shift_templates.
--
--   3. Missing composite (account_id, created_at) indexes on workers,
--      shift_templates, usage_limits, and pos_sales for efficient time-range
--      queries.
--
--   4. Missing public.shift_messages table (referenced by shiftMessaging.ts).
--
--   5. Missing public.referrals table (referenced by referrals+api.ts).
--
-- DESIGN NOTE – account_id scoping in RLS
-- ----------------------------------------
-- Clerk embeds the Supabase-compatible JWT with:
--   sub            = Clerk user ID  (e.g. "user_2abc...")
--   account_id     = Clerk org/account ID when an org is active
--
-- We expose a stable SQL helper `private.jwt_account_id()` that resolves the
-- account_id from the JWT in the correct priority order:
--   1. request.jwt.claims ->> 'account_id'   (org-scoped sessions)
--   2. request.jwt.claims ->> 'sub'           (personal / dev-bypass sessions)
--
-- The helper is placed in a private schema so it cannot be called directly via
-- the PostgREST API surface.
--
-- The service-role key bypasses RLS entirely; all server-side writes continue
-- to work without changes.
-- =============================================================================


-- =============================================================================
-- 0. Private schema for internal helpers
-- =============================================================================

create schema if not exists private;

-- Revoke all public access; only the DB superuser / service role may execute
-- objects in this schema directly.
revoke all on schema private from public;


-- =============================================================================
-- 1. JWT account-id helper
-- =============================================================================

create or replace function private.jwt_account_id()
returns text
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select coalesce(
    -- Prefer an explicit 'account_id' claim (Clerk org sessions)
    nullif(
      ( current_setting('request.jwt.claims', true)::jsonb ->> 'account_id' ),
      ''
    ),
    -- Fall back to 'sub' (personal sessions / EXPO_PUBLIC_USER_ID dev bypass)
    nullif(
      ( current_setting('request.jwt.claims', true)::jsonb ->> 'sub' ),
      ''
    )
  );
$$;

comment on function private.jwt_account_id() is
  'Returns the effective account_id from the active Clerk JWT. '
  'Prefers the ''account_id'' org claim; falls back to the ''sub'' user claim. '
  'Returns NULL when called outside an authenticated request context.';


-- =============================================================================
-- 2. Fix anon SELECT policies – workers
-- =============================================================================

-- Drop the leaky policy that returned all rows to any anon caller.
drop policy if exists "Anon read workers" on public.workers;

-- New policy: anon callers only see rows belonging to their account.
create policy "Anon read own account workers"
  on public.workers
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );


-- =============================================================================
-- 3. Fix anon SELECT policies – worker_availability
-- =============================================================================

drop policy if exists "Anon read worker availability" on public.worker_availability;

create policy "Anon read own account worker availability"
  on public.worker_availability
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );


-- =============================================================================
-- 4. Fix anon SELECT policies – shift_templates
-- =============================================================================

drop policy if exists "Anon read shift templates" on public.shift_templates;

create policy "Anon read own account shift templates"
  on public.shift_templates
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );


-- =============================================================================
-- 5. Fix anon SELECT policies – roster
-- =============================================================================

drop policy if exists "Anon read roster" on public.roster;

create policy "Anon read own account roster"
  on public.roster
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );


-- =============================================================================
-- 6. Fix anon SELECT policies – usage_limits
-- =============================================================================

drop policy if exists "Anon read usage limits" on public.usage_limits;

create policy "Anon read own account usage limits"
  on public.usage_limits
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );


-- =============================================================================
-- 7. Fix anon SELECT policies – pos_sales
-- =============================================================================

drop policy if exists "Anon read pos sales" on public.pos_sales;

create policy "Anon read own account pos sales"
  on public.pos_sales
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );


-- =============================================================================
-- 8. Missing updated_at triggers – workers
-- =============================================================================

-- set_updated_at() is defined in core_tables; the CREATE OR REPLACE below is
-- a defensive no-op if this migration ever runs before that one.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- workers does not currently have an updated_at column – add it first.
alter table public.workers
  add column if not exists updated_at timestamptz not null default now();

-- Back-fill existing rows so updated_at is not misleadingly set to migration
-- time; set it equal to created_at for pre-existing records.
update public.workers
  set updated_at = created_at
  where updated_at = now()
    and created_at < now() - interval '1 second';

drop trigger if exists workers_updated_at on public.workers;
create trigger workers_updated_at
  before update on public.workers
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 9. Missing updated_at triggers – shift_templates
-- =============================================================================

alter table public.shift_templates
  add column if not exists updated_at timestamptz not null default now();

update public.shift_templates
  set updated_at = created_at
  where updated_at = now()
    and created_at < now() - interval '1 second';

drop trigger if exists shift_templates_updated_at on public.shift_templates;
create trigger shift_templates_updated_at
  before update on public.shift_templates
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 10. Missing composite indexes: (account_id, created_at)
-- =============================================================================

-- workers
create index if not exists workers_account_id_created_at_idx
  on public.workers (account_id, created_at);

-- shift_templates
create index if not exists shift_templates_account_id_created_at_idx
  on public.shift_templates (account_id, created_at);

-- usage_limits  (also covers (account_id, created_at) for audit queries)
create index if not exists usage_limits_account_id_created_at_idx
  on public.usage_limits (account_id, created_at);

-- pos_sales  (account_id, date already indexed; add created_at variant too)
create index if not exists pos_sales_account_id_created_at_idx
  on public.pos_sales (account_id, created_at);

-- roster: add (account_id, created_at) to complement existing (account_id, date)
create index if not exists roster_account_id_created_at_idx
  on public.roster (account_id, created_at);


-- =============================================================================
-- 11. shift_messages table
--
-- Stores per-shift notification messages sent to workers.
-- References roster.id; deleting a roster row cascades to its messages.
-- =============================================================================

create table if not exists public.shift_messages (
  id           uuid         primary key default gen_random_uuid(),
  account_id   text         not null,
  roster_id    uuid         not null
                              references public.roster (id) on delete cascade,
  worker_id    uuid         not null
                              references public.workers (id) on delete cascade,
  channel      text         not null default 'push'
                              check (channel in ('push', 'sms', 'email')),
  body         text         not null check (char_length(body) between 1 and 1000),
  status       text         not null default 'pending'
                              check (status in ('pending', 'sent', 'failed', 'delivered')),
  sent_at      timestamptz,
  error        text         check (error is null or char_length(error) <= 500),
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

comment on table public.shift_messages is
  'Outbound notification messages linked to individual roster shifts. '
  'Written exclusively by the server-side messaging worker via service-role key. '
  'Anon reads are scoped to the caller''s account_id via JWT claim.';

create index if not exists shift_messages_account_id_idx
  on public.shift_messages (account_id);

create index if not exists shift_messages_roster_id_idx
  on public.shift_messages (roster_id);

create index if not exists shift_messages_worker_id_idx
  on public.shift_messages (worker_id);

create index if not exists shift_messages_account_id_created_at_idx
  on public.shift_messages (account_id, created_at);

create index if not exists shift_messages_status_idx
  on public.shift_messages (status)
  where status in ('pending', 'failed');

alter table public.shift_messages enable row level security;

drop trigger if exists shift_messages_updated_at on public.shift_messages;
create trigger shift_messages_updated_at
  before update on public.shift_messages
  for each row execute function public.set_updated_at();

drop policy if exists "Anon read own account shift messages" on public.shift_messages;
create policy "Anon read own account shift messages"
  on public.shift_messages
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );

drop policy if exists "Service role manages shift messages" on public.shift_messages;
create policy "Service role manages shift messages"
  on public.shift_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');


-- =============================================================================
-- 12. referrals table
--
-- Tracks referral codes issued by users and the signups attributed to them.
-- referrer_user_id / referred_user_id are Clerk user IDs (text).
-- =============================================================================

create table if not exists public.referrals (
  id                uuid         primary key default gen_random_uuid(),
  account_id        text         not null,
  referrer_user_id  text         not null,
  referred_user_id  text,
  code              text         not null,
  status            text         not null default 'pending'
                                   check (status in ('pending', 'completed', 'expired', 'cancelled')),
  reward_granted    boolean      not null default false,
  completed_at      timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  -- Each referral code must be globally unique so it can be looked up without
  -- knowing account_id (e.g. during the signup flow of the referred user).
  constraint referrals_code_unique unique (code),
  -- A referring user can have at most one active (pending) code per account.
  constraint referrals_one_pending_per_referrer
    exclude using btree (account_id with =, referrer_user_id with =, status with =)
    where (status = 'pending')
);

comment on table public.referrals is
  'Referral codes and their redemption state. '
  'referrer_user_id / referred_user_id are Clerk user ID strings (text). '
  'The exclude constraint ensures a referrer can only have one pending code '
  'per account at a time, preventing code-farming abuse.';

comment on column public.referrals.code is
  'Short alphanumeric code surfaced in the app UI (e.g. "HORARIO-X7K2"). '
  'Globally unique; used as lookup key during the referred user''s signup flow.';

create index if not exists referrals_account_id_idx
  on public.referrals (account_id);

create index if not exists referrals_referrer_user_id_idx
  on public.referrals (referrer_user_id);

create index if not exists referrals_referred_user_id_idx
  on public.referrals (referred_user_id)
  where referred_user_id is not null;

create index if not exists referrals_code_idx
  on public.referrals (code);

create index if not exists referrals_account_id_created_at_idx
  on public.referrals (account_id, created_at);

create index if not exists referrals_status_idx
  on public.referrals (status)
  where status = 'pending';

alter table public.referrals enable row level security;

drop trigger if exists referrals_updated_at on public.referrals;
create trigger referrals_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

-- Anon callers may read their own account's referrals (e.g. to display the
-- referral dashboard).  The referred_user_id lookup during signup must go
-- through the service-role proxy so the code can be validated without the
-- caller knowing the referrer's account_id.
drop policy if exists "Anon read own account referrals" on public.referrals;
create policy "Anon read own account referrals"
  on public.referrals
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );

drop policy if exists "Service role manages referrals" on public.referrals;
create policy "Service role manages referrals"
  on public.referrals
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');