/**
 * Small deterministic PRNG (mulberry32) so demo data is reproducible for a
 * given seed: re-provisioning the same user yields the same books.
 */

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Uniform amount in [min, max] rounded to cents. */
  amount(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    amount: (min, max) => Math.round((min + next() * (max - min)) * 100) / 100,
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
    chance: (p) => next() < p,
  };
}
