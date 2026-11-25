/**
 * Paddle Billing: configuration, webhook signatures, the signed checkout
 * reference, the subscription mapping and a small API client.
 *
 * Paddle is the merchant of record (product research §4): it shows the
 * checkout, charges, collects sales tax / VAT / IGV and pays out. Horario
 * never sees a card. What Horario stores is the mirror of the Paddle
 * subscription (table `subscriptions`), written only by the signed webhook
 * (app/api/paddle-webhook+api.ts); server/plans.ts turns it into the plan.
 *
 * Facts below were read on 2026-11-21 from developer.paddle.com:
 *   - webhooks/about/signature-verification: header `Paddle-Signature:
 *     ts=<unix>;h1=<hex>`, HMAC-SHA256 of `ts + ":" + raw body` with the
 *     destination's secret, more than one h1 during a secret rotation;
 *   - api-reference/about/versioning: `Paddle-Version: 1`;
 *   - api-reference/transactions/create-transaction, customer-portals,
 *     subscriptions (update, cancel), webhooks/subscriptions/subscription-updated.
 */
import { createHmac, timingSafeEqual } from 'crypto';

import { PAID_TIERS, type SubscriptionTier } from '@/constants/pricing';

export type PaidTier = Exclude<SubscriptionTier, 'gratis'>;
export type BillingInterval = 'month' | 'year';
export const BILLING_INTERVALS: BillingInterval[] = ['month', 'year'];

// ─── Configuration ────────────────────────────────────────────────────────────

export type PriceKey = `${PaidTier}_${BillingInterval}`;

export const PRICE_ENV: Record<PriceKey, string> = {
  esencial_month: 'PADDLE_PRICE_ESENCIAL_MONTH',
  esencial_year: 'PADDLE_PRICE_ESENCIAL_YEAR',
  pro_month: 'PADDLE_PRICE_PRO_MONTH',
  pro_year: 'PADDLE_PRICE_PRO_YEAR',
};

export type PaddleConfig = {
  apiKey: string;
  apiBase: string;
  environment: 'sandbox' | 'production';
  webhookSecret: string;
  prices: Record<PriceKey, string>;
};

const PRICE_ID = /^pri_[a-z0-9]{26}$/;

/**
 * The server's Paddle settings, or the names of what is missing. The API base
 * follows the key (`pdl_sdbx_` = sandbox), so a sandbox key never talks to the
 * live API by mistake.
 */
/** Reads the four price ids, naming each one that is missing or malformed. */
function readPrices(env: Record<string, string | undefined>, missing: string[]): Record<PriceKey, string> {
  const prices = {} as Record<PriceKey, string>;
  for (const [key, name] of Object.entries(PRICE_ENV) as [PriceKey, string][]) {
    const value = env[name]?.trim() ?? '';
    if (!PRICE_ID.test(value)) missing.push(name);
    prices[key] = value;
  }
  return prices;
}

export function readPaddleConfig(env: Record<string, string | undefined> = process.env):
  | { ok: true; config: PaddleConfig }
  | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const apiKey = env.PADDLE_API_KEY?.trim() ?? '';
  const webhookSecret = env.PADDLE_WEBHOOK_SECRET?.trim() ?? '';
  if (!/^pdl_(sdbx|live)_apikey_/.test(apiKey)) missing.push('PADDLE_API_KEY');
  if (!webhookSecret) missing.push('PADDLE_WEBHOOK_SECRET');
  const prices = readPrices(env, missing);
  if (missing.length === 0 && new Set(Object.values(prices)).size !== Object.keys(prices).length) {
    missing.push('PADDLE_PRICE_* (two plans share one price id)');
  }
  if (missing.length) return { ok: false, missing };
  const sandbox = apiKey.startsWith('pdl_sdbx_');
  return {
    ok: true,
    config: {
      apiKey,
      apiBase: sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com',
      environment: sandbox ? 'sandbox' : 'production',
      webhookSecret,
      prices,
    },
  };
}

