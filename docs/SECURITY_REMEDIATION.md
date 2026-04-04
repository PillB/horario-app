# Security Remediation Manual — horario-app

> Generated after security review on 2026-04-03.
> Work through each section in order. Mark each checkbox when done.
> Do NOT commit this file with unchecked boxes in Critical or High sections.

---

## SECTION 1 — CRITICAL: Exposed Secrets in Git History

### Finding
`.env.local` was committed to the repo. It contains real production credentials:
- `ANTHROPIC_API_KEY`
- `CLERK_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `CLERK_JWKS_URL`
- `EXPO_PUBLIC_SUPABASE_URL`

Because these are in git history, rotating keys and deleting the file is not enough on its own — anyone who cloned the repo before the purge already has them.

---

### Step 1.1 — Rotate every exposed secret immediately

Do this BEFORE purging history. Rotating first limits the window of exposure.

**Anthropic API key:**
1. Go to console.anthropic.com → API Keys
2. Delete the exposed key (`sk-ant-api03-...`)
3. Create a new key and save it securely (password manager or secrets vault)

**Clerk keys:**
1. Go to dashboard.clerk.com → your application
2. Navigate to API Keys
3. The Clerk Publishable Key (`pk_test_...`) cannot be "rotated" directly — it is tied to the instance. To invalidate it you must create a new Clerk application or contact Clerk support.
4. The Clerk Secret Key (`sk_test_...`): go to API Keys → roll/regenerate the secret key
5. Update `CLERK_SECRET_KEY` in your deployment environment (Vercel, Railway, etc.) immediately after regenerating

**Supabase:**
1. Go to app.supabase.com → your project → Settings → API
2. Click "Reveal" next to `service_role` key, then click "Reset" (or "Roll")
3. Confirm — this will invalidate the old key
4. Also reset the `anon` key if you want to be thorough
5. Update both keys in your deployment environment

**Verify rotation worked:**
```bash
# Test that the old service role key no longer works
curl -X GET "https://<your-project>.supabase.co/rest/v1/workers?limit=1" \
  -H "apikey: <OLD_SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <OLD_SERVICE_ROLE_KEY>"
# Expected: 401 Unauthorized
```

- [ ] Anthropic key rotated
- [ ] Clerk secret key rotated, deployment env updated
- [ ] Supabase service role key rotated, deployment env updated
- [ ] Supabase anon key rotated, deployment env updated
- [ ] All new keys saved to password manager / secrets vault

---

### Step 1.2 — Remove `.env.local` from git history

**Option A: git-filter-repo (recommended, fast)**

```bash
# Install if not present
pip install git-filter-repo

# Purge the file from ALL history
cd /Users/pabloillescas/Documents/GitHub/horario-app
git filter-repo --path .env.local --invert-paths --force

# Verify it's gone
git log --all --full-history -- .env.local
# Expected: no output

# Force-push to all remotes
git push origin --force --all
git push origin --force --tags
```

**Option B: BFG Repo Cleaner (alternative)**

```bash
# Download BFG from https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --delete-files .env.local
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push origin --force --all
```

**After purging:**
```bash
# Confirm the file is gone from history
git log --all --full-history -- .env.local
# Expected: no output

# Confirm .env.local is in .gitignore
grep -n "\.env\.local" .gitignore
# Expected: a matching line
```

- [ ] `.env.local` purged from git history
- [ ] Force-push completed to all remotes
- [ ] Confirmed `.env.local` is in `.gitignore`
- [ ] Anyone who cloned the repo has been notified to re-clone or purge locally

---

### Step 1.3 — Audit for other committed secrets

```bash
# Search for any remaining secrets in the codebase
grep -rn "sk-ant-api" . --include="*.ts" --include="*.js" --include="*.json" --include="*.env*"
grep -rn "sk_test_" . --include="*.ts" --include="*.js" --include="*.json"
grep -rn "sb_secret_" . --include="*.ts" --include="*.js" --include="*.json"
grep -rn "service_role" . --include="*.ts" --include="*.js" --include="*.json"

# Check if .env* files are properly gitignored
git ls-files | grep "\.env"
# Expected: nothing, or only .env.example
```

- [ ] No secrets found in tracked files
- [ ] Only `.env.example` (with placeholder values) exists in tracked files

---

### Step 1.4 — Add a pre-commit hook to prevent future leaks

```bash
# Install detect-secrets
pip install detect-secrets

