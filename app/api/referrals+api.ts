import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createPublicKey, createVerify, type JsonWebKey as CryptoJWK } from 'crypto';

// ─── Environment ────────────────────────────────────────────────────────────

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? '';
const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL ?? '';
const AUTH_ENABLED = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

// ─── Types ───────────────────────────────────────────────────────────────────

type JWK = { kid?: string; kty: string; n: string; e: string; alg?: string; use?: string };
type JWKSet = { keys: JWK[] };

type ReferralStatus = 'pending' | 'accepted' | 'expired';

type ReferralRow = {
  id: string;
  referral_code: string;
  referrer_user_id: string;
  referred_user_id: string | null;
  status: ReferralStatus;
  created_at: string;
  accepted_at: string | null;
  account_id: string;
  channel: string;
  max_redemptions: number;
  redemption_count: number;
  expires_at: string;
};

type CreateBody = {
  action: 'create';
  account_id: string;
  channel: string;
};

type RedeemBody = {
  action: 'redeem';
  code: string;
};

type ListBody = {
  action: 'list';
};

type StatsBody = {
  action: 'stats';
};

type RequestBody = CreateBody | RedeemBody | ListBody | StatsBody;

// ─── JWKS cache ──────────────────────────────────────────────────────────────

let jwksCache: JWKSet | null = null;
let jwksCacheExpiry = 0;

async function fetchJwks(): Promise<JWKSet> {
  if (jwksCache && Date.now() < jwksCacheExpiry) return jwksCache;
  const res = await fetch(CLERK_JWKS_URL);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  jwksCache = (await res.json()) as JWKSet;
  jwksCacheExpiry = Date.now() + 5 * 60 * 1000;
  return jwksCache;
}

// ─── Clerk JWT verification ──────────────────────────────────────────────────

async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString(),
    ) as { kid?: string; alg?: string };

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString(),
    ) as { sub?: string; exp?: number };

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    const jwks = await fetchJwks();
    const jwk = header.kid
      ? jwks.keys.find((k) => k.kid === header.kid)
      : jwks.keys[0];
    if (!jwk) return null;

    const publicKey = createPublicKey({ key: jwk as unknown as CryptoJWK, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    const signingInput = `${parts[0]}.${parts[1]}`;
    verifier.update(signingInput);
    const signature = Buffer.from(parts[2], 'base64url');
    const valid = verifier.verify(publicKey, signature);

    if (!valid) return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  if (!AUTH_ENABLED) {
    return process.env.EXPO_PUBLIC_USER_ID ?? 'local-user';
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  return verifyClerkToken(token);
}

// ─── Supabase service-role client (singleton) ────────────────────────────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

// Allowed origins — mirrors the list in secure-proxy+api.ts.
const ALLOWED_ORIGINS = new Set(
  [
    process.env.EXPO_PUBLIC_APP_ORIGIN,
    process.env.EXPO_PUBLIC_SECURE_PROXY_URL
      ? new URL(process.env.EXPO_PUBLIC_SECURE_PROXY_URL).origin
      : undefined,
    'http://localhost:8081',
    'http://localhost:3000',
  ].filter((o): o is string => Boolean(o)),
);

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : 'null';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  // crypto.getRandomValues is available globally in Node.js ≥19 and Vercel Edge.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function json(data: Record<string, unknown>, status = 200, requestOrigin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(requestOrigin) },
  });
}

// ─── Action handlers ─────────────────────────────────────────────────────────

async function handleCreate(
  body: CreateBody,
  userId: string,
  supabase: SupabaseClient,
  origin: string | null,
): Promise<Response> {
  const j = (data: Record<string, unknown>, status = 200) => json(data, status, origin);
  const { account_id, channel } = body;

  if (!account_id || typeof account_id !== 'string') {
    return j({ error: 'Missing or invalid account_id' }, 400);
  }
  if (!channel || typeof channel !== 'string') {
    return j({ error: 'Missing or invalid channel' }, 400);
  }

  const referralCode = generateReferralCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const newRow: Omit<ReferralRow, 'id'> = {
    referral_code: referralCode,
    referrer_user_id: userId,
    referred_user_id: null,
    status: 'pending',
    created_at: now.toISOString(),
    accepted_at: null,
    account_id,
    channel,
    max_redemptions: 5,
    redemption_count: 0,
    expires_at: expiresAt.toISOString(),
  };

  const { error } = await supabase.from('referrals').insert(newRow);

  if (error) {
    console.error('[referrals] create error:', error);
    return j({ error: 'Failed to create referral' }, 500);
  }

  return j({ referralCode });
}

