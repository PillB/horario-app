/**
 * The service-role Supabase client. Server only: the key never leaves the
 * server (CLAUDE.md, Security). Used by the secure proxy and the payment webhook.
 */
import { SupabaseClient, createClient } from '@supabase/supabase-js';

/** Longest one database request may take. PostgREST gives up waiting for a pooled connection after 10 s. */
const DB_REQUEST_TIMEOUT_MS = 15_000;

export const getServiceClient = (): SupabaseClient | null => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { 'x-application-name': 'horario-secure-proxy' },
      // A database that stops answering must not hold the request (and the user's spinner) open.
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS) }),
    },
  });
};