# Create a baseline (scan current clean state)
detect-secrets scan > .secrets.baseline

# Create the pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
detect-secrets-hook --baseline .secrets.baseline
if [ $? -ne 0 ]; then
  echo "❌ Potential secrets detected. Commit blocked."
  echo "   Run: detect-secrets scan > .secrets.baseline  (to update baseline if false positive)"
  exit 1
fi
EOF
chmod +x .git/hooks/pre-commit

# Test it works
echo "ANTHROPIC_API_KEY=sk-ant-test" > /tmp/test_secret.txt
git add /tmp/test_secret.txt && git commit -m "test"
# Expected: commit is blocked
git reset HEAD /tmp/test_secret.txt && rm /tmp/test_secret.txt
```

- [ ] `detect-secrets` installed
- [ ] `.secrets.baseline` created and committed
- [ ] Pre-commit hook active and tested

---

## SECTION 2 — CRITICAL: Dev Auth Bypass

### Finding
When `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is empty, the app falls back to hardcoded `accountId='demo-account'`. The secure proxy's `resolveAccountId` accepts the `accountId` from the request body when auth is disabled. Any caller can claim any account.

**File:** `app/api/secure-proxy+api.ts`
**File:** `contexts/IdentityContext.tsx`

---

### Step 2.1 — Verify the current behavior

```bash
# Check if auth bypass is active in your dev environment
grep -n "AUTH_ENABLED\|dev.bypass\|CLERK_PUBLISHABLE" app/api/secure-proxy+api.ts | head -20

# Check what resolveAccountId does when authorizedId is null
grep -n "resolveAccountId\|authorizedId" app/api/secure-proxy+api.ts | head -20
```

Read the output. If `resolveAccountId` falls back to `bodyId` when `authorizedId` is null, the bypass is active.

- [ ] Confirmed whether auth bypass is currently active

---

### Step 2.2 — Ensure production always requires auth

Open `app/api/secure-proxy+api.ts` and verify (or add) a hard check at the top of the POST handler:

```typescript
// At the top of the POST handler, after parsing the body:
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !AUTH_ENABLED) {
  console.error('[secure-proxy] FATAL: AUTH_ENABLED is false in production. Refusing all requests.');
  return buildErrorResponse('Service temporarily unavailable.', 503);
}
```

Also verify your production deployment (Vercel/Railway) has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` set to a real value:

```bash
# On Vercel:
vercel env ls
# Expected: EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is listed with a non-empty value

# On Railway:
railway variables
```

- [ ] Hard production guard added to API route
- [ ] Confirmed `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is set in all production environments
- [ ] Confirmed `CLERK_SECRET_KEY` is set in all production environments (server-only)

---

### Step 2.3 — Add a startup warning in dev mode

In `app/api/secure-proxy+api.ts`, add a visible warning when auth is disabled:

```typescript
const AUTH_ENABLED = Boolean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

if (!AUTH_ENABLED) {
  console.warn(
    '\n⚠️  SECURITY WARNING: Auth is DISABLED (no EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).\n' +
    '   All requests run as the accountId supplied in the request body.\n' +
    '   NEVER run in this mode in production.\n'
  );
}
```

- [ ] Warning added and visible in dev server logs

---

## SECTION 3 — HIGH: Onboarding RLS Has No Account Scoping

### Finding
`onboarding_progress` RLS allows any anon user to insert/update any row with no `account_id` check.

**File:** `supabase/migrations/20240613120000_onboarding_progress.sql`

---

### Step 3.1 — Verify the current state in Supabase

```bash
# Connect to your Supabase project
# Option A: Supabase dashboard → Table Editor → onboarding_progress → RLS Policies
# Option B: SQL editor or psql

psql "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"

-- Check existing policies
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'onboarding_progress';
```

Look for policies that do NOT contain `account_id` in the `qual` or `with_check` columns.

- [ ] Confirmed current policies are missing account_id scoping

---

### Step 3.2 — Create and apply the fix migration

Create the file:

```bash
touch supabase/migrations/20260404000001_fix_onboarding_rls.sql
```

Content:

