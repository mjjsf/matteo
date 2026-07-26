import type { Book, TagMap, TaxonomyIndex } from '@/domain/types';
import { primaryRootForBook } from '@/domain/taxonomy';
import { buildFeatureMatrix, weakestBooks, type FeatureMatrix } from './features';
import { initialThreeD, reduceDims } from './reduce';
import { runUmap } from './umapLayout';
import { separateCoincident, taxonomyAttraction, type Vec3 } from './relax';
import { extentOf, fitToRadius } from './normalize';
import { mulberry32 } from './prng';
import type { LayoutConfig } from './config';

export interface LayoutResult {
  positions: Vec3[];
  bookIds: string[];
  features: FeatureMatrix;
  explainedVariance3: number;
  usedRandomProjection: boolean;
  weakest: Array<{ id: string; norm: number }>;
}

/** Turn a corpus into 3D coordinates.
 *
 *  Strategy notes (all three are switchable in config so they can be compared
 *  by eye, but `hybrid` is the default):
 *   - `pca3` is honest but flat: at a few hundred books with sparse tags the
 *     first three components explain little variance and everything piles near
 *     the origin.
 *   - `umap` alone looks crisper but the global arrangement is seed noise, so it
 *     shows structure that isn't there — actively misleading in a discovery tool.
 *   - `hybrid` seeds UMAP from PCA, then relaxes toward taxonomy branches. Local
 *     neighbourhoods come from UMAP, global shape is reproducibly variance-based,
 *     and the result agrees with the taxonomy the user navigates by.
 *
 *  No general n-body repulsion pass: it is the tempting addition and it washes
 *  out exactly the density information the layout exists to show. A tight
 *  cluster should look tight. */
export function computeLayout(
  books: Book[],
  tagMap: TagMap,
  index: TaxonomyIndex,
  config: LayoutConfig,
): LayoutResult {
  const rng = mulberry32(config.seed);
  const features = buildFeatureMatrix(books, tagMap, index, config);
  const { coords, explainedVariance3, usedRandomProjection } = reduceDims(
    features.matrix,
    config,
    rng,
  );

  const pca3 = initialThreeD(coords);

  let points: Vec3[];
  if (config.strategy === 'pca3') {
    points = pca3.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] as Vec3);
  } else if (books.length <= config.umapNeighbors + 1) {
    // UMAP throws when there are not more points than neighbours. Small corpora
    // fall back rather than failing the build.
    points = pca3.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] as Vec3);
  } else {
    const init = config.strategy === 'hybrid' ? pca3 : coords.map(() => [0, 0, 0]);
    const embedded = runUmap(coords, init, config, rng);
    points = embedded.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] as Vec3);
  }

  if (config.strategy !== 'umap') {
    const branchOf = books.map((b) => primaryRootForBook(b, tagMap, index));
    points = taxonomyAttraction(
      points,
      branchOf,
      config.attractionIterations,
      config.attractionGamma,
    );
  }

  const extent = extentOf(points) || 1;
  points = separateCoincident(points, rng, extent * config.minSeparationFraction);
  points = fitToRadius(points, config.radius);

  return {
    positions: points,
    bookIds: books.map((b) => b.id),
    features,
    explainedVariance3,
    usedRandomProjection,
    weakest: weakestBooks(books, features, 20),
  };
}

/** Flatten to the committed artifact form, rounded to 4dp. */
export function flattenPositions(points: Vec3[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(round4(p[0]), round4(p[1]), round4(p[2]));
  }
  return out;
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
