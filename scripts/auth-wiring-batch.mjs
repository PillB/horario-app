/**
 * auth-wiring-batch.mjs
 *
 * Uses the Anthropic Batch API (claude-sonnet-4-6, ~50% off) to generate
 * all code changes needed to wire Clerk authentication end-to-end:
 *
 *  1. services/authToken.ts          (NEW) — module-level session token provider
 *  2. contexts/IdentityContext.tsx   (UPDATE) — wire setTokenProvider on auth resolve
 *  3. services/rosterService.ts      (UPDATE) — add Authorization header to proxyPost
 *  4. services/demandForecast.ts     (UPDATE) — same for handleSecureFetch
 *  5. services/onboardingProgress.ts (UPDATE) — same for upsertOnboardingProgress
 *  6. services/usageService.ts       (UPDATE) — same for proxyPost
 *  7. app/api/secure-proxy+api.ts    (UPDATE) — JWT verification + accountId override
 *
 * Security model:
 *   - Client attaches `Authorization: Bearer <clerk_token>` to every proxy request
 *   - Proxy verifies the Clerk JWT using Node.js built-in crypto + JWKS (no new deps)
 *   - Proxy extracts `sub` from verified JWT → uses as authoritative accountId
 *   - Dev-bypass mode (no Clerk key): skips verification, trusts body accountId as before
 *
 * Usage:
 *   node --env-file=.env.local scripts/auth-wiring-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Source files ─────────────────────────────────────────────────────────────

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const IDENTITY_CTX      = read('contexts/IdentityContext.tsx');
const ROSTER_SERVICE    = read('services/rosterService.ts');
const DEMAND_SERVICE    = read('services/demandForecast.ts');
const ONBOARDING_SVC    = read('services/onboardingProgress.ts');
const USAGE_SVC         = read('services/usageService.ts');

// Proxy is large (~918 lines) — provide in two reads
const proxyPart1 = read('app/api/secure-proxy+api.ts').slice(0, 20000);
const proxyPart2 = read('app/api/secure-proxy+api.ts').slice(20000);

// ── Shared system prompt ──────────────────────────────────────────────────────

const SYSTEM = `You are a senior TypeScript / React Native / Expo engineer.
Output ONLY valid TypeScript file content — no markdown fences, no commentary outside the code.
Follow these rules strictly:
1. TypeScript strict mode — no 'any' without explicit cast, no implicit any.
2. No new npm dependencies — use only what is already imported or Node.js built-ins.
3. Preserve all existing functionality and types exactly.
4. Minimal diff: change only what the task requires, nothing more.
5. Output the COMPLETE file, not a diff or partial snippet.
6. Start your response with the first line of code (import / comment / export).`;

// ── Request definitions ───────────────────────────────────────────────────────

const requests = [

  // ── 1. NEW: services/authToken.ts ────────────────────────────────────────
  {
    custom_id: 'AUTH_TOKEN_SERVICE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Create a new file \`services/authToken.ts\`.

Purpose: module-level session token provider so service files (non-React) can
attach a Clerk session token to outbound requests without importing React hooks.

Requirements:
- Export \`AUTH_ENABLED: boolean\` = true when EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY starts with 'pk_'
- Export \`setTokenProvider(fn: () => Promise<string | null>): void\`
  Stores the provider function in module scope.
- Export \`getSessionToken(): Promise<string | null>\`
  Calls the stored provider; returns null if no provider is set (dev bypass).
- No React imports; pure TypeScript module.
- JSDoc comments on each export explaining purpose.`
      }],
    },
  },

  // ── 2. UPDATE: contexts/IdentityContext.tsx ───────────────────────────────
  {
    custom_id: 'IDENTITY_CTX_UPDATE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Update \`contexts/IdentityContext.tsx\` to wire the auth token provider.

Current source:
\`\`\`tsx
${IDENTITY_CTX}
\`\`\`

Changes required:
1. Import \`setTokenProvider\` from \`@/services/authToken\`.
2. Import \`useEffect\` from \`react\` (add to existing React import if present).
3. Inside \`ClerkIdentityProvider\`, after \`const { userId, isLoaded, getToken } = useAuth();\`,
   add a useEffect that calls \`setTokenProvider(getToken)\` whenever \`getToken\` changes:
   \`\`\`tsx
   useEffect(() => {
     setTokenProvider(getToken);
   }, [getToken]);
   \`\`\`
4. No other changes — preserve all existing logic exactly.

Output the complete updated file.`
      }],
    },
  },

  // ── 3. UPDATE: services/rosterService.ts ─────────────────────────────────
  {
    custom_id: 'ROSTER_SERVICE_UPDATE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Update \`services/rosterService.ts\` to attach the Clerk session token.

Current \`proxyPost\` function:
\`\`\`ts
const proxyPost = async <T>(body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Service unavailable. Please check your connection or run database migrations.');
    }
    const payload = await response.json().catch(() => ({ error: \`Server error (\${response.status})\` }));
    throw new Error((payload as { error?: string }).error ?? \`Proxy responded with \${response.status}\`);
  }

  return (await response.json()) as T;
};
\`\`\`

Changes required:
1. Add import: \`import { getSessionToken } from '@/services/authToken';\`
2. Make \`proxyPost\` async (it already is).
3. Before the fetch call, get the token:
   \`const token = await getSessionToken();\`
4. Build headers object:
   \`\`\`ts
   const headers: Record<string, string> = { 'Content-Type': 'application/json' };
   if (token) headers['Authorization'] = \`Bearer \${token}\`;
   \`\`\`
5. Use \`headers\` in the fetch call instead of the inline headers object.
6. No other changes to the file.

The full current file content:
\`\`\`ts
${ROSTER_SERVICE}
\`\`\`

Output the complete updated file.`
      }],
    },
  },

  // ── 4. UPDATE: services/demandForecast.ts ────────────────────────────────
  {
    custom_id: 'DEMAND_FORECAST_UPDATE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 3072,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Update \`services/demandForecast.ts\` to attach the Clerk session token.

Current \`handleSecureFetch\` function:
\`\`\`ts
const handleSecureFetch = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error?.error ?? \`Secure proxy responded with status \${response.status}\`);
  }
  return (await response.json()) as T;
};
\`\`\`

Changes required:
1. Add import: \`import { getSessionToken } from '@/services/authToken';\`
2. In \`handleSecureFetch\`, before the fetch:
   \`const token = await getSessionToken();\`
3. Build headers object and include Authorization if token present.
4. No other changes.

Full current file:
\`\`\`ts
${DEMAND_SERVICE}
\`\`\`

Output the complete updated file.`
      }],
    },
  },

  // ── 5. UPDATE: services/onboardingProgress.ts ────────────────────────────
  {
    custom_id: 'ONBOARDING_UPDATE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Update \`services/onboardingProgress.ts\` to attach the Clerk session token.

Changes required:
1. Add import: \`import { getSessionToken } from '@/services/authToken';\`
2. In \`upsertOnboardingProgress\`, before the fetch call, get the token and add
   \`Authorization: Bearer <token>\` header if token is present.
3. No other changes.

Full current file:
\`\`\`ts
${ONBOARDING_SVC}
\`\`\`

Output the complete updated file.`
      }],
    },
  },

  // ── 6. UPDATE: services/usageService.ts ──────────────────────────────────
  {
    custom_id: 'USAGE_SERVICE_UPDATE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Update \`services/usageService.ts\` to attach the Clerk session token.

Changes required:
1. Add import: \`import { getSessionToken } from '@/services/authToken';\`
2. In \`proxyPost\`, get the token and add Authorization header if present.
3. No other changes.

Full current file:
\`\`\`ts
${USAGE_SVC}
\`\`\`

Output the complete updated file.`
      }],
    },
  },

  // ── 7. UPDATE: app/api/secure-proxy+api.ts ───────────────────────────────
  {
    custom_id: 'PROXY_JWT_VERIFY',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Update \`app/api/secure-proxy+api.ts\` to verify Clerk JWTs and enforce account isolation.

## Security requirements
1. Use Node.js built-in \`crypto\` module only (no new npm dependencies).
2. Verify the Clerk JWT from the Authorization header using JWKS fetched from
   \`process.env.CLERK_JWKS_URL\`.
3. Auth enforcement is conditional: only when
   \`(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_')\`
4. When auth is enabled and token is missing/invalid → return 401.
5. When auth is enabled and token is valid → use JWT \`sub\` claim as the
   authoritative \`accountId\` for ALL Supabase operations.
6. When auth is disabled (dev bypass) → behaviour unchanged.

## JWKS verification implementation
Add at module top-level (after existing imports):

\`\`\`ts
import { createPublicKey, createVerify } from 'crypto';

const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL;
const AUTH_ENABLED = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

type JWK = { kid?: string; kty: string; n: string; e: string; alg?: string; use?: string };
type JWKSet = { keys: JWK[] };

let jwksCache: JWKSet | null = null;
let jwksCacheExpiry = 0;

async function fetchJwks(): Promise<JWKSet> {
  if (jwksCache && Date.now() < jwksCacheExpiry) return jwksCache;
  const res = await fetch(CLERK_JWKS_URL!);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  jwksCache = (await res.json()) as JWKSet;
  jwksCacheExpiry = Date.now() + 5 * 60 * 1000; // 5 min
  return jwksCache;
}

async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { kid?: string; alg?: string };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { sub?: string; exp?: number };
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    const jwks = await fetchJwks();
    const jwk = (header.kid ? jwks.keys.find(k => k.kid === header.kid) : jwks.keys[0]);
    if (!jwk) return null;
    const publicKey = createPublicKey({ key: jwk as Parameters<typeof createPublicKey>[0], format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(\`\${parts[0]}.\${parts[1]}\`);
    const valid = verifier.verify(publicKey, parts[2], 'base64url');
    return valid ? (payload.sub ?? null) : null;
  } catch {
    return null;
  }
}

async function getAuthorizedAccountId(request: Request): Promise<string | null> {
  if (!AUTH_ENABLED) return null;
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyClerkToken(auth.slice(7));
}
\`\`\`

## POST handler changes
At the top of the POST handler, BEFORE parsing the JSON body, add:

\`\`\`ts
const authorizedAccountId = await getAuthorizedAccountId(request);
if (AUTH_ENABLED && !authorizedAccountId) {
  return buildErrorResponse('Unauthorized', 401);
}
\`\`\`

Then add a helper (after the existing \`jsonOk\` helper):
\`\`\`ts
// When auth is enabled, authorizedAccountId is the verified JWT sub.
// When disabled (dev), fall back to the account ID from the request body.
const resolveAccountId = (authorizedId: string | null, bodyId: string): string =>
  authorizedId ?? bodyId;
\`\`\`

## Switch case changes
Apply \`resolveAccountId\` everywhere \`accountId\` comes from the request body:

- \`case 'upsertOnboarding'\`: use \`resolveAccountId(authorizedAccountId, payload.accountId)\` as accountId arg
- \`case 'listWorkers'\`: use \`resolveAccountId(authorizedAccountId, payload.accountId)\`
- \`case 'upsertWorker'\`: override worker.accountId: spread worker object then set accountId:
  \`{ ...payload.worker, accountId: resolveAccountId(authorizedAccountId, (payload.worker as Record<string,unknown>).accountId as string) }\`
- \`case 'listWorkerAvailability'\`: resolveAccountId
- \`case 'upsertAvailability'\`: override availability.accountId same as upsertWorker pattern
- \`case 'listShiftTemplates'\`: resolveAccountId
- \`case 'upsertShiftTemplate'\`: override template.accountId
- \`case 'listRoster'\`: resolveAccountId
- \`case 'upsertRosterShift'\`: override shift.accountId
- \`case 'getUsageLimit'\`: resolveAccountId for accountId; for userId also use resolveAccountId(authorizedAccountId, payload.userId)
- \`case 'incrementAutoAssign'\`: same as getUsageLimit

Note: deleteWorker, deleteAvailability, deleteShiftTemplate, deleteRosterShift, updateShiftStatus, markShiftNotified
work by row ID — no accountId in body. Leave those unchanged.

## IMPORTANT
- The request object is consumed by \`getAuthorizedAccountId\` (reads headers only, not body).
  The body can still be parsed normally afterwards with \`request.json()\`.
- Preserve ALL existing functionality, types, validators, and helper functions exactly.
- Only add the JWT verification code and apply resolveAccountId — nothing else.

## Current file (part 1, chars 0-20000):
\`\`\`ts
${proxyPart1}
\`\`\`

## Current file (part 2, chars 20000+):
\`\`\`ts
${proxyPart2}
\`\`\`

Output the COMPLETE updated file.`
      }],
    },
  },

];

// ── Run batch ─────────────────────────────────────────────────────────────────

function stripFences(text) {
  return text.replace(/^```[^\n]*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
}

async function poll(batchId) {
  process.stdout.write('Polling');
  while (true) {
    const b = await client.messages.batches.retrieve(batchId);
    if (b.processing_status === 'ended') { console.log(' done.'); return b; }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 6000));
  }
}

const OUTPUT_MAP = {
  AUTH_TOKEN_SERVICE:     'services/authToken.ts',
  IDENTITY_CTX_UPDATE:    'contexts/IdentityContext.tsx',
  ROSTER_SERVICE_UPDATE:  'services/rosterService.ts',
  DEMAND_FORECAST_UPDATE: 'services/demandForecast.ts',
  ONBOARDING_UPDATE:      'services/onboardingProgress.ts',
  USAGE_SERVICE_UPDATE:   'services/usageService.ts',
  PROXY_JWT_VERIFY:       'app/api/secure-proxy+api.ts',
};

async function main() {
  console.log(`Creating auth-wiring batch (${requests.length} requests, claude-sonnet-4-6)…`);

  const batch = await client.messages.batches.create({ requests });
  console.log(`Batch ID: ${batch.id}`);

  await poll(batch.id);

  const results = {};
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type !== 'succeeded') {
      console.error(`FAILED: ${result.custom_id}`, result.result);
      continue;
    }
    const text = result.result.message.content
      .filter(b => b.type === 'text').map(b => b.text).join('');
    results[result.custom_id] = stripFences(text);
  }

  // Write files
  let written = 0;
  for (const [id, relPath] of Object.entries(OUTPUT_MAP)) {
    if (!results[id]) {
      console.error(`Missing result for ${id}`);
      continue;
    }
    const fullPath = path.join(ROOT, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, results[id] + '\n');
    console.log(`✓ ${relPath}`);
    written++;
  }

  // Save raw results for debugging
  fs.writeFileSync(
    path.join(__dirname, 'auth-wiring-results.json'),
    JSON.stringify({ batchId: batch.id, results }, null, 2)
  );

  console.log(`\n${written}/${requests.length} files written.`);
  console.log('Next: npm test && npm run lint');
}

main().catch(err => { console.error(err); process.exit(1); });