/**
 * The webhook needs its secret and the whole price list: without the prices
 * it cannot tell which plan was bought, and recording the event as "not
 * ours" would lose it, so a missing price is a 503 and Paddle retries.
 */
export function readWebhookConfig(env: Record<string, string | undefined> = process.env):
  | { ok: true; webhookSecret: string; prices: Record<PriceKey, string> }
  | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const webhookSecret = env.PADDLE_WEBHOOK_SECRET?.trim() ?? '';
  if (!webhookSecret) missing.push('PADDLE_WEBHOOK_SECRET');
  const prices = readPrices(env, missing);
  return missing.length ? { ok: false, missing } : { ok: true, webhookSecret, prices };
}

export const priceKey = (tier: PaidTier, interval: BillingInterval): PriceKey => `${tier}_${interval}`;

/** Which plan and period a price id sells, or null for a price that is not Horario's. */
export function planForPrice(
  priceId: unknown,
  prices: Partial<Record<PriceKey, string>>,
): { tier: PaidTier; interval: BillingInterval } | null {
  if (typeof priceId !== 'string' || !priceId) return null;
  for (const tier of PAID_TIERS) {
    for (const interval of BILLING_INTERVALS) {
      if (prices[priceKey(tier, interval)] === priceId) return { tier, interval };
    }
  }
  return null;
}

// ─── Webhook signature ────────────────────────────────────────────────────────

/**
 * How old a signed notification may be. Paddle's SDKs default to 5 s; a cold
 * serverless start can take longer than that, and a rejected delivery is only
 * retried 3 times in the sandbox. Replays inside the window do no harm: every
 * event is applied once (paddle_events, keyed by event id) and an event older
 * than the one applied is ignored.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 60;

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

export function verifyPaddleSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing Paddle-Signature header' };
  let ts: string | null = null;
  const h1: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') h1.push(value);
  }
  if (!ts || !/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'no timestamp in Paddle-Signature' };
  if (h1.length === 0) return { ok: false, reason: 'no h1 signature in Paddle-Signature' };
  const timestamp = Number(ts);
  const age = nowMs / 1000 - timestamp;
  if (age > toleranceSeconds) return { ok: false, reason: `signature is ${Math.round(age)} s old (limit ${toleranceSeconds} s)` };
  if (age < -toleranceSeconds) return { ok: false, reason: 'signature timestamp is in the future' };

  const expected = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest();
  const matches = h1.some((candidate) => {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
    return timingSafeEqual(Buffer.from(candidate, 'hex'), expected);
  });
  return matches ? { ok: true, timestamp } : { ok: false, reason: 'signature does not match' };
}

// ─── Signed checkout reference ────────────────────────────────────────────────

/**
 * Anyone with the public client-side token can open a Paddle checkout for
 * Horario's prices with any custom data. The account a payment belongs to is
 * therefore taken only from a reference the server signed when it created the
 * checkout: `horario_account` plus an HMAC of it. Paddle copies a
 * transaction's custom data to the subscription it creates.
 */
const REF_LABEL = 'horario-checkout-v1:';

export const signAccountRef = (accountId: string, secret: string): string =>
  createHmac('sha256', secret).update(REF_LABEL + accountId).digest('hex');

export function checkoutCustomData(accountId: string, secret: string): Record<string, string> {
  return { horario_account: accountId, horario_ref: signAccountRef(accountId, secret) };
}

/** The account a signed reference names, or null (absent, or not signed by us). */
export function accountFromCustomData(customData: unknown, secret: string): string | null {
  if (typeof customData !== 'object' || customData === null) return null;
  const { horario_account: account, horario_ref: ref } = customData as Record<string, unknown>;
  if (typeof account !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(account)) return null;
  if (typeof ref !== 'string' || !/^[0-9a-f]{64}$/.test(ref)) return null;
  const expected = Buffer.from(signAccountRef(account, secret), 'hex');
  return timingSafeEqual(Buffer.from(ref, 'hex'), expected) ? account : null;
}

// ─── Subscription mapping ─────────────────────────────────────────────────────