```sql
-- Migration: fix_onboarding_rls
-- Adds account_id scoping to onboarding_progress RLS policies.
-- Previously any anon user could insert/update any account's onboarding record.

begin;

-- Drop existing unscoped policies
drop policy if exists "Anon upsert onboarding progress" on public.onboarding_progress;
drop policy if exists "Anon update onboarding progress" on public.onboarding_progress;
drop policy if exists "Anon select onboarding progress" on public.onboarding_progress;

-- Re-create with account_id scoping
create policy "Anon insert own account onboarding progress"
  on public.onboarding_progress
  for insert
  with check (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );

create policy "Anon update own account onboarding progress"
  on public.onboarding_progress
  for update
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  )
  with check (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );

create policy "Anon select own account onboarding progress"
  on public.onboarding_progress
  for select
  using (
    auth.role() = 'anon'
    and account_id = private.jwt_account_id()
  );

commit;
```

Apply it:

```bash
# Using Supabase CLI
supabase db push

# Or directly via SQL editor in Supabase dashboard
# Copy-paste the SQL above and run it
```

- [ ] Migration file created
- [ ] Migration applied to production database

---

### Step 3.3 — Verify the fix

```sql
-- In Supabase SQL editor: confirm new policies exist and are scoped
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'onboarding_progress';

-- Expected: all policies contain account_id = private.jwt_account_id()
```

Functional test (in Supabase SQL editor, simulating an anon user):

```sql
-- Simulate anon JWT for account-A trying to update account-B's row
-- This should return 0 rows affected
SET LOCAL role = 'anon';
SET LOCAL request.jwt.claims = '{"sub": "user-a", "account_id": "account-a"}';

UPDATE public.onboarding_progress
SET profile_complete = true
WHERE account_id = 'account-b';  -- different account

-- Expected: UPDATE 0 (no rows affected)
```

- [ ] SQL policies show account_id scoping
- [ ] Cross-account update returns 0 rows

---

## SECTION 4 — HIGH: CORS Wildcard Origin

### Finding
`app/api/secure-proxy+api.ts` returns `Access-Control-Allow-Origin: *`, allowing any website to make cross-origin requests to the API.

---

### Step 4.1 — Identify all your valid origins

List the domains where your app is hosted:
- Production web: `https://horario.app` (or your actual domain)
- Staging: `https://staging.horario.app` (if any)
- Local dev: `http://localhost:8081`

---

### Step 4.2 — Update the CORS headers

In `app/api/secure-proxy+api.ts`, replace the static `CORS_HEADERS` constant with a dynamic function:

```typescript
// Before:
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// After:
const ALLOWED_ORIGINS = new Set([
  'https://horario.app',
  'https://www.horario.app',
  process.env.EXPO_PUBLIC_APP_URL ?? '',
  'http://localhost:8081',
  'http://localhost:3000',
].filter(Boolean));

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : 'null';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Vary': 'Origin',
  };
}
```

Then in the OPTIONS handler and POST handler, replace static headers with:

```typescript
// In OPTIONS handler:
const origin = request.headers.get('origin');
return new Response(null, { status: 204, headers: getCorsHeaders(origin) });

// In POST handler, wherever you return responses:
// Pass the origin through to buildErrorResponse and all return statements
const origin = request.headers.get('origin');
// ... then use getCorsHeaders(origin) instead of CORS_HEADERS
```

Apply the same fix to `app/api/referrals+api.ts` if it has the same wildcard.

- [ ] CORS updated in `secure-proxy+api.ts`
- [ ] CORS updated in `referrals+api.ts`
- [ ] Valid origins list reviewed and confirmed correct

---

### Step 4.3 — Verify the fix

```bash
# Should be allowed (your domain):
curl -X OPTIONS https://<your-proxy-url> \
  -H "Origin: https://horario.app" \
  -H "Access-Control-Request-Method: POST" \
  -v 2>&1 | grep "Access-Control-Allow-Origin"
# Expected: Access-Control-Allow-Origin: https://horario.app

# Should be blocked (random domain):
curl -X OPTIONS https://<your-proxy-url> \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: POST" \
  -v 2>&1 | grep "Access-Control-Allow-Origin"
# Expected: Access-Control-Allow-Origin: null
```

- [ ] Allowed origin returns the specific origin header
- [ ] Blocked origin returns `null`

---

## SECTION 5 — MEDIUM: Error Messages Leak DB Schema

### Finding
Raw Supabase error messages (containing constraint names, column names, schema hints) are forwarded to the client.

---

### Step 5.1 — Add a sanitizer function

In `app/api/secure-proxy+api.ts`, add this near the top (after imports):

