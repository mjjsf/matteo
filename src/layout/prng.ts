/** Seeded PRNG. One seed drives UMAP, any random projection, and the
 *  decoincidence jitter, so the whole layout is reproducible from
 *  `LAYOUT_CONFIG.seed` — and the seed is part of the input hash, making a seed
 *  bump a visible, reviewable act. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A unit vector drawn from the given PRNG. Used to push coincident points
 *  apart in a way that is random but reproducible. */
export function randomUnitVector(rng: () => number): [number, number, number] {
  // Rejection-free: sample z uniformly then a longitude.
  const z = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(theta), r * Math.sin(theta), z];
}