export type StoredStatus = 'active' | 'trialing' | 'past_due' | 'paused' | 'cancelled';

const STATUS: Record<string, StoredStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'cancelled',
};

/** The `subscriptions` columns apply_paddle_subscription() writes. */
export type SubscriptionFields = {
  paddle_subscription_id: string;
  paddle_customer_id: string | null;
  paddle_price_id: string;
  tier: PaidTier;
  status: StoredStatus;
  quantity: number;
  billing_interval: BillingInterval;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTimestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

type PlanItem = { tier: PaidTier; interval: BillingInterval; priceId: string; quantity: number };

/**
 * The subscription's Horario plan item. Horario sells one plan price per
 * subscription; other items (none today) are ignored, and of two plan items
 * the larger quantity wins.
 */
function planItemOf(items: unknown, prices: Partial<Record<PriceKey, string>>): PlanItem | string {
  let match: PlanItem | null = null;
  for (const item of Array.isArray(items) ? items.filter(isRecord) : []) {
    const price = isRecord(item.price) ? item.price : {};
    const plan = planForPrice(price.id, prices);
    if (!plan) continue;
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return 'quantity out of range';
    if (!match || quantity > match.quantity) match = { ...plan, priceId: price.id as string, quantity };
  }
  return match ?? 'no Horario plan price on the subscription';
}

const timestampAt = (value: unknown, key: string): string | null =>
  isRecord(value) && isTimestamp(value[key]) ? (value[key] as string) : null;

/** Pure: a Paddle subscription entity (webhook `data`) as Horario stores it. */
export function subscriptionFieldsFromEvent(
  data: unknown,
  prices: Partial<Record<PriceKey, string>>,
): { ok: true; fields: SubscriptionFields } | { ok: false; reason: string } {
  if (!isRecord(data)) return { ok: false, reason: 'event data is not an object' };
  const id = data.id;
  if (typeof id !== 'string' || !/^sub_[a-z0-9]{26}$/.test(id)) return { ok: false, reason: 'no subscription id' };
  const status = typeof data.status === 'string' ? STATUS[data.status] : undefined;
  if (!status) return { ok: false, reason: `unknown status ${String(data.status)}` };
  const item = planItemOf(data.items, prices);
  if (typeof item === 'string') return { ok: false, reason: item };

  const interval = isRecord(data.billing_cycle) ? data.billing_cycle.interval : undefined;
  const customer = typeof data.customer_id === 'string' && /^ctm_[a-z0-9]{26}$/.test(data.customer_id) ? data.customer_id : null;
  return {
    ok: true,
    fields: {
      paddle_subscription_id: id,
      paddle_customer_id: customer,
      paddle_price_id: item.priceId,
      tier: item.tier,
      status,
      quantity: item.quantity,
      billing_interval: interval === 'year' || interval === 'month' ? interval : item.interval,
      current_period_start: timestampAt(data.current_billing_period, 'starts_at'),
      current_period_end: timestampAt(data.current_billing_period, 'ends_at'),
      cancel_at_period_end: isRecord(data.scheduled_change) && data.scheduled_change.action === 'cancel',
    },
  };
}

// ─── API client ───────────────────────────────────────────────────────────────

const PADDLE_TIMEOUT_MS = 10_000;

export type PaddleAnswer<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; detail: string | null };

/** One Paddle API request. Errors are returned (and logged by the caller), never thrown. */
export async function paddleApi<T>(
  config: Pick<PaddleConfig, 'apiKey' | 'apiBase'>,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<PaddleAnswer<T>> {
  try {
    const res = await fetchImpl(`${config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Paddle-Version': '1',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PADDLE_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; detail?: string } } | null;
    if (!res.ok || !json || json.data === undefined) {
      return { ok: false, status: res.status, code: json?.error?.code ?? null, detail: json?.error?.detail ?? null };
    }
    return { ok: true, data: json.data };
  } catch (error) {
    return { ok: false, status: 0, code: 'network', detail: error instanceof Error ? error.message : String(error) };
  }
}
