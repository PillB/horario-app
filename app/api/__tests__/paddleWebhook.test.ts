/**
 * @jest-environment node
 *
 * The Paddle webhook route: only signed notifications reach the database, the
 * account comes only from a reference the server signed, and an event that
 * could not be stored is answered with 5xx so Paddle retries it.
 * Supabase is a recording fake; the SQL side has its own test
 * (supabase/tests/database/paddle_billing.test.sql).
 */
import { createHmac } from 'crypto';

import { checkoutCustomData } from '@/server/paddle';

type Rpc = { fn: string; args: Record<string, unknown> };
const mockRpcs: Rpc[] = [];
let mockRpcReply: { data: unknown; error: { code?: string; message?: string } | null } = { data: { outcome: 'applied' }, error: null };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcs.push({ fn, args });
      return mockRpcReply;
    },
  }),
}));

const SECRET = ['pdl', 'ntfset', 'test'].join('_');
const PRICE = 'pri_01cccccccccccccccccccccccc';
const ENV = {
  PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_PRICE_ESENCIAL_MONTH: 'pri_01aaaaaaaaaaaaaaaaaaaaaaaa',
  PADDLE_PRICE_ESENCIAL_YEAR: 'pri_01bbbbbbbbbbbbbbbbbbbbbbbb',
  PADDLE_PRICE_PRO_MONTH: PRICE,
  PADDLE_PRICE_PRO_YEAR: 'pri_01dddddddddddddddddddddddd',
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};

type Route = { POST: (req: Request) => Promise<Response> };

const event = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
  JSON.stringify({
    event_id: 'evt_01h8441jx8x1q971q9ksksqh82',
    event_type: 'subscription.created',
    occurred_at: '2026-11-21T10:00:00.000Z',
    notification_id: 'ntf_01h8441jx8x1q971q9ksksqh82',
    data: {
      id: 'sub_01h8bx8fmywym11t6swgzba704',
      status: 'active',
      customer_id: 'ctm_01h8441jn5pcwrfhwh78jqt8hk',
      billing_cycle: { interval: 'month', frequency: 1 },
      current_billing_period: { starts_at: '2026-11-21T10:00:00.000Z', ends_at: '2026-12-21T10:00:00.000Z' },
      scheduled_change: null,
      items: [{ quantity: 2, price: { id: PRICE } }],
      custom_data: checkoutCustomData('org_paid', SECRET),
      ...data,
    },
    ...over,
  });

const sign = (body: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

const post = (route: Route, body: string, signature: string | null) =>
  route.POST(
    new Request('https://horario.app/api/paddle-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(signature ? { 'Paddle-Signature': signature } : {}) },
      body,
    }),
  );

describe('Paddle webhook route', () => {
  let route: Route;
  const saved = { ...process.env };
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    Object.assign(process.env, ENV);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../paddle-webhook+api') as Route;
  });
  afterAll(() => {
    process.env = saved;
  });
  beforeEach(() => {
    mockRpcs.length = 0;
    mockRpcReply = { data: { outcome: 'applied' }, error: null };
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('applies a signed subscription event to the account the server signed for', async () => {
    const body = event();
    const res = await post(route, body, sign(body));
    expect([res.status, await res.json()]).toEqual([200, { ok: true, outcome: 'applied' }]);
    expect(mockRpcs).toHaveLength(1);
    expect(mockRpcs[0]).toMatchObject({
      fn: 'apply_paddle_subscription',
      args: {
        p_event_id: 'evt_01h8441jx8x1q971q9ksksqh82',
        p_event_type: 'subscription.created',
        p_occurred_at: '2026-11-21T10:00:00.000Z',
        p_account_id: 'org_paid',
        p_fields: { tier: 'pro', status: 'active', quantity: 2, billing_interval: 'month', paddle_price_id: PRICE },
      },
    });
  });

  it('refuses an unsigned, a wrongly signed or an old notification without touching the database', async () => {
    const body = event();
    expect((await post(route, body, null)).status).toBe(401);
    expect((await post(route, body, sign(body, undefined, 'another-secret'))).status).toBe(401);
    expect((await post(route, body, sign(body, Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
    expect((await post(route, body.replace('"quantity":2', '"quantity":200'), sign(body))).status).toBe(401);
    expect(mockRpcs).toEqual([]);
  });

  it('does not trust an account named in custom data without the server signature', async () => {
    const body = event({}, { custom_data: { horario_account: 'org_victim', horario_ref: '0'.repeat(64) } });
    await post(route, body, sign(body));
    expect(mockRpcs[0].args.p_account_id).toBeNull();
  });

  it('records other events without changing a subscription', async () => {
    mockRpcReply = { data: true, error: null };
    const body = event({ event_type: 'transaction.completed' }, { id: 'txn_01h8441jx8x1q971q9ksksqh82' });
    const res = await post(route, body, sign(body));
    expect(res.status).toBe(200);
    expect(mockRpcs.map((r) => r.fn)).toEqual(['record_paddle_event']);
  });

  it('answers 500 when the event could not be stored, so Paddle retries', async () => {
    mockRpcReply = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const body = event();
    expect((await post(route, body, sign(body))).status).toBe(500);
  });

  it('answers 400 for signed JSON that is not a Paddle notification', async () => {
    const body = JSON.stringify({ hello: 'world' });
    expect((await post(route, body, sign(body))).status).toBe(400);
    expect(mockRpcs).toEqual([]);
  });

  it('is unavailable (503, retried) while a price id is missing, instead of dropping the payment', async () => {
    const price = process.env.PADDLE_PRICE_PRO_YEAR;
    delete process.env.PADDLE_PRICE_PRO_YEAR;
    try {
      const body = event();
      expect((await post(route, body, sign(body))).status).toBe(503);
    } finally {
      process.env.PADDLE_PRICE_PRO_YEAR = price;
    }
  });
});
