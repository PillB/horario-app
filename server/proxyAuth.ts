/**
 * Request authentication for the server API routes.
 *
 * Verifies Clerk session tokens (RS256, JWKS) and derives the tenant the
 * request acts for. Fails closed: when no verifier is configured, every request
 * is rejected unless the developer explicitly opted into the local-only
 * insecure mode, which is refused in any production build.
 *
 * Tenant = Clerk organization id when the session has an active organization
 * (session token v2 claim `o.id`, v1 claim `org_id`), otherwise the user id.
 * This must match private.current_account_id() in the database migrations.
 *
 * Inside an organization only admins may change scheduling data, locations
 * or billing (`canManage`; the action list is MANAGER_ACTIONS in
 * app/api/secure-proxy+api.ts); a personal account always manages itself.
 */
import { createPublicKey, createVerify, type JsonWebKey as CryptoJWK } from 'crypto';

export type AuthContext = {
  /** Clerk user id (`sub`). */
  userId: string;
  /** Tenant id used for every database read and write. */
  accountId: string;
  /** May change scheduling data, locations and billing: personal accounts and org admins. */
  canManage: boolean;
  /** True only in the explicit local insecure mode. */
  insecureDev: boolean;
};

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; status: 401 | 503; error: string };

const ORG_ADMIN_ROLES = new Set(['admin', 'org:admin']);

type JWK = { kid?: string; kty: string; n: string; e: string; alg?: string; use?: string };
type JWKSet = { keys: JWK[] };

type TokenClaims = {
  sub?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  azp?: string;
  org_id?: string;
  org_role?: string;
  o?: { id?: string; rol?: string };
};

const JWKS_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 5;
const ALLOWED_JWT_ALGORITHMS = new Set(['RS256']);

let jwksCache: { url: string; keys: JWKSet; expiresAt: number } | null = null;

/** Test hook: clears the JWKS cache. */
export function resetJwksCache(): void {
  jwksCache = null;
}

const isProductionBuild = (): boolean => process.env.NODE_ENV === 'production';

/** The live production deployment (Vercel previews are NODE_ENV=production too). */
const isProductionDeployment = (): boolean =>
  process.env.VERCEL_ENV === 'production' || process.env.EXPO_PUBLIC_APP_ENV === 'production';

/**
 * The insecure mode trusts an account id sent by the client. It exists only so
 * a developer can run the app against a local database without Clerk. It is
 * never available in a production build (every Vercel deployment, preview
 * included, runs with NODE_ENV=production).
 */
export const insecureDevAuthEnabled = (): boolean =>
  process.env.HORARIO_INSECURE_DEV_AUTH === '1' && !isProductionBuild();

/** Issuer expected in tokens. Defaults to the JWKS URL's origin (Clerk's layout). */
const expectedIssuer = (jwksUrl: string): string | null => {
  if (process.env.CLERK_ISSUER) return process.env.CLERK_ISSUER.replace(/\/$/, '');
  try {
    return new URL(jwksUrl).origin;
  } catch {
    return null;
  }
};

/** Optional allow-list for the `azp` (authorized party) claim, comma separated. */
const authorizedParties = (): Set<string> | null => {
  const raw = process.env.CLERK_AUTHORIZED_PARTIES;
  if (!raw) return null;
  const parties = raw.split(',').map((p) => p.trim()).filter(Boolean);
  return parties.length ? new Set(parties) : null;
};

async function fetchJwks(url: string): Promise<JWKSet> {
  if (jwksCache && jwksCache.url === url && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed with status ${res.status}`);
  const keys = (await res.json()) as JWKSet;
  jwksCache = { url, keys, expiresAt: Date.now() + JWKS_TTL_MS };
  return keys;
}

const decodeSegment = <T>(segment: string): T =>
  JSON.parse(Buffer.from(segment, 'base64url').toString()) as T;

/** Returns verified claims, or null when the token is invalid for any reason. */
export async function verifyClerkToken(token: string, jwksUrl: string): Promise<TokenClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = decodeSegment<{ kid?: string; alg?: string }>(parts[0]);
    const claims = decodeSegment<TokenClaims>(parts[1]);

    if (!header.alg || !ALLOWED_JWT_ALGORITHMS.has(header.alg)) return null;

    const now = Date.now() / 1000;
    if (!claims.exp || now > claims.exp + CLOCK_SKEW_SECONDS) return null;
    if (claims.nbf && now < claims.nbf - CLOCK_SKEW_SECONDS) return null;
    if (!claims.sub) return null;

    const issuer = expectedIssuer(jwksUrl);
    if (!issuer || claims.iss?.replace(/\/$/, '') !== issuer) return null;

    const parties = authorizedParties();
    if (parties && claims.azp && !parties.has(claims.azp)) return null;

    const jwks = await fetchJwks(jwksUrl);
    // A token without `kid` is only accepted when the key set is unambiguous.
    const jwk = header.kid
      ? jwks.keys.find((k) => k.kid === header.kid)
      : jwks.keys.length === 1 ? jwks.keys[0] : undefined;
    if (!jwk) return null;

    const publicKey = createPublicKey({ key: jwk as unknown as CryptoJWK, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    return verifier.verify(publicKey, parts[2], 'base64url') ? claims : null;
  } catch {
    return null;
  }
}

export const accountIdFromClaims = (claims: TokenClaims): string | null =>
  claims.o?.id || claims.org_id || claims.sub || null;

/** Personal accounts manage themselves; in an organization only admins do. */
export const canManageFromClaims = (claims: TokenClaims): boolean => {
  if (!claims.o?.id && !claims.org_id) return true;
  const role = claims.o?.rol ?? claims.org_role;
  return role !== undefined && ORG_ADMIN_ROLES.has(role);
};

const DEV_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Authenticates a request. In the explicit local insecure mode every request
 * acts as one fixed development tenant (HORARIO_DEV_ACCOUNT_ID, default
 * "dev-account"); nothing the client sends can choose the tenant.
 */
export async function authenticate(request: Request): Promise<AuthResult> {
  const jwksUrl = process.env.CLERK_JWKS_URL;

  if (!jwksUrl) {
    if (insecureDevAuthEnabled()) {
      const configured = process.env.HORARIO_DEV_ACCOUNT_ID;
      const id = configured && DEV_ID_RE.test(configured) ? configured : 'dev-account';
      return { ok: true, ctx: { userId: id, accountId: id, canManage: true, insecureDev: true } };
    }
    console.error('[auth] CLERK_JWKS_URL is not set; refusing request');
    return { ok: false, status: 503, error: 'Authentication is not configured' };
  }
  // In production the azp allow-list is mandatory, so a token minted for
  // another site on the same Clerk instance cannot be replayed here.
  const parties = authorizedParties();
  if (!parties && isProductionDeployment()) {
    console.error('[auth] CLERK_AUTHORIZED_PARTIES is not set in production; refusing request');
    return { ok: false, status: 503, error: 'Authentication is not configured' };
  }

  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Unauthorized' };

  const claims = await verifyClerkToken(header.slice(7), jwksUrl);
  const accountId = claims ? accountIdFromClaims(claims) : null;
  if (!claims?.sub || !accountId) return { ok: false, status: 401, error: 'Unauthorized' };
  // Browser requests carry an Origin and Clerk always sets azp for them; only
  // native clients may omit it.
  if (parties && !claims.azp && request.headers.get('origin')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true, ctx: { userId: claims.sub, accountId, canManage: canManageFromClaims(claims), insecureDev: false } };
}
