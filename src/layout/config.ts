import type { LayoutStrategy } from '@/domain/types';

export interface LayoutConfig {
  seed: number;
  strategy: LayoutStrategy;
  /** Tags/authors appearing in fewer than this many books are dropped.
   *  A feature on exactly one book cannot make two books similar, yet IDF gives
   *  it the highest weight — so hapax features dominate their book's vector and
   *  fling it to the periphery. Pruning matters more than the choice of
   *  reducer. */
  minDf: number;
  /** Relative weight of the author block. 0.4 makes same-author books
   *  noticeably adjacent without letting a prolific author form an isolated pod
   *  that visually outranks every subject relationship — wrong for a *subject*
   *  discovery tool. */
  authorWeight: number;
  /** Relative weight of the taxonomy-ancestor block. Without this the tree's
   *  anchors are meaningless: a book tagged `cyberpunk, dystopia` could land
   *  nowhere near the rest of speculative fiction. */
  taxonomyWeight: number;
  /** Intermediate dimensionality before the 3D reduction. */
  intermediateDims: number;
  /** Taxonomy-attraction iterations and per-iteration pull.
   *
   *  These compound: total pull toward the branch centroid is
   *  `1 - (1 - gamma)^iterations`, NOT `gamma`. That is easy to get badly wrong
   *  — gamma 0.12 over 40 iterations is a 99.4% pull, i.e. a hard snap that
   *  collapses every branch to a single point. Measured with
   *  `scripts/compare-layouts.ts` on the seed corpus (8 branches, 13.5% random
   *  baseline):
   *
   *    gamma   total pull   purity@10   within/overall spread
   *    0.000        0.00       64.0%          0.745
   *    0.008        0.275      74.7%          0.633
   *    0.015        0.454      81.3%          0.527   <- chosen
   *    0.030        0.704      94.1%          0.320
   *    0.060        0.916     100.0%          0.096   collapsing
   *    0.120        0.994     100.0%          0.013   fully collapsed
   *
   *  100% purity is a symptom of collapse, not a win: if a branch is a single
   *  point then every neighbour trivially shares it. 0.015 keeps strong grouping
   *  (6x the random baseline) while branches retain about half the spread of the
   *  whole cloud, so they read as lobes with internal structure rather than
   *  eight dots. Re-run the comparison script after changing either value. */
  attractionIterations: number;
  attractionGamma: number;
  /** UMAP parameters. */
  umapNeighbors: number;
  umapMinDist: number;
  /** Target 98th-percentile radius of the final cloud. The 98th percentile
   *  rather than the max so a single outlier cannot shrink everything else,
   *  which keeps default camera framing stable as the corpus grows. */
  radius: number;
  /** Minimum separation between points, as a fraction of the extent. */
  minSeparationFraction: number;
}

export const LAYOUT_CONFIG: LayoutConfig = {
  seed: 20260726,
  strategy: 'hybrid',
  minDf: 2,
  authorWeight: 0.4,
  taxonomyWeight: 0.55,
  intermediateDims: 30,
  attractionIterations: 40,
  attractionGamma: 0.015,
  umapNeighbors: 15,
  umapMinDist: 0.1,
  radius: 50,
  minSeparationFraction: 0.004,
};