async function handleRedeem(
  body: RedeemBody,
  userId: string,
  supabase: SupabaseClient,
  origin: string | null,
): Promise<Response> {
  const j = (data: Record<string, unknown>, status = 200) => json(data, status, origin);
  const { code } = body;

  if (!code || typeof code !== 'string') {
    return j({ error: 'Missing or invalid code' }, 400);
  }

  const { data: rows, error: fetchError } = await supabase
    .from('referrals')
    .select('*')
    .eq('referral_code', code.toUpperCase())
    .limit(1);

  if (fetchError) {
    console.error('[referrals] redeem fetch error:', fetchError);
    return j({ error: 'Failed to look up referral code' }, 500);
  }

  if (!rows || rows.length === 0) {
    return j({ error: 'Referral code not found' }, 400);
  }

  const row = rows[0] as ReferralRow;

  if (row.status !== 'pending') {
    return j({ error: 'Referral code is no longer active' }, 400);
  }

  const now = new Date();
  if (new Date(row.expires_at) < now) {
    await supabase
      .from('referrals')
      .update({ status: 'expired' })
      .eq('referral_code', code.toUpperCase());
    return j({ error: 'Referral code has expired' }, 400);
  }

  if (row.redemption_count >= row.max_redemptions) {
    return j({ error: 'Referral code has reached its redemption limit' }, 400);
  }

  if (row.referrer_user_id === userId) {
    return j({ error: 'Cannot redeem your own referral code' }, 400);
  }

  const newCount = row.redemption_count + 1;
  const newStatus: ReferralStatus = newCount >= row.max_redemptions ? 'accepted' : 'pending';

  const { error: updateError } = await supabase
    .from('referrals')
    .update({
      referred_user_id: userId,
      accepted_at: now.toISOString(),
      status: newStatus,
      redemption_count: newCount,
    })
    .eq('referral_code', code.toUpperCase());

  if (updateError) {
    console.error('[referrals] redeem update error:', updateError);
    return j({ error: 'Failed to redeem referral' }, 500);
  }

  return j({ success: true, referrerId: row.referrer_user_id });
}

async function handleList(
  userId: string,
  supabase: SupabaseClient,
  origin: string | null,
): Promise<Response> {
  const j = (data: Record<string, unknown>, status = 200) => json(data, status, origin);
  const { data, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[referrals] list error:', error);
    return j({ error: 'Failed to list referrals' }, 500);
  }

  return j({ referrals: data ?? [] });
}

async function handleStats(
  userId: string,
  supabase: SupabaseClient,
  origin: string | null,
): Promise<Response> {
  const j = (data: Record<string, unknown>, status = 200) => json(data, status, origin);
  const { data, error } = await supabase
    .from('referrals')
    .select('status')
    .eq('referrer_user_id', userId);

  if (error) {
    console.error('[referrals] stats error:', error);
    return j({ error: 'Failed to fetch stats' }, 500);
  }

  const rows = (data ?? []) as { status: ReferralStatus }[];

  const stats = rows.reduce(
    (acc, row) => {
      acc.sent += 1;
      if (row.status === 'accepted') acc.accepted += 1;
      if (row.status === 'pending') acc.pending += 1;
      return acc;
    },
    { sent: 0, accepted: 0, pending: 0 },
  );

  return j(stats);
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const j = (data: Record<string, unknown>, status = 200) => json(data, status, origin);

  const userId = await resolveUserId(req);
  if (!userId) {
    return j({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return j({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body !== 'object' || body === null || !('action' in body)) {
    return j({ error: 'Missing action field' }, 400);
  }

  const supabase = getSupabase();
  const typedBody = body as RequestBody;

  switch (typedBody.action) {
    case 'create':
      return handleCreate(typedBody as CreateBody, userId, supabase, origin);
    case 'redeem':
      return handleRedeem(typedBody as RedeemBody, userId, supabase, origin);
    case 'list':
      return handleList(userId, supabase, origin);
    case 'stats':
      return handleStats(userId, supabase, origin);
    default: {
      const _exhaustive: never = typedBody;
      void _exhaustive;
      return j({ error: 'Invalid action' }, 400);
    }
  }
}

export function OPTIONS(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
}