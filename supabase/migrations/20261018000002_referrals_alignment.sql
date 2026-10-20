-- =============================================================================
-- Migration: 20261018000002_referrals_alignment.sql
-- CHG-069 — make the referrals table match the referrals API and redeem atomically
--
-- The API route wrote columns that did not exist (referral_code, channel,
-- max_redemptions, redemption_count, accepted_at) and redeemed codes with a
-- read-then-write that let concurrent requests over-redeem (QA P2). The table
-- keeps its original column names; the API now uses them, and these columns
-- are added for multi-use codes.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.referrals add column if not exists channel          text    not null default 'link';
alter table public.referrals add column if not exists max_redemptions  integer not null default 5;
alter table public.referrals add column if not exists redemption_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'referrals_redemption_bounds') then
    alter table public.referrals
      add constraint referrals_redemption_bounds
      check (max_redemptions >= 1 and redemption_count >= 0 and redemption_count <= max_redemptions);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'referrals_channel_length') then
    alter table public.referrals
      add constraint referrals_channel_length check (char_length(channel) between 1 and 40);
  end if;
end $$;

-- One row per (code, redeemer): the unique key stops a user redeeming the same
-- code twice (QA R1). Server-only: no grants to anon or authenticated.
create table if not exists public.referral_redemptions (
  referral_id uuid        not null references public.referrals (id) on delete cascade,
  user_id     text        not null,
  redeemed_at timestamptz not null default now(),
  primary key (referral_id, user_id)
);
alter table public.referral_redemptions enable row level security;
revoke all on public.referral_redemptions from anon, authenticated;

-- Redeems a code in one statement. The referral row is locked first, so
-- concurrent requests cannot exceed max_redemptions, and the count only moves
-- when this user's redemption row is new. Returns the referrer's user id, or
-- NULL when the code is unknown, inactive, expired, exhausted, belongs to the
-- caller, or was already redeemed by the caller.
create or replace function public.redeem_referral(p_code text, p_user_id text)
returns text
language sql
volatile
set search_path = ''
as $$
  with target as (
    select id
      from public.referrals
     where code = upper(p_code)
       and status = 'pending'
       and (expires_at is null or expires_at > now())
       and redemption_count < max_redemptions
       and referrer_user_id <> p_user_id
     for update
  ), claimed as (
    insert into public.referral_redemptions (referral_id, user_id)
    select id, p_user_id from target
    on conflict do nothing
    returning referral_id
  )
  update public.referrals r
     set redemption_count = r.redemption_count + 1,
         referred_user_id = p_user_id,
         completed_at     = case when r.redemption_count + 1 >= r.max_redemptions then now() else r.completed_at end,
         status           = case when r.redemption_count + 1 >= r.max_redemptions then 'completed' else r.status end
    from claimed
   where r.id = claimed.referral_id
  returning r.referrer_user_id;
$$;

revoke all on function public.redeem_referral(text, text) from public, anon, authenticated;
grant execute on function public.redeem_referral(text, text) to service_role;
