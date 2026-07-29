import { describe, expect, it } from 'vitest';
import {
  MIN_SIM,
  buildInvertedIndex,
  quantise,
  toSparseRows,
  topKAll,
  topKFor,
  type Neighbor,
} from './similarity';

/** Dense reference implementation, kept only so the sparse one can be checked
 *  against something obviously correct. This is the whole reason the sparse
 *  version is trustworthy: it is an optimisation, and an optimisation with no
 *  oracle is just a rewrite you hope works. */
function denseTopK(matrix: number[][], row: number, k: number): Neighbor[] {
  const a = matrix[row] as number[];
  const out: Neighbor[] = [];
  for (let r = 0; r < matrix.length; r++) {
    if (r === row) continue;
    const b = matrix[r] as number[];
    let score = 0;
    for (let c = 0; c < a.length; c++) score += (a[c] as number) * (b[c] as number);
    if (score > 0) out.push({ index: r, score });
  }
  out.sort((x, y) => y.score - x.score || x.index - y.index);
  return out.slice(0, k);
}

/** Deterministic pseudo-sparse matrix. Seeded arithmetic rather than
 *  `Math.random`, so a failure is reproducible. */
function fixtureMatrix(rows: number, cols: number): number[][] {
  const out: number[][] = [];
  let state = 12345;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let r = 0; r < rows; r++) {
    const row = new Array<number>(cols).fill(0);
    for (let c = 0; c < cols; c++) {
      if (next() < 0.12) row[c] = Math.round(next() * 1000) / 1000;
    }
    out.push(row);
  }
  return out;
}

describe('topKFor', () => {
  const matrix = fixtureMatrix(60, 40);
  const rows = toSparseRows(matrix);
  const index = buildInvertedIndex(rows);

  it('agrees with a dense all-pairs dot product on every row', () => {
    for (let r = 0; r < matrix.length; r++) {
      const sparse = topKFor(rows, index, r, 8);
      const dense = denseTopK(matrix, r, 8);
      expect(sparse.map((n) => n.index)).toEqual(dense.map((n) => n.index));
      sparse.forEach((n, i) => {
        expect(n.score).toBeCloseTo((dense[i] as Neighbor).score, 10);
      });
    }
  });

  it('never returns the row itself', () => {
    for (let r = 0; r < matrix.length; r++) {
      expect(topKFor(rows, index, r, 20).some((n) => n.index === r)).toBe(false);
    }
  });

  it('returns scores in descending order', () => {
    for (let r = 0; r < matrix.length; r++) {
      const scores = topKFor(rows, index, r, 10).map((n) => n.score);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1] as number).toBeGreaterThanOrEqual(scores[i] as number);
      }
    }
  });

  it('breaks ties by ascending index rather than by Map order', () => {
    // Two identical rows tie exactly against a third; without the tiebreak the
    // result would depend on hash iteration order and the bake would not be
    // reproducible.
    const tied = [
      [1, 0],
      [1, 0],
      [1, 0],
    ];
    const r = toSparseRows(tied);
    const i = buildInvertedIndex(r);
    expect(topKFor(r, i, 2, 2).map((n) => n.index)).toEqual([0, 1]);
  });

  it('handles an all-zero row without throwing', () => {
    const withZero = [[0, 0, 0], [1, 1, 0], [0, 1, 1]];
    const r = toSparseRows(withZero);
    const i = buildInvertedIndex(r);
    expect(topKFor(r, i, 0, 5)).toEqual([]);
  });
});

describe('topKAll', () => {
  it('drops neighbours below the similarity floor rather than padding to K', () => {
    // Row 0 is strongly similar to row 1 and barely similar to row 2. Padding a
    // list to K with weak matches is exactly how a graph fills with nonsense, so
    // shorter lists are the correct output.
    const matrix = [
      [1, 0.01, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
    const all = topKAll(matrix, 8);
    expect((all[0] as Neighbor[]).map((n) => n.index)).toEqual([1]);
    for (const list of all) {
      for (const n of list) expect(n.score).toBeGreaterThanOrEqual(MIN_SIM);
    }
  });

  it('produces one list per row', () => {
    const matrix = fixtureMatrix(25, 30);
    expect(topKAll(matrix, 5)).toHaveLength(25);
  });
});

describe('quantise', () => {
  it('rounds to 3dp and preserves order', () => {
    const quantised = quantise([
      [
        { index: 3, score: 0.123456 },
        { index: 9, score: 0.1 },
      ],
    ]);
    expect(quantised).toEqual([
      [
        [3, 0.123],
        [9, 0.1],
      ],
    ]);
  });
});
