import { UMAP } from 'umap-js';
import type { LayoutConfig } from './config';

/** Internal shape we reach into. `embedding` is `private` in umap-js's `.d.ts`
 *  but a plain property at runtime. */
interface UmapInternals {
  embedding: number[][];
}

/** True when the umap-js instance still exposes the embedding array we need to
 *  seed. Asserted by a test so a dependency upgrade fails loudly instead of
 *  silently reverting to random initialisation. */
export function hasInjectableEmbedding(umap: UMAP): boolean {
  const internals = umap as unknown as Partial<UmapInternals>;
  return Array.isArray(internals.embedding);
}

/** Run UMAP with a supplied initial embedding.
 *
 *  Why this is not just `new UMAP().fit(X)`: umap-js initialises the embedding
 *  uniformly at random and implements no spectral initialisation. With a sparse
 *  tag corpus, hundreds of book pairs share no tags at all, so their cosine
 *  distance is exactly 1.0 and the kNN graph is full of ties — which means the
 *  tie-breaking, and therefore the global shape of the result, is decided by
 *  the seed. That produces the classic UMAP artefact: crisp-looking clumps
 *  floating in a void that encode nothing. Seeding from PCA makes the global
 *  arrangement reproducibly variance-shaped while UMAP still does the local
 *  neighbourhood work.
 *
 *  The injection MUST mutate the existing rows rather than reassign
 *  `embedding`. `initializeFit` calls `initializeOptimization`, which copies the
 *  array reference into `optimizationState.headEmbedding`; reassigning
 *  `embedding` afterwards would leave the optimiser working on the original
 *  random array and the seeding would be silently ignored. Verified against
 *  umap-js 1.4.0. */
export function runUmap(
  data: number[][],
  init: number[][],
  config: LayoutConfig,
  rng: () => number,
): number[][] {
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(config.umapNeighbors, Math.max(2, data.length - 1)),
    minDist: config.umapMinDist,
    random: rng,
  });

  const nEpochs = umap.initializeFit(data);

  const internals = umap as unknown as UmapInternals;
  if (!Array.isArray(internals.embedding)) {
    throw new Error(
      'umap-js no longer exposes an `embedding` array; PCA initialisation cannot be applied. ' +
        'Either restore the injection or switch LAYOUT_CONFIG.strategy to "pca3".',
    );
  }

  const embedding = internals.embedding;
  for (let i = 0; i < embedding.length; i++) {
    const target = embedding[i] as number[];
    const source = init[i];
    if (!source) continue;
    for (let d = 0; d < target.length; d++) {
      target[d] = source[d] ?? 0;
    }
  }

  for (let epoch = 0; epoch < nEpochs; epoch++) umap.step();

  return internals.embedding.map((row) => [row[0] ?? 0, row[1] ?? 0, row[2] ?? 0]);
}
