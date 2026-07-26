import { PCA } from 'ml-pca';
import type { LayoutConfig } from './config';

export interface ReduceResult {
  coords: number[][];
  /** Share of variance captured by the first three components. Below ~0.12 the
   *  corpus tags are too sparse for the layout to mean much, and the build
   *  script warns. */
  explainedVariance3: number;
  usedRandomProjection: boolean;
}

/** Cell count above which a dense SVD is not viable. ml-pca goes through
 *  ml-matrix on a dense matrix; at 5000x20000 that is hundreds of megabytes of
 *  doubles and an SVD that will not finish. */
const DENSE_CELL_LIMIT = 3_000_000;

/** Seeded sparse random projection (Achlioptas, s = 3).
 *  O(n * nnz * k), deterministic given the PRNG, and preserves cosine distances
 *  closely enough at k = 128 to serve as a UMAP pre-step. */
export function sparseRandomProjection(
  matrix: number[][],
  targetDims: number,
  rng: () => number,
): number[][] {
  const inputDims = matrix[0]?.length ?? 0;
  const scale = Math.sqrt(3);

  // Build the projection column-major so the same PRNG draws happen regardless
  // of row count.
  const projection: Array<Array<{ col: number; sign: number }>> = [];
  for (let d = 0; d < inputDims; d++) {
    const entries: Array<{ col: number; sign: number }> = [];
    for (let k = 0; k < targetDims; k++) {
      const r = rng();
      if (r < 1 / 6) entries.push({ col: k, sign: scale });
      else if (r < 2 / 6) entries.push({ col: k, sign: -scale });
    }
    projection.push(entries);
  }

  const norm = 1 / Math.sqrt(targetDims);
  return matrix.map((row) => {
    const out = new Array<number>(targetDims).fill(0);
    for (let d = 0; d < inputDims; d++) {
      const v = row[d] as number;
      if (v === 0) continue;
      for (const { col, sign } of projection[d] as Array<{ col: number; sign: number }>) {
        out[col] = (out[col] as number) + v * sign;
      }
    }
    for (let k = 0; k < targetDims; k++) out[k] = (out[k] as number) * norm;
    return out;
  });
}

export function reduceDims(
  matrix: number[][],
  config: LayoutConfig,
  rng: () => number,
): ReduceResult {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  if (rows === 0 || cols === 0) {
    return { coords: matrix.map(() => [0, 0, 0]), explainedVariance3: 0, usedRandomProjection: false };
  }

  let working = matrix;
  let usedRandomProjection = false;
  if (rows * cols > DENSE_CELL_LIMIT) {
    working = sparseRandomProjection(matrix, 128, rng);
    usedRandomProjection = true;
  }

  const nComponents = Math.min(config.intermediateDims, working.length, working[0]?.length ?? 1);

  // scale: false is deliberate. Scaling divides by per-feature standard
  // deviation, which for near-binary sparse features massively inflates the
  // rare tags we just pruned for exactly that reason.
  const pca = new PCA(working, { center: true, scale: false });
  const coords = pca.predict(working, { nComponents }).to2DArray();

  const variance = pca.getExplainedVariance();
  const explainedVariance3 = variance.slice(0, 3).reduce((a, b) => a + b, 0);

  return { coords, explainedVariance3, usedRandomProjection };
}

/** First three PCA columns, rescaled to the working scale UMAP expects.
 *  Used as the UMAP initialisation so the global arrangement is reproducibly
 *  PCA-shaped instead of seed noise. */
export function initialThreeD(coords: number[][], targetStd = 5): number[][] {
  const pick = coords.map((row) => [row[0] ?? 0, row[1] ?? 0, row[2] ?? 0]);
  for (let axis = 0; axis < 3; axis++) {
    const values = pick.map((r) => r[axis] as number);
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1);
    const std = Math.sqrt(variance);
    const factor = std > 1e-12 ? targetStd / std : 0;
    for (const row of pick) row[axis] = ((row[axis] as number) - mean) * factor;
  }
  return pick;
}
