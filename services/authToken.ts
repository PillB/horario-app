/**
 * @file services/authToken.ts
 * @description Module-level session token provider for non-React service files.
 * Allows service modules to attach a Clerk session token to outbound requests
 * without importing React hooks or depending on component context.
 */

/**
 * Indicates whether authentication is enabled for the current environment.
 * True when the Clerk publishable key begins with 'pk_', indicating a valid
 * Clerk configuration is present. When false, auth token retrieval is a no-op.
 */
export const AUTH_ENABLED: boolean =
  typeof process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY === "string" &&
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_");

/**
 * The stored token provider function, set by the React layer at startup.
 * Null until `setTokenProvider` is called.
 */
let tokenProvider: (() => Promise<string | null>) | null = null;

/**
 * Stores the token provider function in module scope so that non-React
 * service files can retrieve a fresh Clerk session token on demand.
 *
 * Call this once from a top-level React component (e.g. the app root) after
 * Clerk has been initialised, passing a stable reference such as
 * `useAuth().getToken`.
 *
 * @param fn - An async function that resolves to the current session token,
 *             or `null` when the user is signed out or the token cannot be
 *             obtained.
 */
export function setTokenProvider(fn: () => Promise<string | null>): void {
  tokenProvider = fn;
}

/**
 * Returns the current Clerk session token by invoking the stored provider.
 *
 * - If no provider has been registered (e.g. during development without auth
 *   or before `setTokenProvider` has been called) this function returns `null`
 *   immediately, acting as a transparent dev bypass.
 * - If `AUTH_ENABLED` is false the provider is never called and `null` is
 *   returned, keeping non-auth environments unaffected.
 *
 * @returns A promise that resolves to the session token string, or `null` when
 *          auth is disabled, no provider is set, or the user is signed out.
 */
export async function getSessionToken(): Promise<string | null> {
  if (!AUTH_ENABLED || tokenProvider === null) {
    return null;
  }

  return tokenProvider();
}
