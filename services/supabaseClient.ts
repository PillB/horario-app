/**
 * supabaseClient.ts
 *
 * Supabase client factory for the Horario app.
 *
 * ── Architecture overview ────────────────────────────────────────────────────
 *
 * Horario uses Clerk for authentication and Supabase for persistence.
 * All database mutations go through the server-side secure proxy
 * (app/api/secure-proxy+api.ts), which uses the service-role key and
 * therefore bypasses RLS entirely.  RLS policies on anon SELECT are scoped
 * to the caller's account_id via a private JWT helper function
 * (private.jwt_account_id()) that reads the Clerk JWT claims injected into
 * every PostgREST request via the Authorization header.
 *
 * ── Why persistSession: false ────────────────────────────────────────────────
 *
 * Supabase's built-in session persistence (localStorage / AsyncStorage) is
 * designed for Supabase Auth (email+password / magic-link flows).  Horario
 * uses Clerk for identity; Clerk manages its own secure token storage.
 * Enabling Supabase session persistence would:
 *   • Store a stale / irrelevant Supabase Auth session to disk.
 *   • Trigger background token-refresh requests against Supabase Auth that
 *     will always fail (no Supabase Auth user exists for Clerk accounts).
 *   • Produce misleading error logs and unnecessary network traffic.
 *
 * Setting persistSession: false disables all of the above.  The Clerk JWT is
 * injected per-request via the Authorization header (see getAuthenticatedClient
 * below), so no persistent session is needed.
 *
 * ── Client variants ──────────────────────────────────────────────────────────
 *
 *   getSupabaseClient()
 *     Returns a singleton anonymous client (no auth header).  Safe to use for
 *     public/unauthenticated reads or as a base for header injection.
 *     Returns null when Supabase credentials are absent (e.g. pure-offline
 *     dev mode), allowing callers to degrade gracefully.
 *
 *   getAuthenticatedClient(token)
 *     Returns a *new* SupabaseClient instance with the Clerk JWT set as the
 *     Authorization Bearer token.  PostgREST forwards this header to the DB,
 *     where it is decoded by Supabase's JWT verification and made available to
 *     RLS policies via current_setting('request.jwt.claims').
 *     Pass null/undefined to receive the anonymous client (no auth header).
 *
 * ── TypeScript generics ───────────────────────────────────────────────────────
 *
 *   Both factory functions accept an optional Database generic type parameter
 *   so callers can get full type inference from a generated Supabase schema:
 *
 *     import type { Database } from '@/types/supabase';
 *     const client = getAuthenticatedClient<Database>(token);
 *     const { data } = await client.from('workers').select('*');
 *     //      ^-- data is inferred as Database['public']['Tables']['workers']['Row'][]
 *
 *   When no generic is supplied the client falls back to the default `any`
 *   schema, preserving backward compatibility with existing call-sites.
 */

import { SupabaseClient, createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Internal credential resolution
// ---------------------------------------------------------------------------

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

/**
 * Resolves Supabase credentials from environment variables.
 * Returns null when either variable is absent so callers can disable
 * persistence gracefully instead of throwing at module load time.
 */
const resolveCredentials = (): SupabaseCredentials | null => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { url: supabaseUrl, anonKey: supabaseAnonKey };
};

// ---------------------------------------------------------------------------
// Shared client options (auth-header-agnostic)
// ---------------------------------------------------------------------------

/**
 * Base createClient options shared by both factory functions.
 * The `global.headers` object is shallow-merged with per-request overrides in
 * getAuthenticatedClient so we never mutate the singleton's options.
 */
