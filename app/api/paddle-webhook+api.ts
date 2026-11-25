/**
 * Paddle webhook: the only writer of paid plans.
 *
 * 1. The raw body is checked against the `Paddle-Signature` header with the
 *    destination's secret (server/paddle.ts). Anything unsigned is a 401.
 * 2. Subscription events are mapped to the account's `subscriptions` row and
 *    applied by apply_paddle_subscription() (migration 20261122000107): once
 *    per event id, older-than-applied events ignored, one change per account
 *    at a time. The account comes from the checkout reference the server
 *    signed, or from the subscription id already linked.
 * 3. Other events are recorded (paddle_events) and change nothing.
 *
 * Answers: 200 when the event is handled or deliberately ignored (Paddle must
 * not retry it), 5xx when it could not be stored (Paddle retries: up to 60
 * times over about two days in live), 401 for a bad signature.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { getServiceClient } from '@/server/serviceClient';
import { accountFromCustomData, readWebhookConfig, subscriptionFieldsFromEvent, verifyPaddleSignature } from '@/server/paddle';

export const runtime = 'nodejs';

/** Paddle's notifications are a few kilobytes; anything far bigger is not one. */
const MAX_BODY_BYTES = 512 * 1024;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

type Envelope = { event_id: string; event_type: string; occurred_at: string; data: Record<string, unknown> };

function readEnvelope(value: unknown): Envelope | null {
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.event_id !== 'string' || !/^evt_[a-z0-9]{26}$/.test(e.event_id)) return null;
  if (typeof e.event_type !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(e.event_type)) return null;
  if (typeof e.occurred_at !== 'string' || !Number.isFinite(Date.parse(e.occurred_at))) return null;
  if (typeof e.data !== 'object' || e.data === null || Array.isArray(e.data)) return null;
  return e as unknown as Envelope;
}

type WebhookConfig = Extract<ReturnType<typeof readWebhookConfig>, { ok: true }>;

/** The verified, parsed notification, or the answer to send. */
async function readSignedEvent(request: Request, secret: string): Promise<{ event: Envelope; parsed: unknown } | Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return reply(413, { error: 'Too large' });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'Too large' });
  const signature = verifyPaddleSignature(request.headers.get('paddle-signature'), raw, secret);
  if (!signature.ok) {
    console.error('[paddle-webhook] refused:', signature.reason);
    return reply(401, { error: 'Invalid signature' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }
  const event = readEnvelope(parsed);
  return event ? { event, parsed } : reply(400, { error: 'Not a Paddle notification' });
}

/** The account the event's custom data names with a valid server signature, or null. */
function signedAccountOf(event: Envelope, secret: string): string | null {
  const account = accountFromCustomData(event.data.custom_data, secret);
  const named = typeof event.data.custom_data === 'object' && event.data.custom_data !== null
    ? (event.data.custom_data as Record<string, unknown>).horario_account
    : undefined;
  if (!account && named !== undefined) {
    console.error('[paddle-webhook] custom data names an account without a valid signature:', event.event_id);
  }
  return account;
}

/** Applies a subscription event; null when it is not a Horario plan (then it is only recorded). */
async function applySubscription(
  client: SupabaseClient,
  config: WebhookConfig,
  event: Envelope,
  parsed: unknown,
  account: string | null,
): Promise<Response | null> {
  const mapped = subscriptionFieldsFromEvent(event.data, config.prices);
  if (!mapped.ok) {
    console.error(`[paddle-webhook] ${event.event_type} ${event.event_id} not applied: ${mapped.reason}`);
    return null;
  }
  const { data, error } = await client.rpc('apply_paddle_subscription', {
    p_event_id: event.event_id,
    p_event_type: event.event_type,
    p_occurred_at: event.occurred_at,
    p_payload: parsed,
    p_account_id: account,
    p_fields: mapped.fields,
  });
  if (error) {
    console.error('[paddle-webhook] apply_paddle_subscription:', error.code ?? '', error.message ?? '');
    return reply(500, { error: 'Could not store the event' });
  }
  const outcome = (data as { outcome?: string } | null)?.outcome ?? 'unknown';
  if (outcome === 'unmatched' || outcome === 'second_subscription') {
    // Needs a person: a payment with no account, or a business paying twice (refund one in Paddle).
    console.error(`[paddle-webhook] ${outcome}: event ${event.event_id}, subscription ${mapped.fields.paddle_subscription_id}`);
  }
  return reply(200, { ok: true, outcome });
}

export async function POST(request: Request): Promise<Response> {
  const config = readWebhookConfig();
  if (!config.ok) {
    console.error('[paddle-webhook] not configured; missing:', config.missing.join(', '));
    return reply(503, { error: 'Payments are not configured' });
  }
  const read = await readSignedEvent(request, config.webhookSecret);
  if (read instanceof Response) return read;
  const { event, parsed } = read;

  const client = getServiceClient();
  if (!client) {
    console.error('[paddle-webhook] Supabase service credentials are not configured');
    return reply(503, { error: 'Database is not configured' });
  }
  const account = signedAccountOf(event, config.webhookSecret);

  if (event.event_type.startsWith('subscription.')) {
    const applied = await applySubscription(client, config, event, parsed, account);
    if (applied) return applied;
  }

  const { error } = await client.rpc('record_paddle_event', {
    p_event_id: event.event_id,
    p_event_type: event.event_type,
    p_occurred_at: event.occurred_at,
    p_payload: parsed,
    p_account_id: account,
  });
  if (error) {
    console.error('[paddle-webhook] record_paddle_event:', error.code ?? '', error.message ?? '');
    return reply(500, { error: 'Could not store the event' });
  }
  return reply(200, { ok: true, outcome: 'recorded' });
}
