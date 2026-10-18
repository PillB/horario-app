/**
 * Test helpers: an RSA key pair, its JWKS, and a signer for Clerk-shaped
 * session tokens. Used by the proxy unit and integration tests.
 */
import { createSign, generateKeyPairSync } from 'crypto';

export const TEST_ISSUER = 'https://clerk.horario.test';
export const TEST_JWKS_URL = `${TEST_ISSUER}/.well-known/jwks.json`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

export const TEST_JWKS = {
  keys: [{ ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'test-key', alg: 'RS256', use: 'sig' }],
};

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

type SignOptions = {
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  /** Sign with a key that is not in the JWKS. */
  foreignKey?: boolean;
};

export function signToken(sub: string, { claims = {}, header = {}, foreignKey = false }: SignOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'test-key', ...header });
  const body = b64({ sub, iss: TEST_ISSUER, iat: now, nbf: now - 1, exp: now + 300, ...claims });
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  const signature = signer.sign(foreignKey ? otherPair.privateKey : privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

/** Wraps fetch so the test JWKS URL is served locally and everything else passes through. */
export function installJwksFetch(): jest.SpyInstance {
  const realFetch = global.fetch;
  return jest.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === TEST_JWKS_URL) {
      return Promise.resolve(new Response(JSON.stringify(TEST_JWKS), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  });
}
