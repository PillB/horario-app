/**
 * The secure proxy's payment actions (manager only, see MANAGER_ACTIONS):
 *
 *   createCheckoutSession       a Paddle transaction for a plan, its quantity
 *                               the account's number of locations, and the
 *                               link to pay it (the app's /pay page with
 *                               Paddle.js, Paddle's "default payment link");
 *   changeSubscription          a paid account moves to another plan, period
 *                               or number of locations, prorated now;
 *   createBillingPortalSession  Paddle's customer portal (card, invoices,
 *                               cancel), a fresh link each time;
 *   cancelSubscription          cancels at the end of the paid period.
 *
 * None of these changes the plan in the database: Paddle answers with a
 * signed webhook (app/api/paddle-webhook+api.ts), and only that writes the
 * subscription. The account id always comes from the session, never from the
 * request body.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { isSubscriptionTier } from '@/constants/pricing';
import {
  BILLING_INTERVALS,
  checkoutCustomData,
  paddleApi,
  priceKey,
  readPaddleConfig,
  type BillingInterval,
  type PaddleAnswer,
  type PaddleConfig,
  type PaidTier,
} from '@/server/paddle';
import type { AuthContext } from '@/server/proxyAuth';

type Result = { status: number; body: unknown };
const ok = (body: unknown): Result => ({ status: 200, body });
const fail = (status: number, error: string): Result => ({ status, body: { error } });

export type BillingDeps = {
  config?: PaddleConfig | null;
  fetchImpl?: typeof fetch;
};

const NOT_SET_UP = 'Online payment is not set up yet. Write to support to change your plan';
const PADDLE_DOWN = 'The payment service did not answer. Nothing was charged. Try again in a minute';

/** Subscription states in which the account already pays through Paddle. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused']);

type BillingRow = {
  status: string | null;
  payment_provider: string | null;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  quantity: number | null;
};

function configFrom(deps: BillingDeps): PaddleConfig | null {
  if (deps.config !== undefined) return deps.config;
  const read = readPaddleConfig();
  if (!read.ok) {
    console.error('[billing] Paddle is not configured; missing:', read.missing.join(', '));
    return null;
  }
  return read.config;
}

async function readBilling(client: SupabaseClient, accountId: string): Promise<{ row: BillingRow | null } | { error: Result }> {
  const { data, error } = await client
    .from('subscriptions')
    .select('status, payment_provider, paddle_customer_id, paddle_subscription_id, quantity')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[billing] read subscription:', error.code ?? '', error.message ?? '');
    return { error: fail(500, 'Database request failed') };
  }
  return { row: (data as BillingRow | null) ?? null };
}

const hasLivePaddle = (row: BillingRow | null): row is BillingRow & { paddle_subscription_id: string } =>
  Boolean(row?.paddle_subscription_id && row.status && LIVE_STATUSES.has(row.status));

async function locationCount(client: SupabaseClient, accountId: string): Promise<number | null> {
  const { count, error } = await client.from('locations').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  return error || typeof count !== 'number' ? null : count;
}

function readPlanChoice(p: Record<string, unknown>): { tier: PaidTier; interval: BillingInterval } | { error: Result } {
  const tier = p.tier;
  if (!isSubscriptionTier(tier) || tier === 'gratis') return { error: fail(400, 'tier must be esencial or pro') };
  const interval = p.billingInterval ?? 'month';
  if (!BILLING_INTERVALS.includes(interval as BillingInterval)) return { error: fail(400, 'billingInterval must be month or year') };
  return { tier, interval: interval as BillingInterval };
}

const paddleFailure = (context: string, answer: Extract<PaddleAnswer<unknown>, { ok: false }>): Result => {
  console.error(`[billing] ${context}:`, answer.status, answer.code ?? '', answer.detail ?? '');
  if (answer.status === 0 || answer.status >= 500) return fail(502, PADDLE_DOWN);
  return fail(502, 'The payment service refused the request. Nothing was charged. Write to support if it happens again');
};

export async function createCheckoutSession(
  client: SupabaseClient,
  ctx: AuthContext,
  p: Record<string, unknown>,
  deps: BillingDeps = {},
): Promise<Result> {
  const choice = readPlanChoice(p);
  if ('error' in choice) return choice.error;
  const config = configFrom(deps);
  if (!config) return fail(501, NOT_SET_UP);

  const billing = await readBilling(client, ctx.accountId);
  if ('error' in billing) return billing.error;
  if (hasLivePaddle(billing.row)) {
    return fail(409, 'This business already has a paid plan. Change it from Plans, or open Manage billing');
  }
  const locations = await locationCount(client, ctx.accountId);
  if (locations === null) return fail(500, 'Database request failed');

  const body: Record<string, unknown> = {
    items: [{ price_id: config.prices[priceKey(choice.tier, choice.interval)], quantity: Math.min(Math.max(1, locations), 1000) }],
    custom_data: checkoutCustomData(ctx.accountId, config.webhookSecret),
  };
  // A returning customer keeps one Paddle customer (and one portal) across subscriptions.
  if (billing.row?.paddle_customer_id) body.customer_id = billing.row.paddle_customer_id;

  const answer = await paddleApi<{ id: string; checkout?: { url?: string | null } | null }>(config, 'POST', '/transactions', body, deps.fetchImpl);
  if (!answer.ok) return paddleFailure('create transaction', answer);
  const checkoutUrl = answer.data.checkout?.url ?? '';
  if (!/^https:\/\//.test(checkoutUrl)) {
    console.error('[billing] transaction has no checkout url; set the default payment link in Paddle > Checkout > Checkout settings');
    return fail(503, 'The payment page is not set up yet. Write to support');
  }
  return ok({ checkoutUrl, transactionId: answer.data.id, quantity: (body.items as { quantity: number }[])[0].quantity });
}

const QUANTITY_MAX = 1000;

/** Why this subscription cannot be changed now, or null. */
function changeRefusal(row: BillingRow | null): Result | null {
  if (!hasLivePaddle(row)) return fail(404, 'This business has no paid plan to change. Choose a plan first');
  // Paddle refuses changes to a past_due subscription; the card must be fixed first.
  if (row.status === 'past_due') return fail(409, 'The last payment failed. Update the card in Manage billing, then change the plan');
  if (row.status === 'paused') return fail(409, 'This plan is paused. Resume it in Manage billing first');
  return null;
}

