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
/**
 * Clerk's getToken signature accepts an optional options object.
 * We only use the `template` field, matching the Clerk SDK type.
 */
type GetTokenOptions = { template?: string };

let tokenProvider: ((options?: GetTokenOptions) => Promise<string | null>) | null = null;

/**
 * Stores the token provider function in module scope so that non-React
 * service files can retrieve a fresh Clerk session token on demand.
 *
 * Call this once from a top-level React component (e.g. the app root) after
 * Clerk has been initialised, passing a stable reference such as
 * `useAuth().getToken`.
 *
 * @param fn - Clerk's getToken function from useAuth().
 */
export function setTokenProvider(fn: (options?: GetTokenOptions) => Promise<string | null>): void {
  tokenProvider = fn;
}

/**
 * Returns the current Clerk session token by invoking the stored provider.
 *
 * Use the default session token. The server proxy verifies it against Clerk's
 * JWKS, and Supabase accepts it directly through its native Clerk third-party
 * auth integration. Clerk's "supabase" JWT template is deprecated (April 2025)
 * and is not needed; `template` remains only for other custom templates.
 *
 * @param template  Optional Clerk JWT template name.
 * @returns A promise that resolves to the session token string, or `null`
 *          when auth is disabled, no provider is set, or the user is signed out.
 */
export async function getSessionToken(template?: string): Promise<string | null> {
  if (!AUTH_ENABLED || tokenProvider === null) {
    return null;
  }

  return tokenProvider(template ? { template } : undefined);
}
