/**
 * CHG-098: the per-user request limit of the API routes.
 */
import { createRateLimiter } from '@/server/rateLimit';

describe('createRateLimiter', () => {
  const rule = { limit: 3, windowMs: 60_000 };

  it('allows up to the limit in a window, then refuses with the seconds left', () => {
    let time = 1_000;
    const limiter = createRateLimiter(() => time);
    expect([1, 2, 3].map(() => limiter.hit('u1', rule).allowed)).toEqual([true, true, true]);
    time += 15_000;
    expect(limiter.hit('u1', rule)).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it('counts each key on its own', () => {
    const limiter = createRateLimiter(() => 0);
    [1, 2, 3].forEach(() => limiter.hit('u1', rule));
    expect(limiter.hit('u1', rule).allowed).toBe(false);
    expect(limiter.hit('u2', rule).allowed).toBe(true);
  });

  it('starts a new window once the old one has passed', () => {
    let time = 0;
    const limiter = createRateLimiter(() => time);
    [1, 2, 3].forEach(() => limiter.hit('u1', rule));
    time = 60_000;
    expect(limiter.hit('u1', rule).allowed).toBe(true);
  });
});
