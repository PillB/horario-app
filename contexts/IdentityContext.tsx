/**
 * IdentityContext — provides { accountId, userId, isLoaded } to the entire app.
 *
 * When Clerk auth is enabled (EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY starts with "pk_"):
 *   - accountId = active Clerk organization id, else the Clerk userId. This
 *     matches the tenant the server derives from the session token
 *     (server/proxyAuth.ts accountIdFromClaims), so switching organization
 *     re-fetches every account-scoped hook.
 *   - userId    = Clerk userId
 *   - isLoaded  = false while Clerk is initialising, true once resolved
 *   Falls back to env-var values if Clerk hasn't resolved yet.
 *
 * When auth is disabled (dev mode / no Clerk key):
 *   - accountId = EXPO_PUBLIC_ACCOUNT_ID ?? 'demo-account'
 *   - userId    = EXPO_PUBLIC_USER_ID    ?? 'local-user'
 *   - isLoaded  = true (no async initialisation needed)
 *
 * All data hooks (useWorkers, useShiftTemplates, useRoster, useAnalytics, etc.)
 * accept accountId as a parameter and re-fetch automatically when it changes.
 * This means data is loaded with the env-var fallback while Clerk initialises
 * and then reloaded with the real user ID once authentication resolves.
 *
 * Implementation note:
 *   ClerkIdentityProvider calls require('@clerk/expo').useAuth() inside the
 *   component body — the same dynamic-require pattern used in app/(tabs)/_layout.tsx
 *   — so it is only rendered when ClerkProvider is already mounted in the tree.
 *   This avoids a "useAuth called outside ClerkProvider" error when auth is disabled.
 */

import React, { createContext, useContext, useEffect } from 'react';
import { setTokenProvider } from '@/services/authToken';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type Identity = {
  /** Supabase account / tenant scope for all DB queries. */
  accountId: string;
  /** Individual user ID for freemium quota and audit trails. */
  userId: string;
  /** True once the auth provider has resolved its initial state. */
  isLoaded: boolean;
};

// ─── Defaults ──────────────────────────────────────────────────────────────────

const ENV_ACCOUNT_ID = process.env.EXPO_PUBLIC_ACCOUNT_ID ?? 'demo-account';
const ENV_USER_ID = process.env.EXPO_PUBLIC_USER_ID ?? 'local-user';
const AUTH_ENABLED =
  (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

// ─── Context ───────────────────────────────────────────────────────────────────

const IdentityContext = createContext<Identity>({
  accountId: ENV_ACCOUNT_ID,
  userId: ENV_USER_ID,
  isLoaded: true,
});

// ─── Providers ─────────────────────────────────────────────────────────────────

/**
 * Only rendered inside ClerkProvider — safe to call useAuth() here.
 * Uses the same dynamic-require pattern as app/(tabs)/_layout.tsx.
 */
function ClerkIdentityProvider({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuth } = require('@clerk/expo') as typeof import('@clerk/expo');
  const { userId, orgId, isLoaded, getToken } = useAuth();

  useEffect(() => {
    setTokenProvider(getToken);
  }, [getToken]);

  const value: Identity = {
    // While isLoaded=false, userId is null; fall back to env var so hooks
    // don't receive an empty string and fire an unnecessary empty fetch.
    accountId: orgId ?? userId ?? ENV_ACCOUNT_ID,
    userId: userId ?? ENV_USER_ID,
    isLoaded,
  };

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}

/**
 * App-level provider.  Renders the Clerk-aware inner provider when auth is
 * enabled, or a static env-var provider when running in dev-bypass mode.
 *
 * Place this INSIDE ClerkProvider in app/_layout.tsx so that
 * ClerkIdentityProvider can safely call useAuth().
 */
export function IdentityProvider({ children }: { children: React.ReactNode }) {
  if (AUTH_ENABLED) {
    return <ClerkIdentityProvider>{children}</ClerkIdentityProvider>;
  }

  const value: Identity = {
    accountId: ENV_ACCOUNT_ID,
    userId: ENV_USER_ID,
    isLoaded: true,
  };
  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/** Returns the current account / user identity. Re-renders when auth resolves. */
export const useIdentity = (): Identity => useContext(IdentityContext);
