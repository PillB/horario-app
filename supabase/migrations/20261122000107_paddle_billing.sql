-- =============================================================================
-- Migration: 20261122000107_paddle_billing.sql
-- CHG-104 — paid plans through Paddle (merchant of record)
--
-- 1. subscriptions: Paddle columns, `paddle` as a provider, `paused` as a status.
--    The row is the mirror of the account's Paddle subscription; server/plans.ts
--    reads it on every gated request (active / trialing, or past_due for a
--    grace period, gives the plan; `quantity` is the number of paid locations).
-- 2. paddle_events: every signed webhook Paddle sent, keyed by its event id, so
--    a retried or replayed notification is applied once. It is also the audit
--    log of what Paddle told us and what was done with it.
-- 3. apply_paddle_subscription(): records the event and applies it to the
--    account's subscription row in one transaction, behind the account's lock.
--    Paddle does not deliver in order; an event older than the one already
--    applied is recorded and ignored.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. subscriptions ─────────────────────────────────────────────────────────

do $$
declare
  c record;
begin
  -- The old checks are unnamed column constraints: drop the provider and status ones.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.subscriptions'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%payment_provider%' or pg_get_constraintdef(oid) ilike '%status%')
  loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.subscriptions
  add constraint subscriptions_payment_provider_known
    check (payment_provider is null or payment_provider in ('stripe', 'culqi', 'paddle')),
  add constraint subscriptions_status_known
    check (status in ('active', 'trialing', 'past_due', 'paused', 'cancelled', 'unpaid'));

