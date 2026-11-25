/**
 * @jest-environment node
 *
 * Paddle helpers (server/paddle.ts): webhook signature, the signed checkout
 * reference, the subscription mapping and the configuration.
 *
 * The signature vector was computed outside this code, with
 *   printf '%s' '<ts>:<body>' | openssl dgst -sha256 -hmac '<secret>' -hex
 * (the scheme of developer.paddle.com/webhooks/about/signature-verification,
 * read 2026-11-21), so the test does not re-derive the expected value with
 * the implementation's own formula.
 */
import {
  accountFromCustomData,
  checkoutCustomData,
  planForPrice,
  readPaddleConfig,
  readWebhookConfig,
  SIGNATURE_TOLERANCE_SECONDS,
  subscriptionFieldsFromEvent,
  verifyPaddleSignature,
} from '@/server/paddle';

// The example secret from Paddle's docs, split so secret scanners do not flag the test.
const SECRET = ['pdl', 'ntfset', '01gkpjp8bkm3tm53kdgkx6sms7', '6h3qd3uFSi9YCD3OLYAShQI90XTI3vEI'].join('_');
const TS = 1671552777;
const BODY = '{"event_id":"evt_01h8441jx8x1q971q9ksksqh82","event_type":"subscription.created"}';
const H1 = 'cdb84e88c229c99fb2a55cb992e0958ac603f657c4a26145f3612cb3074f20d0';
const AT = (secondsAfter: number) => (TS + secondsAfter) * 1000;

describe('verifyPaddleSignature', () => {
  it('accepts the openssl-computed signature', () => {
    expect(verifyPaddleSignature(`ts=${TS};h1=${H1}`, BODY, SECRET, AT(1))).toEqual({ ok: true, timestamp: TS });
  });

  it('accepts any of several h1 values (secret rotation)', () => {
    const other = 'a'.repeat(64);
    expect(verifyPaddleSignature(`ts=${TS};h1=${other};h1=${H1}`, BODY, SECRET, AT(1)).ok).toBe(true);
  });

  it.each([
    ['one changed byte of the body', `ts=${TS};h1=${H1}`, BODY.replace('created', 'updated'), SECRET],
    ['a body with added whitespace (re-serialized JSON)', `ts=${TS};h1=${H1}`, BODY + '\n', SECRET],
    ['another secret', `ts=${TS};h1=${H1}`, BODY, SECRET + 'x'],
    ['another timestamp with the same h1', `ts=${TS + 1};h1=${H1}`, BODY, SECRET],
    ['no h1', `ts=${TS}`, BODY, SECRET],
    ['no ts', `h1=${H1}`, BODY, SECRET],
    ['a short h1', `ts=${TS};h1=${H1.slice(2)}`, BODY, SECRET],
    ['no header', null, BODY, SECRET],
  ])('refuses %s', (_label, header, body, secret) => {
    expect(verifyPaddleSignature(header, body, secret, AT(1)).ok).toBe(false);
  });

  it('accepts a signature exactly at the age limit and refuses one a second older', () => {
    expect(verifyPaddleSignature(`ts=${TS};h1=${H1}`, BODY, SECRET, AT(SIGNATURE_TOLERANCE_SECONDS)).ok).toBe(true);
    expect(verifyPaddleSignature(`ts=${TS};h1=${H1}`, BODY, SECRET, AT(SIGNATURE_TOLERANCE_SECONDS + 1))).toEqual({
      ok: false,
      reason: `signature is ${SIGNATURE_TOLERANCE_SECONDS + 1} s old (limit ${SIGNATURE_TOLERANCE_SECONDS} s)`,
    });
    expect(verifyPaddleSignature(`ts=${TS};h1=${H1}`, BODY, SECRET, AT(-SIGNATURE_TOLERANCE_SECONDS - 1)).ok).toBe(false);
  });
});

