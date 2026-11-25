/**
 * @jest-environment node
 *
 * The proxy's payment actions (server/billing.ts) against a fake database and
 * a fake Paddle API. What matters: the account Paddle is told about comes from
 * the session (and is signed), the quantity is the number of locations, a
 * business never ends up with two subscriptions through the app, and every
 * failure says what to do next without leaking Paddle's error text.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { cancelSubscription, changeSubscription, createBillingPortalSession, createCheckoutSession } from '@/server/billing';
import { accountFromCustomData, type PaddleConfig } from '@/server/paddle';
import type { AuthContext } from '@/server/proxyAuth';

const CONFIG: PaddleConfig = {
  apiKey: 'test-api-key',
  apiBase: 'https://sandbox-api.paddle.com',
  environment: 'sandbox',
  webhookSecret: 'test-webhook-secret',
  prices: {
    esencial_month: 'pri_01aaaaaaaaaaaaaaaaaaaaaaaa',
    esencial_year: 'pri_01bbbbbbbbbbbbbbbbbbbbbbbb',
    pro_month: 'pri_01cccccccccccccccccccccccc',
    pro_year: 'pri_01dddddddddddddddddddddddd',
  },
};

const CTX = { accountId: 'org_mine', userId: 'user_1', canManage: true } as AuthContext;
const SUB = 'sub_01h8bx8fmywym11t6swgzba704';
const CUSTOMER = 'ctm_01h8441jn5pcwrfhwh78jqt8hk';

type Row = { status: string; payment_provider: string | null; paddle_customer_id: string | null; paddle_subscription_id: string | null; quantity: number | null } | null;

/** Answers the two reads billing makes: the subscription row and the location count. Records the account filters. */
function fakeClient(row: Row, locations: number) {
  const filters: string[] = [];
  const client = {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters.push(`${table}.${column}=${value}`);
          return builder;
        },
        maybeSingle: async () => ({ data: row, error: null }),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve({ count: locations, error: null }).then(resolve),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, filters };
}

type Sent = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };

function fakePaddle(status: number, data: unknown) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(status < 400 ? { data } : { error: { code: 'internal_error', detail: 'secret internal detail' } }), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const live: Row = { status: 'active', payment_provider: 'paddle', paddle_customer_id: CUSTOMER, paddle_subscription_id: SUB, quantity: 2 };

describe('createCheckoutSession', () => {
  it('asks Paddle for the chosen price, one per location, for the session account, signed', async () => {
    const { client, filters } = fakeClient({ status: 'active', payment_provider: null, paddle_customer_id: null, paddle_subscription_id: null, quantity: null }, 3);
    const paddle = fakePaddle(201, { id: 'txn_01', checkout: { url: 'https://horario.app/pay?_ptxn=txn_01' } });
    const result = await createCheckoutSession(client, CTX, { tier: 'pro', billingInterval: 'year', accountId: 'org_victim' }, { config: CONFIG, fetchImpl: paddle.fetchImpl });

    expect(result).toEqual({ status: 200, body: { checkoutUrl: 'https://horario.app/pay?_ptxn=txn_01', transactionId: 'txn_01', quantity: 3 } });
    expect(paddle.sent).toHaveLength(1);
    const [request] = paddle.sent;
    expect([request.method, request.url]).toEqual(['POST', 'https://sandbox-api.paddle.com/transactions']);
    expect(request.headers).toMatchObject({ Authorization: 'Bearer test-api-key', 'Paddle-Version': '1' });
    expect(request.body?.items).toEqual([{ price_id: 'pri_01dddddddddddddddddddddddd', quantity: 3 }]);
    // The account in the request body is ignored; the reference verifies only for the session's account.
    expect(accountFromCustomData(request.body?.custom_data, CONFIG.webhookSecret)).toBe('org_mine');
    expect(request.body).not.toHaveProperty('customer_id');
    expect(filters.every((f) => f.endsWith('=org_mine'))).toBe(true);
  });

  it('charges one location when the business has not set one up yet, and reuses a known Paddle customer', async () => {
    const { client } = fakeClient({ status: 'cancelled', payment_provider: 'paddle', paddle_customer_id: CUSTOMER, paddle_subscription_id: SUB, quantity: 1 }, 0);
    const paddle = fakePaddle(201, { id: 'txn_02', checkout: { url: 'https://horario.app/pay?_ptxn=txn_02' } });
    await createCheckoutSession(client, CTX, { tier: 'esencial' }, { config: CONFIG, fetchImpl: paddle.fetchImpl });
    expect(paddle.sent[0].body).toMatchObject({ items: [{ price_id: 'pri_01aaaaaaaaaaaaaaaaaaaaaaaa', quantity: 1 }], customer_id: CUSTOMER });
  });

  it('refuses a second subscription while one is live (active, past due or paused)', async () => {
    for (const status of ['active', 'trialing', 'past_due', 'paused']) {
      const { client } = fakeClient({ ...live!, status }, 1);
      const paddle = fakePaddle(201, {});
      const result = await createCheckoutSession(client, CTX, { tier: 'pro' }, { config: CONFIG, fetchImpl: paddle.fetchImpl });
      expect([status, result.status]).toEqual([status, 409]);
      expect(paddle.sent).toEqual([]);
    }
  });

  it.each([
    [{ tier: 'gratis' }, /esencial or pro/],
    [{ tier: 'enterprise' }, /esencial or pro/],
    [{ tier: 'pro', billingInterval: 'week' }, /month or year/],
  ])('refuses %j before calling anyone', async (payload, message) => {
    const paddle = fakePaddle(201, {});
    const result = await createCheckoutSession(fakeClient(null, 1).client, CTX, payload, { config: CONFIG, fetchImpl: paddle.fetchImpl });
    expect(result.status).toBe(400);
    expect(String((result.body as { error: string }).error)).toMatch(message);
    expect(paddle.sent).toEqual([]);
  });

  it('says payments are not set up when the server has no Paddle keys', async () => {
    const result = await createCheckoutSession(fakeClient(null, 1).client, CTX, { tier: 'pro' }, { config: null });
    expect(result).toEqual({ status: 501, body: { error: 'Online payment is not set up yet. Write to support to change your plan' } });
  });

  it('turns a Paddle outage into "nothing was charged" without its internal text', async () => {
    const paddle = fakePaddle(500, null);
    const result = await createCheckoutSession(fakeClient(null, 1).client, CTX, { tier: 'pro' }, { config: CONFIG, fetchImpl: paddle.fetchImpl });
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).toMatch(/Nothing was charged/);
    expect(JSON.stringify(result.body)).not.toMatch(/secret internal detail/);
  });

  it('reports a missing default payment link instead of opening an empty page', async () => {
    const paddle = fakePaddle(201, { id: 'txn_03', checkout: { url: '' } });
    const result = await createCheckoutSession(fakeClient(null, 1).client, CTX, { tier: 'pro' }, { config: CONFIG, fetchImpl: paddle.fetchImpl });
    expect(result.status).toBe(503);
  });
});