alter table public.subscriptions
  add column if not exists paddle_customer_id     text check (paddle_customer_id is null or paddle_customer_id ~ '^ctm_[a-z0-9]{26}$'),
  add column if not exists paddle_subscription_id text check (paddle_subscription_id is null or paddle_subscription_id ~ '^sub_[a-z0-9]{26}$'),
  add column if not exists paddle_price_id        text check (paddle_price_id is null or paddle_price_id ~ '^pri_[a-z0-9]{26}$'),
  -- Locations paid for (the subscription's quantity). null = not a per-location subscription.
  add column if not exists quantity               integer check (quantity is null or quantity between 1 and 1000),
  -- When the subscription last became past_due; cleared when it is paid.
  add column if not exists past_due_since         timestamptz,
  -- occurred_at of the Paddle event the row reflects: older events are ignored.
  add column if not exists paddle_occurred_at     timestamptz;

create unique index if not exists subscriptions_paddle_subscription_key
  on public.subscriptions (paddle_subscription_id) where paddle_subscription_id is not null;

-- ── 2. paddle_events ─────────────────────────────────────────────────────────

create table if not exists public.paddle_events (
  event_id     text        primary key check (event_id ~ '^evt_[a-z0-9]{26}$'),
  event_type   text        not null check (length(event_type) between 1 and 100),
  occurred_at  timestamptz not null,
  received_at  timestamptz not null default now(),
  account_id   text,
  -- The subscription the event is about (a subscription event's id, a transaction's subscription_id).
  paddle_subscription_id text,
  -- A subscription event's fields as the app stores them, kept so an unmatched event can be applied later.
  fields       jsonb,
  -- applied | stale | unmatched | second_subscription | recorded
  outcome      text        not null default 'recorded'
    check (outcome in ('applied', 'stale', 'unmatched', 'second_subscription', 'recorded')),
  payload      jsonb       not null
);

create index if not exists paddle_events_account_idx on public.paddle_events (account_id, occurred_at desc);
create index if not exists paddle_events_subscription_idx on public.paddle_events (paddle_subscription_id, occurred_at desc)
  where paddle_subscription_id is not null;
create index if not exists paddle_events_outcome_idx on public.paddle_events (outcome) where outcome in ('unmatched', 'second_subscription');

alter table public.paddle_events enable row level security;
revoke all on public.paddle_events from anon, authenticated;
-- Events are written only by the functions below (they run as their owner);
-- the service role can read the record but not edit or delete it.
grant select on public.paddle_events to service_role;
revoke insert, update, delete, truncate on public.paddle_events from service_role;

-- ── 3. Applying events ───────────────────────────────────────────────────────
--
-- p_fields: the subscription as the app stores it (server/paddle.ts,
-- subscriptionFieldsFromEvent): paddle_subscription_id, paddle_customer_id,
-- paddle_price_id, tier, status, quantity, billing_interval,
-- current_period_start, current_period_end, cancel_at_period_end.
--
-- Ordering is per subscription: an event older than any event already
-- recorded for the same subscription is stale, whether or not that newer
-- event changed the account's row (CHG-104 review: a replacement
-- subscription's cancel arriving before its own activation).
--
-- Outcomes:
--   duplicate            the event id was seen before; nothing done
--   unmatched            no account for it yet; kept, and applied when the
--                        transaction that names the account is recorded
--   stale                a later event of this subscription is already recorded,
--                        or it is an ended subscription that is not the account's
--   second_subscription  the account already pays through another live
--                        subscription; recorded, not applied (refund one)
--   applied              the account's row now reflects the event

-- Applies a recorded subscription event to an account. Caller holds nothing; this takes the account's lock.
create or replace function private.apply_paddle_fields(p_event_id text, p_occurred_at timestamptz, p_account text, p_fields jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  sub_id text := p_fields ->> 'paddle_subscription_id';
  new_status text := p_fields ->> 'status';
  current_row public.subscriptions%rowtype;
  v_outcome text;
begin
  -- One billing change per account at a time.
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_account, 0));

  if exists (
    select 1 from public.paddle_events e
    where e.paddle_subscription_id = sub_id
      and e.event_type like 'subscription.%'
      and e.event_id <> p_event_id
      and e.occurred_at > p_occurred_at
  ) then
    v_outcome := 'stale';
  else
    select * into current_row from public.subscriptions s where s.account_id = p_account;
    if found and current_row.paddle_subscription_id is not null and current_row.paddle_subscription_id <> sub_id then
      if new_status not in ('active', 'trialing', 'past_due') then
        -- An ended subscription that is not the one in force: the row stays.
        v_outcome := 'stale';
      elsif current_row.status in ('active', 'trialing', 'past_due', 'paused') then
        v_outcome := 'second_subscription';
      end if;
    end if;
  end if;

  if v_outcome is null then
    insert into public.subscriptions as s (
      account_id, tier, status, payment_provider, paddle_customer_id, paddle_subscription_id, paddle_price_id,
      quantity, billing_interval, current_period_start, current_period_end, cancel_at_period_end,
      past_due_since, paddle_occurred_at
    ) values (
      p_account,
      p_fields ->> 'tier',
      new_status,
      'paddle',
      p_fields ->> 'paddle_customer_id',
      sub_id,
      p_fields ->> 'paddle_price_id',
      (p_fields ->> 'quantity')::integer,
      coalesce(p_fields ->> 'billing_interval', 'month'),
      (p_fields ->> 'current_period_start')::timestamptz,
      (p_fields ->> 'current_period_end')::timestamptz,
      coalesce((p_fields ->> 'cancel_at_period_end')::boolean, false),
      case when new_status = 'past_due' then p_occurred_at end,
      p_occurred_at
    )
    on conflict (account_id) do update set
      tier = excluded.tier,
      status = excluded.status,
      payment_provider = 'paddle',
      paddle_customer_id = coalesce(excluded.paddle_customer_id, s.paddle_customer_id),
      paddle_subscription_id = excluded.paddle_subscription_id,
      paddle_price_id = excluded.paddle_price_id,
      quantity = excluded.quantity,
      billing_interval = excluded.billing_interval,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      -- The grace period counts from the first past_due, not from each retry.
      past_due_since = case
        when excluded.status <> 'past_due' then null
        when s.status = 'past_due' and s.paddle_subscription_id = excluded.paddle_subscription_id then coalesce(s.past_due_since, excluded.past_due_since)
        else excluded.past_due_since
      end,
      paddle_occurred_at = excluded.paddle_occurred_at;
    v_outcome := 'applied';
  end if;

  update public.paddle_events set outcome = v_outcome, account_id = p_account where event_id = p_event_id;
  return v_outcome;
end $$;

revoke all on function private.apply_paddle_fields(text, timestamptz, text, jsonb) from public, anon, authenticated, service_role;