```typescript
function sanitizeDbError(error: unknown, requestId: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Log the real error server-side with a traceable ID
  console.error(`[secure-proxy][${requestId}] DB error:`, raw);
  // Return a generic message to the client
  if (raw.includes('duplicate key') || raw.includes('unique constraint')) {
    return 'A duplicate record already exists.';
  }
  if (raw.includes('foreign key') || raw.includes('violates foreign key')) {
    return 'Referenced record does not exist.';
  }
  if (raw.includes('not-null') || raw.includes('null value in column')) {
    return 'A required field is missing.';
  }
  if (raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'You do not have permission to perform this action.';
  }
  return `An unexpected error occurred. Reference: ${requestId}`;
}
```

Add a request ID generator:

```typescript
function generateRequestId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
```

Then replace every `error: error.message` pattern with `sanitizeDbError(error, requestId)`:

```bash
# Find all instances to fix:
grep -n "error: error\.message\|error\.message" app/api/secure-proxy+api.ts
```

- [ ] `sanitizeDbError` function added
- [ ] All `error.message` forwarded to client replaced with sanitized version
- [ ] Real errors are logged server-side with a request ID

---

## SECTION 6 — MEDIUM: No Rate Limiting on API Routes

### Finding
No rate limiting exists. Any authenticated user can spam all API endpoints.

---

### Step 6.1 — Add in-process rate limiting

Add to `app/api/secure-proxy+api.ts` (and `referrals+api.ts`):

```typescript
// ---------------------------------------------------------------------------
// Simple in-memory rate limiter (per-user, resets on server restart)
// For production at scale, replace with Redis-backed limiter (@vercel/kv etc.)
// ---------------------------------------------------------------------------

type RateLimitBucket = { count: number; resetAt: number };
const _rateLimitMap = new Map<string, RateLimitBucket>();

function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = _rateLimitMap.get(key);

  if (!bucket || now > bucket.resetAt) {
    _rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (bucket.count < maxRequests) {
    bucket.count++;
    return false;
  }

  return true; // rate limited
}
```

Apply it in the POST handler, after extracting the authenticated user identity:

```typescript
// After resolving authorizedAccountId or userId:
const rateLimitKey = `${action}:${authorizedAccountId ?? body?.accountId ?? 'anon'}`;
const limits: Record<string, { max: number; windowMs: number }> = {
  generateDemandForecast: { max: 10, windowMs: 60_000 },   // 10/min
  upsertDemandTarget:     { max: 30, windowMs: 60_000 },   // 30/min
  upsertRosterShift:      { max: 60, windowMs: 60_000 },   // 60/min
  default:                { max: 100, windowMs: 60_000 },  // 100/min
};
const { max, windowMs } = limits[action] ?? limits['default'];
if (isRateLimited(rateLimitKey, max, windowMs)) {
  return buildErrorResponse('Too many requests. Please try again later.', 429);
}
```

For `referrals+api.ts` (stricter — prevents brute-forcing invite codes):

```typescript
const refRateLimitKey = `referral:${authorizedAccountId ?? 'anon'}`;
if (isRateLimited(refRateLimitKey, 5, 60_000)) {  // 5/min
  return buildErrorResponse('Too many requests.', 429);
}
```

- [ ] Rate limiter added to `secure-proxy+api.ts`
- [ ] Rate limiter added to `referrals+api.ts` (stricter limit)
- [ ] Confirmed 429 is returned when limit is exceeded (manual test or unit test)

---

## SECTION 7 — MEDIUM: Referral Codes Use `Math.random()`

### Finding
`referrals+api.ts` uses `Math.random()` (not cryptographically secure) to generate 8-character referral codes.

---

### Step 7.1 — Replace with crypto.getRandomValues

In `app/api/referrals+api.ts`, find `generateReferralCode()` and replace it:

```typescript
// Before:
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// After:
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    // Modulo bias is negligible: 256 % 36 = 4, bias < 2%
    code += chars[bytes[i] % chars.length];
  }
  return code;
}
```

Verify `crypto` is available in the Expo Router API route context (Node.js 19+ has it globally; earlier versions need `import { webcrypto as crypto } from 'crypto'`):

```bash
node -e "console.log(typeof crypto.getRandomValues)"
# Expected: function
```

If not available globally:

```typescript
import { webcrypto as crypto } from 'crypto';
```