const BASE_CLIENT_OPTIONS = {
  auth: {
    /**
     * persistSession: false
     *
     * Disables Supabase Auth's built-in token storage (localStorage /
     * AsyncStorage).  Horario uses Clerk for identity; Clerk manages its own
     * secure credential storage independently.  Enabling Supabase session
     * persistence would cache a stale, non-functional Supabase Auth session
     * and trigger background refresh requests that will always fail because
     * no Supabase Auth user exists for Clerk-managed accounts.
     *
     * The Clerk JWT is injected per-request via the Authorization header in
     * getAuthenticatedClient(), so no persistent Supabase session is required.
     */
    persistSession: false as const,

    /**
     * autoRefreshToken: false
     *
     * Companion setting to persistSession: false.  There is no Supabase Auth
     * session to refresh; disabling auto-refresh prevents the SDK from
     * scheduling background timers that would immediately fail and produce
     * confusing error logs.
     */
    autoRefreshToken: false as const,

    /**
     * detectSessionInUrl: false
     *
     * Prevents the SDK from attempting to parse Supabase Auth magic-link /
     * OAuth callback tokens from the current URL.  Clerk handles its own
     * OAuth redirect flows; Supabase should never intercept those URLs.
     */
    detectSessionInUrl: false as const,
  },
  global: {
    headers: {
      /**
       * x-application-name is forwarded to Supabase logs and the PostgREST
       * request context, making it straightforward to identify Horario traffic
       * in the Supabase dashboard query analyser and log explorer.
       */
      'x-application-name': 'horario-forecast',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Singleton anonymous client
// ---------------------------------------------------------------------------

/**
 * Module-level singleton for the anonymous (unauthenticated) client.
 * Lazily initialised by getSupabaseClient(); reset to null when credentials
 * are absent so the module remains importable in offline dev mode.
 */
let cachedAnonymousClient: SupabaseClient | null = null;

/**
 * Returns a singleton anonymous Supabase client using the public anon key.
 *
 * The client carries no user-specific Authorization header.  It is suitable
 * for unauthenticated or pre-login reads where RLS allows public access.
 * For authenticated reads that must be account-scoped, use
 * getAuthenticatedClient(token) instead.
 *
 * Returns null when Supabase credentials are not configured (e.g. running in
 * a pure-offline environment or when EXPO_PUBLIC_SUPABASE_URL is unset).
 * Callers should treat a null return as "persistence disabled" and degrade
 * gracefully (e.g. operate in local-only / mock mode).
 *
 * @template TDatabase  Optional generated Database type for full type inference.
 *                      Defaults to `any` for backward compatibility.
 *
 * @example
 *   const client = getSupabaseClient();
 *   if (!client) return; // offline / unconfigured
 *   const { data } = await client.from('shift_templates').select('*');
 */
export const getSupabaseClient = <TDatabase = any>(): SupabaseClient<TDatabase> | null => {
  if (cachedAnonymousClient) {
    // Cast is safe: the underlying HTTP client is identical regardless of the
    // generic type parameter; TypeScript generics are erased at runtime.
    return cachedAnonymousClient as SupabaseClient<TDatabase>;
  }

  const credentials = resolveCredentials();

  if (!credentials) {
    console.warn(
      '[supabaseClient] Supabase credentials are not configured ' +
        '(EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing). ' +
        'Database persistence is disabled; the app will operate in local-only mode.',
    );
    return null;
  }

  cachedAnonymousClient = createClient<TDatabase>(
    credentials.url,
    credentials.anonKey,
    BASE_CLIENT_OPTIONS,
  ) as unknown as SupabaseClient;

  return cachedAnonymousClient as SupabaseClient<TDatabase>;
};

// ---------------------------------------------------------------------------
// Per-request authenticated client
// ---------------------------------------------------------------------------

/**
 * Returns a Supabase client with the caller's Clerk JWT injected as an
 * Authorization Bearer token on every request.
 *
 * PostgREST forwards the Authorization header to PostgreSQL where Supabase's
 * JWT verification decodes it and exposes the claims via:
 *   current_setting('request.jwt.claims', true)
 *
 * RLS policies call private.jwt_account_id() which reads that setting to
 * scope SELECT results to the authenticated user's account_id without any
 * application-level filtering.
 *
 * A new SupabaseClient instance is created for every call so that concurrent
 * requests from different users (in a server-side / SSR context) never share
 * auth state.  In a React Native client context where only one user is active
 * at a time, callers may cache the returned instance for the lifetime of the
 * Clerk session if they wish — but this function intentionally does NOT cache
 * because the token can rotate at any point during the session.
 *
 * When token is null or undefined the function falls back to returning the
 * anonymous singleton (equivalent to calling getSupabaseClient()), allowing
 * callers to use a single code path regardless of auth state.
 *
 * Returns null when Supabase credentials are not configured.
 *
 * @template TDatabase  Optional generated Database type for full type inference.
 *                      Import from '@/types/supabase' after running
 *                      `npx supabase gen types typescript --local > types/supabase.ts`.
 *
 * @param token  Clerk session JWT string, or null/undefined for anon access.
 *
 * @example
 *   import type { Database } from '@/types/supabase';
 *   import { getAuthenticatedClient } from '@/services/supabaseClient';
 *   import { getSessionToken } from '@/services/authToken';
 *
 *   const token = await getSessionToken();
 *   const client = getAuthenticatedClient<Database>(token);
 *   if (!client) return;
 *
 *   const { data, error } = await client
 *     .from('workers')
 *     .select('id, name, role')
 *     .order('name');
 */
export const getAuthenticatedClient = <TDatabase = any>(
  token: string | null | undefined,
): SupabaseClient<TDatabase> | null => {
  // No token → fall back to the anonymous singleton.
  if (!token) {
    return getSupabaseClient<TDatabase>();
  }

  const credentials = resolveCredentials();

  if (!credentials) {
    console.warn(
      '[supabaseClient] getAuthenticatedClient called but Supabase credentials ' +
        'are not configured. Database persistence is disabled.',
    );
    return null;
  }

  // Merge the Authorization header into a fresh options object so we never
  // mutate BASE_CLIENT_OPTIONS or the anonymous singleton's internal state.
  const authenticatedOptions = {
    ...BASE_CLIENT_OPTIONS,
    global: {
      ...BASE_CLIENT_OPTIONS.global,
      headers: {
        ...BASE_CLIENT_OPTIONS.global.headers,
        // The Authorization header is consumed by PostgREST's JWT middleware.
        // Supabase validates the JWT using the JWT secret configured in the
        // project dashboard (Settings → API → JWT Secret).  For Clerk
        // integration the shared JWT secret must match the Clerk JWT template
        // configured in the Clerk dashboard (JWT Templates → Supabase).
        Authorization: `Bearer ${token}`,
      },
    },
  };

  return createClient<TDatabase>(credentials.url, credentials.anonKey, authenticatedOptions);
};

// ---------------------------------------------------------------------------
// Type-only re-exports for convenience
// ---------------------------------------------------------------------------

/**
 * Re-export SupabaseClient so consumers do not need a direct dependency on
 * @supabase/supabase-js just for the type annotation.
 */
export type { SupabaseClient } from '@supabase/supabase-js';