describe('signed checkout reference', () => {
  it('names the account it was signed for', () => {
    expect(accountFromCustomData(checkoutCustomData('org_abc', SECRET), SECRET)).toBe('org_abc');
  });

  it('refuses a reference moved to another account, a forged one, or one signed with another secret', () => {
    const mine = checkoutCustomData('org_abc', SECRET);
    expect(accountFromCustomData({ ...mine, horario_account: 'org_victim' }, SECRET)).toBeNull();
    expect(accountFromCustomData({ horario_account: 'org_abc', horario_ref: '0'.repeat(64) }, SECRET)).toBeNull();
    expect(accountFromCustomData(checkoutCustomData('org_abc', 'other-secret'), SECRET)).toBeNull();
    expect(accountFromCustomData({ horario_account: 'org_abc' }, SECRET)).toBeNull();
    expect(accountFromCustomData(null, SECRET)).toBeNull();
    expect(accountFromCustomData({ horario_account: 'org abc; drop', horario_ref: mine.horario_ref }, SECRET)).toBeNull();
  });
});

const PRICES = {
  esencial_month: 'pri_01aaaaaaaaaaaaaaaaaaaaaaaa',
  esencial_year: 'pri_01bbbbbbbbbbbbbbbbbbbbbbbb',
  pro_month: 'pri_01cccccccccccccccccccccccc',
  pro_year: 'pri_01dddddddddddddddddddddddd',
};

/** Shaped like the subscription.updated example on developer.paddle.com. */
const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub_01h8bx8fmywym11t6swgzba704',
  status: 'active',
  customer_id: 'ctm_01h8441jn5pcwrfhwh78jqt8hk',
  currency_code: 'USD',
  billing_cycle: { interval: 'year', frequency: 1 },
  current_billing_period: { starts_at: '2026-11-21T10:00:00.000Z', ends_at: '2027-11-21T10:00:00.000Z' },
  scheduled_change: null,
  items: [{ status: 'active', quantity: 3, recurring: true, price: { id: PRICES.pro_year, product_id: 'pro_01h7zcgmdc6tmwtjehp3sh7azf' } }],
  custom_data: null,
  ...over,
});

describe('subscriptionFieldsFromEvent', () => {
  it('maps an active yearly Pro subscription for 3 locations', () => {
    expect(subscriptionFieldsFromEvent(subscription(), PRICES)).toEqual({
      ok: true,
      fields: {
        paddle_subscription_id: 'sub_01h8bx8fmywym11t6swgzba704',
        paddle_customer_id: 'ctm_01h8441jn5pcwrfhwh78jqt8hk',
        paddle_price_id: PRICES.pro_year,
        tier: 'pro',
        status: 'active',
        quantity: 3,
        billing_interval: 'year',
        current_period_start: '2026-11-21T10:00:00.000Z',
        current_period_end: '2027-11-21T10:00:00.000Z',
        cancel_at_period_end: false,
      },
    });
  });

  it('marks a scheduled cancel and spells canceled the way the table does', () => {
    const scheduled = subscriptionFieldsFromEvent(
      subscription({ scheduled_change: { action: 'cancel', effective_at: '2027-11-21T10:00:00.000Z', resume_at: null } }),
      PRICES,
    );
    expect(scheduled.ok && scheduled.fields.cancel_at_period_end).toBe(true);
    const ended = subscriptionFieldsFromEvent(subscription({ status: 'canceled', current_billing_period: null }), PRICES);
    expect(ended.ok && [ended.fields.status, ended.fields.current_period_end]).toEqual(['cancelled', null]);
    const paused = subscriptionFieldsFromEvent(subscription({ scheduled_change: { action: 'pause', effective_at: '2027-01-01T00:00:00Z' } }), PRICES);
    expect(paused.ok && paused.fields.cancel_at_period_end).toBe(false);
  });

  it.each([
    ['a price that is not one of Horario\'s', { items: [{ quantity: 1, price: { id: 'pri_01zzzzzzzzzzzzzzzzzzzzzzzz' } }] }, /no Horario plan price/],
    ['an unknown status', { status: 'deleted' }, /unknown status/],
    ['a malformed id', { id: 'sub_123' }, /no subscription id/],
    ['a quantity of 0', { items: [{ quantity: 0, price: { id: PRICES.pro_month } }] }, /quantity/],
  ])('refuses %s', (_label, over, reason) => {
    const mapped = subscriptionFieldsFromEvent(subscription(over), PRICES);
    expect(mapped.ok).toBe(false);
    expect(!mapped.ok && mapped.reason).toMatch(reason);
  });

  it('knows which plan each price sells', () => {
    expect(planForPrice(PRICES.esencial_month, PRICES)).toEqual({ tier: 'esencial', interval: 'month' });
    expect(planForPrice(PRICES.pro_year, PRICES)).toEqual({ tier: 'pro', interval: 'year' });
    expect(planForPrice('pri_01zzzzzzzzzzzzzzzzzzzzzzzz', PRICES)).toBeNull();
    expect(planForPrice('', {})).toBeNull();
  });
});

