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

-- Redeems a code in one statement so concurrent requests cannot exceed
-- max_redemptions. Returns the referrer's user id, or NULL when the code is
-- unknown, inactive, expired, exhausted or belongs to the caller.
create or replace function public.redeem_referral(p_code text, p_user_id text)
returns text
language sql
volatile
set search_path = ''
as $$
  update public.referrals
     set redemption_count = redemption_count + 1,
         referred_user_id = p_user_id,
         completed_at     = case when redemption_count + 1 >= max_redemptions then now() else completed_at end,
         status           = case when redemption_count + 1 >= max_redemptions then 'completed' else status end
   where code = upper(p_code)
     and status = 'pending'
     and (expires_at is null or expires_at > now())
     and redemption_count < max_redemptions
     and referrer_user_id <> p_user_id
  returning referrer_user_id;
$$;

revoke all on function public.redeem_referral(text, text) from public, anon, authenticated;
grant execute on function public.redeem_referral(text, text) to service_role;