export async function changeSubscription(
  client: SupabaseClient,
  ctx: AuthContext,
  p: Record<string, unknown>,
  deps: BillingDeps = {},
): Promise<Result> {
  const choice = readPlanChoice(p);
  if ('error' in choice) return choice.error;
  const config = configFrom(deps);
  if (!config) return fail(501, NOT_SET_UP);

  const billing = await readBilling(client, ctx.accountId);
  if ('error' in billing) return billing.error;
  const row = billing.row;
  const refusal = changeRefusal(row);
  if (refusal) return refusal;
  const live = row as BillingRow & { paddle_subscription_id: string };

  const locations = await locationCount(client, ctx.accountId);
  if (locations === null) return fail(500, 'Database request failed');
  const requested = p.quantity ?? Math.max(1, locations, live.quantity ?? 1);
  if (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 1 || requested > QUANTITY_MAX) {
    return fail(400, `quantity must be a whole number from 1 to ${QUANTITY_MAX}`);
  }
  if (requested < locations) {
    return fail(409, `This business has ${locations} locations. Pay for at least ${locations}, or remove a location first`);
  }

  const answer = await paddleApi(config, 'PATCH', `/subscriptions/${live.paddle_subscription_id}`, {
    // Paddle replaces the whole item list: the plan price is the only item.
    items: [{ price_id: config.prices[priceKey(choice.tier, choice.interval)], quantity: requested }],
    // Charge or credit the difference now, so the new plan is paid for from today.
    proration_billing_mode: 'prorated_immediately',
  }, deps.fetchImpl);
  if (!answer.ok) return paddleFailure('update subscription', answer);
  return ok({ success: true, pending: true, quantity: requested });
}

export async function createBillingPortalSession(client: SupabaseClient, ctx: AuthContext, deps: BillingDeps = {}): Promise<Result> {
  const config = configFrom(deps);
  if (!config) return fail(501, NOT_SET_UP);
  const billing = await readBilling(client, ctx.accountId);
  if ('error' in billing) return billing.error;
  const row = billing.row;
  if (!row?.paddle_customer_id) return fail(404, 'This business has not paid for a plan yet, so there is no billing page');

  const answer = await paddleApi<{ urls?: { general?: { overview?: string } } }>(
    config,
    'POST',
    `/customers/${row.paddle_customer_id}/portal-sessions`,
    row.paddle_subscription_id ? { subscription_ids: [row.paddle_subscription_id] } : {},
    deps.fetchImpl,
  );
  if (!answer.ok) return paddleFailure('create portal session', answer);
  const portalUrl = answer.data.urls?.general?.overview ?? '';
  if (!/^https:\/\//.test(portalUrl)) return fail(502, PADDLE_DOWN);
  return ok({ portalUrl });
}

export async function cancelSubscription(client: SupabaseClient, ctx: AuthContext, deps: BillingDeps = {}): Promise<Result> {
  const config = configFrom(deps);
  if (!config) return fail(501, NOT_SET_UP);
  const billing = await readBilling(client, ctx.accountId);
  if ('error' in billing) return billing.error;
  const row = billing.row;
  if (!hasLivePaddle(row)) return fail(404, 'This business has no paid plan to cancel');
  const answer = await paddleApi(
    config,
    'POST',
    `/subscriptions/${row.paddle_subscription_id}/cancel`,
    // A paused subscription can only be canceled immediately (Paddle); it gives no plan anyway.
    { effective_from: row.status === 'paused' ? 'immediately' : 'next_billing_period' },
    deps.fetchImpl,
  );
  if (!answer.ok) return paddleFailure('cancel subscription', answer);
  return ok({ success: true, pending: true });
}
