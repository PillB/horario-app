/**
 * @jest-environment node
 *
 * Two Paddle webhooks for one subscription delivered at the same time
 * (20261122000107_paddle_billing.sql, 20261125000109_paddle_subscription_lock.sql).
 * pgTAP runs in one session, so it cannot hold one delivery open while another
 * runs; this test uses two real connections. Connection 1 starts a delivery and
 * keeps its transaction open; connection 2 delivers the other event; then
 * connection 1 commits. The subscription must end on the newest event whatever
 * the interleaving.
 *
 * Skipped unless SUPABASE_TEST_DB_URL is set (CI: `supabase status -o env` DB_URL).
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const DB_URL = process.env.SUPABASE_TEST_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const run = randomUUID().replace(/-/g, '').slice(0, 10);
/** A Paddle-shaped id: prefix + 26 lowercase letters or digits, unique to this run. */
const pid = (prefix: string, n: number) => `${prefix}_${(run + String(n).padStart(4, '0')).padEnd(26, 'x')}`;

const fields = (sub: string, status: string) => ({
  paddle_subscription_id: sub,
  paddle_customer_id: pid('ctm', 0),
  paddle_price_id: 'pri_01cccccccccccccccccccccccc',
  tier: 'pro',
  status,
  quantity: 1,
  billing_interval: 'month',
  current_period_start: '2026-11-21T10:00:00Z',
  current_period_end: '2026-12-21T10:00:00Z',
  cancel_at_period_end: false,
});

const APPLY = `select (public.apply_paddle_subscription($1, 'subscription.updated', $2::timestamptz, '{}'::jsonb, $3, $4::jsonb)) ->> 'outcome' as outcome`;

describeIfDb('Paddle webhooks delivered at the same time (local database)', () => {
  let held: Client;
  let other: Client;
  let reader: Client;

  const connect = async () => {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    // As the webhook calls it: the service role, PostgREST's default isolation.
    await client.query('set role service_role');
    return client;
  };

  beforeAll(async () => {
    [held, other, reader] = await Promise.all([connect(), connect(), connect()]);
  });
  afterAll(async () => {
    await Promise.all([held, other, reader].map((c) => c?.end()));
  });

  const apply = (client: Client, event: string, at: string, account: string | null, sub: string, status: string) =>
    client.query<{ outcome: string }>(APPLY, [event, at, account, JSON.stringify(fields(sub, status))]).then((r) => r.rows[0].outcome);

  const stateOf = async (account: string) =>
    (await reader.query<{ status: string; outcome: string | null }>(
      `select s.status, (select string_agg(e.event_id || '=' || e.outcome, ',' order by e.occurred_at)
                        from public.paddle_events e where e.paddle_subscription_id = s.paddle_subscription_id) as outcome
       from public.subscriptions s where s.account_id = $1`,
      [account],
    )).rows[0];

  /** Whether a promise settles within ms (false = still waiting on a lock). */
  const settlesWithin = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

  /**
   * Connection 1 applies `first` inside an open transaction; connection 2 then applies `second`;
   * connection 1 commits. Returns both outcomes and the account's final state.
   */
  async function interleave(
    account: string,
    first: [event: string, at: string, account: string | null, sub: string, status: string],
    second: [event: string, at: string, account: string | null, sub: string, status: string],
  ) {
    await held.query('begin');
    const firstOutcome = await apply(held, ...first);
    const secondPromise = apply(other, ...second);
    const secondFinishedEarly = await settlesWithin(secondPromise, 300);
    await held.query('commit');
    const secondOutcome = await secondPromise;
    return { firstOutcome, secondOutcome, secondFinishedEarly, final: await stateOf(account) };
  }

  it('a newer event without an account, delivered while an older one is being applied, is not lost', async () => {
    // Paddle sent the cancel after the activation; the cancel's copy of custom_data has no account.
    const account = `acct_race_a_${run}`;
    const sub = pid('sub', 1);
    const result = await interleave(
      account,
      [pid('evt', 1), '2026-11-21T10:00:00Z', account, sub, 'active'],
      [pid('evt', 2), '2026-11-21T10:05:00Z', null, sub, 'cancelled'],
    );
    // Before the subscription lock the cancel did not wait: it found no account (the activation
    // was not committed), was stored as unmatched, and the activation's reconcile could not see it.
    expect(result).toMatchObject({ firstOutcome: 'applied', secondFinishedEarly: false, secondOutcome: 'applied' });
    expect(result.final.status).toBe('cancelled');
  });

  it('an older event delivered while a newer one is being applied is stale (both carry the account)', async () => {
    const account = `acct_race_b_${run}`;
    const sub = pid('sub', 2);
    const result = await interleave(
      account,
      [pid('evt', 3), '2026-12-02T10:00:00Z', account, sub, 'cancelled'],
      [pid('evt', 4), '2026-12-01T10:00:00Z', account, sub, 'past_due'],
    );
    expect(result).toMatchObject({ firstOutcome: 'applied', secondFinishedEarly: false, secondOutcome: 'stale' });
    expect(result.final.status).toBe('cancelled');
  });

  it('a newer event delivered while an older one is being applied wins (both carry the account)', async () => {
    const account = `acct_race_c_${run}`;
    const sub = pid('sub', 3);
    const result = await interleave(
      account,
      [pid('evt', 5), '2026-12-01T10:00:00Z', account, sub, 'past_due'],
      [pid('evt', 6), '2026-12-02T10:00:00Z', account, sub, 'cancelled'],
    );
    expect(result).toMatchObject({ firstOutcome: 'applied', secondFinishedEarly: false, secondOutcome: 'applied' });
    expect(result.final.status).toBe('cancelled');
  });

  it('a transaction naming the account, delivered while the waiting event is being stored, applies it', async () => {
    // The subscription event (no account) is being stored as unmatched when the transaction that names
    // the account arrives; the transaction must see it once it commits.
    const account = `acct_race_d_${run}`;
    const sub = pid('sub', 4);
    await held.query('begin');
    const waiting = await apply(held, pid('evt', 7), '2026-12-03T10:00:00Z', null, sub, 'active');
    const txn = other.query(
      `select public.record_paddle_event($1, 'transaction.completed', '2026-12-03T10:00:02Z', $2::jsonb, $3) as recorded`,
      [pid('evt', 8), JSON.stringify({ data: { id: pid('txn', 1), subscription_id: sub } }), account],
    );
    const finishedEarly = await settlesWithin(txn, 300);
    await held.query('commit');
    await txn;
    expect([waiting, finishedEarly]).toEqual(['unmatched', false]);
    expect((await stateOf(account))?.status).toBe('active');
  });
});