- [ ] `generateReferralCode` updated to use `crypto.getRandomValues`
- [ ] Confirmed `crypto` is available in the runtime

---

## SECTION 8 — MEDIUM: Date Range Not Validated in dbListRoster

### Finding
`fromDate` and `toDate` parameters accepted by `dbListRoster` are not validated for format or ordering.

---

### Step 8.1 — Add validation

In `app/api/secure-proxy+api.ts`, find the `dbListRoster` function and add validation at the top (the `isISODate` helper already exists in the file):

```typescript
const dbListRoster = async (
  client: SupabaseClient,
  accountId: string,
  fromDate?: string,
  toDate?: string,
): Promise<...> => {
  // Validate date parameters
  if (fromDate !== undefined && !isISODate(fromDate)) {
    return { success: false as const, error: 'fromDate must be a valid YYYY-MM-DD date', shifts: [] };
  }
  if (toDate !== undefined && !isISODate(toDate)) {
    return { success: false as const, error: 'toDate must be a valid YYYY-MM-DD date', shifts: [] };
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { success: false as const, error: 'fromDate must not be later than toDate', shifts: [] };
  }

  // ... rest of function unchanged
```

- [ ] Validation added to `dbListRoster`
- [ ] Confirmed that invalid dates return a 400-level error

---

## SECTION 9 — Verification Checklist

Run this after completing all sections above.

### 9.1 — Full test suite passes

```bash
npx jest --no-coverage --forceExit
# Expected: all tests green
```

- [ ] All tests pass

### 9.2 — Lint passes

```bash
npm run lint
# Expected: 0 errors (pre-existing warnings in InputField.tsx are acceptable)
```

- [ ] No new lint errors

### 9.3 — No secrets in codebase

```bash
detect-secrets scan --list-all-plugins 2>/dev/null || grep -rn "sk-ant\|sk_test_\|sb_secret_" . \
  --include="*.ts" --include="*.js" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git
# Expected: no output
```

- [ ] No secrets found in tracked files

### 9.4 — RLS policies are scoped

```sql
-- Run in Supabase SQL editor
SELECT tablename, policyname, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Manually verify every policy that allows `anon` includes `account_id = private.jwt_account_id()`.

- [ ] All anon-facing policies are account-scoped

### 9.5 — Service-role key never reaches client

```bash
# Search for service role key usage in client-side code
grep -rn "SERVICE_ROLE\|service_role" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude="*+api.ts" --exclude="*route.ts" \
  --exclude="*.sql" --exclude="*.md"
# Expected: no output
```

- [ ] Service role key found only in `app/api/` files

### 9.6 — Auth is enabled in production

```bash
# Verify the env var is set in your deployment
vercel env ls production | grep CLERK_PUBLISHABLE
# or
printenv | grep CLERK_PUBLISHABLE
# Expected: non-empty value
```

- [ ] `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is set in production
- [ ] `CLERK_SECRET_KEY` is set in production (server-side only)

---

## SECTION 10 — Commit the Fixes

Once all checkboxes above are ticked:

```bash
# Stage only the security fix files
git add \
  app/api/secure-proxy+api.ts \
  app/api/referrals+api.ts \
  supabase/migrations/20260404000001_fix_onboarding_rls.sql \
  .secrets.baseline \
  docs/SECURITY_REMEDIATION.md

# Commit with CHG entry already added to Claude_changes.md
git commit -m "CHG-060: Security hardening — CORS, RLS, rate limiting, error sanitization, crypto"
```

---

## Reference — Severity Summary

| Section | Severity | Finding | Status |
|---|---|---|---|
| 1 | CRITICAL | Secrets committed to `.env.local` | Fix immediately |
| 2 | CRITICAL | Dev auth bypass allows account spoofing | Fix before prod |
| 3 | HIGH | `onboarding_progress` RLS not scoped by account | Fix before prod |
| 4 | HIGH | `pos_sales` RLS previously leaked all accounts | Verify prod has 20260403 migration |
| 5 | HIGH | Wildcard CORS on secure proxy | Fix before prod |
| 6 | MEDIUM | DB error messages leak schema info | Fix before prod |
| 7 | MEDIUM | No rate limiting on API routes | Fix before prod |
| 8 | MEDIUM | Referral codes use `Math.random()` | Fix soon |
| 9 | MEDIUM | Date range params not validated | Fix soon |
