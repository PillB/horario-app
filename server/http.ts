/**
 * Shared HTTP helpers for the server API routes: CORS and JSON responses.
 */

// Allowed origins for CORS. Wildcard is intentionally avoided — each origin
// is echoed back only when it matches, preventing cross-origin data leaks.
const allowedOrigins = (): Set<string> => {
  const origins = [
    process.env.EXPO_PUBLIC_APP_ORIGIN, // e.g. https://horario.app
    process.env.EXPO_PUBLIC_SECURE_PROXY_URL?.startsWith('http')
      ? new URL(process.env.EXPO_PUBLIC_SECURE_PROXY_URL).origin
      : undefined,
  ];
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:8081', 'http://localhost:3000');
  }
  return new Set(origins.filter((o): o is string => Boolean(o)));
};

export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = requestOrigin && allowedOrigins().has(requestOrigin) ? requestOrigin : 'null';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

export function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

export function optionsResponse(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