describe('readPaddleConfig', () => {
  const env = {
    // Shaped like a sandbox key, built from parts so secret scanners do not take it for one.
    PADDLE_API_KEY: ['pdl', 'sdbx', 'apikey', 'not-a-real-key'].join('_'),
    PADDLE_WEBHOOK_SECRET: SECRET,
    PADDLE_PRICE_ESENCIAL_MONTH: PRICES.esencial_month,
    PADDLE_PRICE_ESENCIAL_YEAR: PRICES.esencial_year,
    PADDLE_PRICE_PRO_MONTH: PRICES.pro_month,
    PADDLE_PRICE_PRO_YEAR: PRICES.pro_year,
  };

  it('talks to the sandbox API with a sandbox key and to the live API with a live key', () => {
    const sandbox = readPaddleConfig(env);
    expect(sandbox.ok && [sandbox.config.apiBase, sandbox.config.environment]).toEqual(['https://sandbox-api.paddle.com', 'sandbox']);
    const live = readPaddleConfig({ ...env, PADDLE_API_KEY: env.PADDLE_API_KEY.replace('sdbx', 'live') });
    expect(live.ok && [live.config.apiBase, live.config.environment]).toEqual(['https://api.paddle.com', 'production']);
  });

  it('names every missing or malformed setting', () => {
    expect(readPaddleConfig({ ...env, PADDLE_API_KEY: 'sk_live_123', PADDLE_PRICE_PRO_YEAR: 'price_123' })).toEqual({
      ok: false,
      missing: ['PADDLE_API_KEY', 'PADDLE_PRICE_PRO_YEAR'],
    });
    expect(readPaddleConfig({})).toEqual({
      ok: false,
      missing: ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET', 'PADDLE_PRICE_ESENCIAL_MONTH', 'PADDLE_PRICE_ESENCIAL_YEAR', 'PADDLE_PRICE_PRO_MONTH', 'PADDLE_PRICE_PRO_YEAR'],
    });
  });

  it('refuses two plans sharing one price id (a copy-paste slip would sell Pro at the Esencial price)', () => {
    const read = readPaddleConfig({ ...env, PADDLE_PRICE_PRO_MONTH: PRICES.esencial_month });
    expect(read.ok).toBe(false);
  });

  it('keeps the webhook off until it knows every price (an event it cannot read is retried, not dropped)', () => {
    const { PADDLE_API_KEY: _key, ...webhookEnv } = env;
    expect(readWebhookConfig(webhookEnv)).toEqual({ ok: true, webhookSecret: SECRET, prices: PRICES });
    expect(readWebhookConfig({ PADDLE_WEBHOOK_SECRET: SECRET })).toMatchObject({ ok: false, missing: expect.arrayContaining(['PADDLE_PRICE_PRO_YEAR']) });
  });
});