describe('changeSubscription', () => {
  it('replaces the plan price, keeps at least the locations in use, and prorates now', async () => {
    const paddle = fakePaddle(200, { id: SUB });
    const result = await changeSubscription(fakeClient(live, 3).client, CTX, { tier: 'esencial', billingInterval: 'month' }, { config: CONFIG, fetchImpl: paddle.fetchImpl });
    expect(result).toEqual({ status: 200, body: { success: true, pending: true, quantity: 3 } });
    expect(paddle.sent[0]).toMatchObject({
      method: 'PATCH',
      url: `https://sandbox-api.paddle.com/subscriptions/${SUB}`,
      body: { items: [{ price_id: 'pri_01aaaaaaaaaaaaaaaaaaaaaaaa', quantity: 3 }], proration_billing_mode: 'prorated_immediately' },
    });
  });

  it('refuses fewer paid locations than the business has, and a past-due or paused plan', async () => {
    const fewer = await changeSubscription(fakeClient(live, 3).client, CTX, { tier: 'pro', quantity: 2 }, { config: CONFIG, fetchImpl: fakePaddle(200, {}).fetchImpl });
    expect(fewer.status).toBe(409);
    expect(JSON.stringify(fewer.body)).toMatch(/has 3 locations/);
    const pastDue = await changeSubscription(fakeClient({ ...live!, status: 'past_due' }, 1).client, CTX, { tier: 'pro' }, { config: CONFIG });
    expect(pastDue.status).toBe(409);
    expect(JSON.stringify(pastDue.body)).toMatch(/Update the card/);
    const paused = await changeSubscription(fakeClient({ ...live!, status: 'paused' }, 1).client, CTX, { tier: 'pro' }, { config: CONFIG });
    expect(paused.status).toBe(409);
  });

  it('is a 404 for a business that never paid', async () => {
    const result = await changeSubscription(fakeClient(null, 1).client, CTX, { tier: 'pro' }, { config: CONFIG });
    expect(result.status).toBe(404);
  });
});

describe('billing portal and cancel', () => {
  it('opens a fresh portal session for the stored customer and subscription', async () => {
    const paddle = fakePaddle(201, { urls: { general: { overview: 'https://customer-portal.paddle.com/cpl_01?action=overview&token=t' } } });
    const result = await createBillingPortalSession(fakeClient(live, 1).client, CTX, { config: CONFIG, fetchImpl: paddle.fetchImpl });
    expect(result).toEqual({ status: 200, body: { portalUrl: 'https://customer-portal.paddle.com/cpl_01?action=overview&token=t' } });
    expect(paddle.sent[0]).toMatchObject({ url: `https://sandbox-api.paddle.com/customers/${CUSTOMER}/portal-sessions`, body: { subscription_ids: [SUB] } });
    expect((await createBillingPortalSession(fakeClient(null, 1).client, CTX, { config: CONFIG })).status).toBe(404);
  });

  it('cancels at the end of the paid period (a paused plan at once, as Paddle requires)', async () => {
    const paddle = fakePaddle(200, { id: SUB });
    expect((await cancelSubscription(fakeClient(live, 1).client, CTX, { config: CONFIG, fetchImpl: paddle.fetchImpl })).status).toBe(200);
    expect(paddle.sent[0]).toMatchObject({ url: `https://sandbox-api.paddle.com/subscriptions/${SUB}/cancel`, body: { effective_from: 'next_billing_period' } });
    const pausedPaddle = fakePaddle(200, { id: SUB });
    await cancelSubscription(fakeClient({ ...live!, status: 'paused' }, 1).client, CTX, { config: CONFIG, fetchImpl: pausedPaddle.fetchImpl });
    expect(pausedPaddle.sent[0].body).toEqual({ effective_from: 'immediately' });
    expect((await cancelSubscription(fakeClient(null, 1).client, CTX, { config: CONFIG })).status).toBe(404);
  });
});
