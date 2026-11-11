/**
 * Per-user request limit for the API routes (CLAUDE.md debt #10).
 *
 * A fixed window per user id, kept in this server instance's memory. On a
 * serverless host each warm instance counts on its own, so this bounds what
 * one signed-in client can ask of one instance (a retry loop, a script with a
 * stolen session): it is not a global quota. A global one needs a shared
 * store or the host's firewall rules.
 *
 * Writes get a lower limit than reads: a page load reads many lists at once.
 */
export type RateLimitRule = { limit: number; windowMs: number };

export const READ_LIMIT: RateLimitRule = { limit: 600, windowMs: 60_000 };
export const WRITE_LIMIT: RateLimitRule = { limit: 240, windowMs: 60_000 };

/** Buckets kept at most; the oldest are dropped first when a flood of ids arrives. */
const MAX_BUCKETS = 10_000;

type Bucket = { windowStart: number; count: number };

export type RateLimitVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export const createRateLimiter = (now: () => number = Date.now) => {
  const buckets = new Map<string, Bucket>();

  const hit = (key: string, rule: RateLimitRule): RateLimitVerdict => {
    const time = now();
    const bucket = buckets.get(key);
    if (!bucket || time - bucket.windowStart >= rule.windowMs) {
      // Re-insert so the map's order is "least recently started first".
      buckets.delete(key);
      buckets.set(key, { windowStart: time, count: 1 });
      if (buckets.size > MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      return { allowed: true };
    }
    if (bucket.count >= rule.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + rule.windowMs - time) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true };
  };

  return { hit, reset: () => buckets.clear() };
};

/** The limiter shared by every request this instance serves. */
export const rateLimiter = createRateLimiter();
