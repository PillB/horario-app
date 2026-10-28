/**
 * Seeded synthetic series for the forecasting tests (never used by the app).
 */

/** mulberry32: small, fast, seeded PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws (Box-Muller). */
export function normal(random: () => number): () => number {
  return () => {
    const u = Math.max(random(), 1e-12);
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Mon-heavy … weekend-heavy weekly pattern, indexed by position mod 7, mean 0. */
export const WEEKLY = [-2, -1, -1, 0, 1, 3, 0];

export type SeriesSpec = {
  length: number;
  level?: number;
  /** Change in level per day. */
  slope?: number;
  /** Weekly pattern added by position mod 7. */
  season?: readonly number[];
  /** Standard deviation of iid Gaussian noise. */
  noise?: number;
  seed?: number;
};

/** level + slope·t + season[t mod 7] + noise, not rounded. */
export function series(spec: SeriesSpec): number[] {
  const z = normal(rng(spec.seed ?? 1));
  const season = spec.season ?? WEEKLY;
  return Array.from({ length: spec.length }, (_, t) =>
    (spec.level ?? 10) + (spec.slope ?? 0) * t + season[t % 7] + (spec.noise ?? 0) * z(),
  );
}

/** Each weekday follows its own random walk: y_t = y_{t−7} + ε (seasonal naive is optimal). */
export function seasonalRandomWalk(length: number, sd: number, seed = 1): number[] {
  const z = normal(rng(seed));
  const y: number[] = [];
  for (let t = 0; t < length; t += 1) y.push(t < 7 ? 20 + WEEKLY[t] * 2 : y[t - 7] + sd * z());
  return y;
}