-- Once the account of a subscription is known, its newest event that was waiting
-- as unmatched is applied, and older waiting ones are superseded.
create or replace function private.reconcile_unmatched_paddle(p_subscription_id text, p_account text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  waiting record;
begin
  select e.event_id, e.occurred_at, e.fields into waiting
  from public.paddle_events e
  where e.paddle_subscription_id = p_subscription_id and e.outcome = 'unmatched' and e.fields is not null
  order by e.occurred_at desc
  limit 1;
  if found then
    perform private.apply_paddle_fields(waiting.event_id, waiting.occurred_at, p_account, waiting.fields);
    update public.paddle_events set outcome = 'stale', account_id = p_account
    where paddle_subscription_id = p_subscription_id and outcome = 'unmatched';
  end if;
end $$;

revoke all on function private.reconcile_unmatched_paddle(text, text) from public, anon, authenticated, service_role;

-- p_account_id: the account the signed checkout reference names (verified by
-- the webhook), or null when the event carries none; then the account is the
-- one already linked to the subscription id, else the one a recorded
-- transaction event for that subscription named.
create or replace function public.apply_paddle_subscription(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_account_id text,
  p_fields jsonb
)
returns jsonb
language plpgsql
volatile
-- Runs as its owner: the service role cannot write paddle_events directly.
security definer
set search_path = ''
as $$
declare
  sub_id text := p_fields ->> 'paddle_subscription_id';
  account text := nullif(p_account_id, '');
  v_outcome text;
begin
  if sub_id is null or (p_fields ->> 'status') is null then
    raise exception 'apply_paddle_subscription: subscription id and status are required' using errcode = '22023';
  end if;

  insert into public.paddle_events (event_id, event_type, occurred_at, payload, paddle_subscription_id, fields)
  values (p_event_id, p_event_type, p_occurred_at, p_payload, sub_id, p_fields)
  on conflict (event_id) do nothing;
  if not found then
    return jsonb_build_object('outcome', 'duplicate', 'account_id', null);
  end if;

  if account is null then
    select s.account_id into account from public.subscriptions s where s.paddle_subscription_id = sub_id;
  end if;
  if account is null then
    -- The transaction that created the subscription carried the signed reference.
    select e.account_id into account
    from public.paddle_events e
    where e.event_type like 'transaction.%' and e.account_id is not null and e.paddle_subscription_id = sub_id
    order by e.occurred_at desc
    limit 1;
  end if;
  if account is null then
    update public.paddle_events set outcome = 'unmatched' where event_id = p_event_id;
    return jsonb_build_object('outcome', 'unmatched', 'account_id', null);
  end if;

  v_outcome := private.apply_paddle_fields(p_event_id, p_occurred_at, account, p_fields);
  -- A newer event of this subscription may be waiting without an account (it arrived first).
  perform private.reconcile_unmatched_paddle(sub_id, account);
  return jsonb_build_object('outcome', v_outcome, 'account_id', account);
end $$;

revoke all on function public.apply_paddle_subscription(text, text, timestamptz, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_paddle_subscription(text, text, timestamptz, jsonb, text, jsonb) to service_role;

-- Records an event that changes no subscription by itself (transaction.completed, ...).
-- A transaction that names an account (p_account_id, verified by the webhook) and a
-- subscription applies that subscription's newest event still waiting as unmatched.
-- Returns false for a duplicate.
drop function if exists public.record_paddle_event(text, text, timestamptz, jsonb, text);
create or replace function public.record_paddle_event(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_account_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  account text := nullif(p_account_id, '');
  sub_id text := case when p_event_type like 'transaction.%' then nullif(p_payload -> 'data' ->> 'subscription_id', '') end;
begin
  insert into public.paddle_events (event_id, event_type, occurred_at, payload, account_id, paddle_subscription_id)
  values (p_event_id, p_event_type, p_occurred_at, p_payload, account, sub_id)
  on conflict (event_id) do nothing;
  if not found then
    return false;
  end if;

  if account is not null and sub_id is not null then
    perform private.reconcile_unmatched_paddle(sub_id, account);
  end if;
  return true;
end $$;

revoke all on function public.record_paddle_event(text, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_paddle_event(text, text, timestamptz, jsonb, text) to service_role;
