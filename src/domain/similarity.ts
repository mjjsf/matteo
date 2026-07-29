/** Book-to-book similarity, and the top-K neighbour table the graph grows along.
 *
 *  Why a plain dot product is a valid similarity here: `buildFeatureMatrix`
 *  L2-normalises each of its three blocks (subjects / authors / taxonomy
 *  ancestors) INDEPENDENTLY before scaling them by their block weights. Every row
 *  therefore has the same norm profile, so dot products are directly comparable
 *  between pairs without renormalising. */

/** One row of the feature matrix, compressed to its non-zero entries.
 *  Rows average ~12 non-zeros out of hundreds of columns. */
export interface SparseRow {
  indices: number[];
  values: number[];
}

export interface Neighbor {
  /** Index into the book array. */
  index: number;
  /** Dot-product similarity, higher is closer. */
  score: number;
}

export function toSparseRows(matrix: number[][]): SparseRow[] {
  return matrix.map((row) => {
    const indices: number[] = [];
    const values: number[] = [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c] as number;
      if (v !== 0) {
        indices.push(c);
        values.push(v);
      }
    }
    return { indices, values };
  });
}

/** Column -> list of (row, value) postings. */
export interface InvertedIndex {
  postings: Map<number, Array<{ row: number; value: number }>>;
}

export function buildInvertedIndex(rows: SparseRow[]): InvertedIndex {
  const postings = new Map<number, Array<{ row: number; value: number }>>();
  for (let r = 0; r < rows.length; r++) {
    const { indices, values } = rows[r] as SparseRow;
    for (let k = 0; k < indices.length; k++) {
      const col = indices[k] as number;
      let list = postings.get(col);
      if (!list) {
        list = [];
        postings.set(col, list);
      }
      list.push({ row: r, value: values[k] as number });
    }
  }
  return { postings };
}

/** Top-K most similar rows to `row`, excluding itself.
 *
 *  Sparse accumulation via the inverted index rather than a dense all-pairs
 *  cosine. Dense would be N² × D multiply-adds — at the 3000-book target with a
 *  ~2500-column vocabulary that is ~2×10^10 operations and minutes of build time.
 *  Here the cost is (non-zeros in the row) × (average posting-list length), which
 *  is seconds.
 *
 *  Ties are broken by ascending index so the result is deterministic regardless
 *  of Map iteration order. */
export function topKFor(
  rows: SparseRow[],
  index: InvertedIndex,
  row: number,
  k: number,
): Neighbor[] {
  const target = rows[row];
  if (!target) return [];

  const scores = new Map<number, number>();
  for (let i = 0; i < target.indices.length; i++) {
    const col = target.indices[i] as number;
    const weight = target.values[i] as number;
    if (weight === 0) continue;
    for (const posting of index.postings.get(col) ?? []) {
      if (posting.row === row) continue;
      scores.set(posting.row, (scores.get(posting.row) ?? 0) + weight * posting.value);
    }
  }

  const out: Neighbor[] = [];
  for (const [otherRow, score] of scores) {
    if (score > 0) out.push({ index: otherRow, score });
  }
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out.slice(0, k);
}

/** Similarity floor. Because the taxonomy block carries weight and includes
 *  ANCESTORS, two books sharing only a top-level branch score above zero — so
 *  without a floor a sparsely-tagged seed branches to eight arbitrary books that
 *  merely happen to be Fiction. Lists are variable length by design: padding to K
 *  with weak matches is exactly how a graph fills with nonsense. */
export const MIN_SIM = 0.1;

export function topKAll(matrix: number[][], k: number, minSim = MIN_SIM): Neighbor[][] {
  const rows = toSparseRows(matrix);
  const index = buildInvertedIndex(rows);
  return rows.map((_, r) => topKFor(rows, index, r, k).filter((n) => n.score >= minSim));
}

/** Baked artifact shape. Scores are quantised to 3dp — they are only used for
 *  ordering and for a mild distance cue, so full float precision is wasted bytes. */
export interface NeighborsFile {
  version: number;
  inputHash: string;
  k: number;
  bookIds: string[];
  /** Parallel to `bookIds`; each entry is that book's neighbours, best first. */
  neighbors: Array<Array<[number, number]>>;
}

export function quantise(neighbors: Neighbor[][]): Array<Array<[number, number]>> {
  return neighbors.map((list) =>
    list.map((n) => [n.index, Math.round(n.score * 1000) / 1000] as [number, number]),
  );
}
