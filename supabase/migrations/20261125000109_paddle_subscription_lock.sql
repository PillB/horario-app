-- CHG-107: Paddle webhooks for one subscription delivered at the same time.
--
-- 20261122000107 serialised billing changes per account (advisory lock) and
-- applied events in occurred_at order. One interleaving still lost an event:
-- a newer event that carries no account reference (its copy of custom_data is
-- missing) arrives while an older event that names the account is being
-- applied. The newer one looked the account up before the older one committed,
-- found nothing and was stored as unmatched; the older one's reconcile ran
-- before that row committed and did not see it. The subscription stayed on the
-- older state (for example active after a cancel). The same gap existed between
-- a waiting subscription event and the transaction event that names its account.
--
-- Fix: every delivery for a subscription takes a per-subscription advisory lock
-- before it reads anything, so deliveries of one subscription run one after the
-- other and each sees what the previous one committed. Lock order is always
-- subscription, then account (inside private.apply_paddle_fields), so the two
-- locks cannot deadlock. Pessimistic locking, not a version column: the order
-- rule needs the other events of the subscription, not only the stored row, and
-- a lock makes a retry loop in the webhook unnecessary.
-- Tested with two real connections: server/__tests__/paddleRace.integration.test.ts.

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

  -- One delivery per subscription at a time (CHG-107). Taken before any read, so the account lookup
  -- and the unmatched check see every event of this subscription that was delivered before this one.
  perform pg_advisory_xact_lock(hashtextextended('paddle-subscription:' || sub_id, 0));

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
  if sub_id is not null then
    -- Same lock as apply_paddle_subscription (CHG-107): a subscription event being stored as
    -- unmatched right now is seen by the reconcile below once it commits.
    perform pg_advisory_xact_lock(hashtextextended('paddle-subscription:' || sub_id, 0));
  end if;

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
