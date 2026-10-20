/**
 * Referral codes: create, redeem, list and stats for the signed-in user.
 *
 * Uses the shared fail-closed authentication (server/proxyAuth.ts). The code
 * belongs to the caller's tenant; redemption is a single atomic database
 * statement (public.redeem_referral) so concurrent requests cannot exceed the
 * code's redemption limit.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';

import { authenticate, type AuthContext } from '@/server/proxyAuth';
import { jsonResponse, optionsResponse } from '@/server/http';

export const runtime = 'nodejs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I look-alikes
const CODE_LENGTH = 8;
const CODE_TTL_DAYS = 30;
const CHANNELS = new Set(['link', 'whatsapp', 'email', 'sms', 'qr', 'other']);

type ReferralRow = {
  id: string;
  code: string;
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
  channel: string;
  redemption_count: number;
  max_redemptions: number;
  expires_at: string | null;
  created_at: string;
};

const getServiceClient = (): SupabaseClient | null => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

const generateCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

type Result = { status: number; body: unknown };
const fail = (status: number, error: string): Result => ({ status, body: { error } });

async function handleCreate(db: SupabaseClient, ctx: AuthContext, channel: unknown): Promise<Result> {
  const ch = typeof channel === 'string' && CHANNELS.has(channel) ? channel : 'link';

  // One pending code per referrer and tenant (enforced by the table): reuse it.
  const { data: existing, error: lookupError } = await db
    .from('referrals')
    .select('code, expires_at')
    .eq('account_id', ctx.accountId)
    .eq('referrer_user_id', ctx.userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (lookupError) {
    console.error('[referrals] lookup failed', lookupError.message);
    return fail(500, 'Failed to create referral');
  }
  if (existing && (!existing.expires_at || new Date(existing.expires_at) > new Date())) {
    return { status: 200, body: { referralCode: existing.code } };
  }
  if (existing) {
    await db.from('referrals').update({ status: 'expired' })
      .eq('account_id', ctx.accountId).eq('referrer_user_id', ctx.userId).eq('status', 'pending');
  }

  const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const { error } = await db.from('referrals').insert({
      account_id: ctx.accountId,
      referrer_user_id: ctx.userId,
      code,
      channel: ch,
      expires_at: expiresAt,
    });
    if (!error) return { status: 200, body: { referralCode: code } };
    if (error.code !== '23505') {
      console.error('[referrals] create failed', error.message);
      return fail(500, 'Failed to create referral');
    }
  }
  return fail(503, 'Failed to create referral, please retry');
}

async function handleRedeem(db: SupabaseClient, ctx: AuthContext, code: unknown): Promise<Result> {
  if (typeof code !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(code.trim())) return fail(400, 'Missing or invalid code');
  const { data, error } = await db.rpc('redeem_referral', { p_code: code.trim(), p_user_id: ctx.userId });
  if (error) {
    console.error('[referrals] redeem failed', error.message);
    return fail(500, 'Failed to redeem referral');
  }
  // One message for unknown, expired, exhausted or own codes, so codes can't be probed.
  if (!data) return fail(400, 'This referral code is not valid');
  return { status: 200, body: { success: true, referrerId: data } };
}

async function listOwn(db: SupabaseClient, ctx: AuthContext): Promise<ReferralRow[] | null> {
  const { data, error } = await db
    .from('referrals')
    .select('id, code, status, channel, redemption_count, max_redemptions, expires_at, created_at')
    .eq('account_id', ctx.accountId)
    .eq('referrer_user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[referrals] list failed', error.message);
    return null;
  }
  return data as ReferralRow[];
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const respond = (r: Result) => jsonResponse(r.body, r.status, origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond(fail(400, 'Invalid JSON body'));
  }
  if (typeof body !== 'object' || body === null || typeof (body as { action?: unknown }).action !== 'string') {
    return respond(fail(400, 'Missing action field'));
  }
  const { action, channel, code } = body as { action: string; channel?: unknown; code?: unknown };

  const auth = await authenticate(req);
  if (!auth.ok) return respond(fail(auth.status, auth.error));

  const db = getServiceClient();
  if (!db) {
    console.error('[referrals] Supabase service credentials are not configured');
    return respond(fail(503, 'Database is not configured'));
  }

  switch (action) {
    case 'create':
      return respond(await handleCreate(db, auth.ctx, channel));
    case 'redeem':
      return respond(await handleRedeem(db, auth.ctx, code));
    case 'list': {
      const rows = await listOwn(db, auth.ctx);
      return respond(rows ? { status: 200, body: { referrals: rows } } : fail(500, 'Failed to list referrals'));
    }
    case 'stats': {
      const rows = await listOwn(db, auth.ctx);
      if (!rows) return respond(fail(500, 'Failed to fetch stats'));
      return respond({
        status: 200,
        body: {
          sent: rows.length,
          accepted: rows.reduce((sum, r) => sum + r.redemption_count, 0),
          pending: rows.filter((r) => r.status === 'pending').length,
        },
      });
    }
    default:
      return respond(fail(400, 'Invalid action'));
  }
}

export function OPTIONS(req: Request): Response {
  return optionsResponse(req.headers.get('origin'));
}
