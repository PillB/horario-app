/**
 * GET /api/health — deployment health check.
 *
 * Reports which environment this deployment is, which commit it runs, and
 * whether auth and the database are configured. It only reports whether
 * variables are present; it never returns their values.
 *
 * Env is read on every request (not at module load) so the response always
 * reflects the running function's configuration.
 */

export type HealthEnvironment = 'production' | 'preview' | 'development';

export type HealthPayload = {
  status: 'ok';
  environment: HealthEnvironment;
  commit: string | null;
  authConfigured: boolean;
  databaseConfigured: boolean;
};

const SHORT_SHA_LENGTH = 7;

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveEnvironment(env: NodeJS.ProcessEnv): HealthEnvironment {
  // VERCEL_ENV is set by Vercel on every deployment; NODE_ENV is the fallback
  // for local servers (`npx expo serve`, `expo start`).
  const raw = env.VERCEL_ENV ?? env.NODE_ENV;
  if (raw === 'production' || raw === 'preview') return raw;
  return 'development';
}

export function buildHealthPayload(env: NodeJS.ProcessEnv): HealthPayload {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY;
  return {
    status: 'ok',
    environment: resolveEnvironment(env),
    commit: sha ? sha.slice(0, SHORT_SHA_LENGTH) : null,
    authConfigured: isSet(env.CLERK_JWKS_URL),
    databaseConfigured: isSet(env.EXPO_PUBLIC_SUPABASE_URL) && isSet(serverKey),
  };
}

export function GET(): Response {
  return Response.json(buildHealthPayload(process.env), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
