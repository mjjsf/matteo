import { describe, expect, it } from 'vitest';
import { buildTaxonomyIndex, populateMembers, primaryRootForBook } from '@/domain/taxonomy';
import { loadSeedCorpus, loadTagMap, loadTaxonomyFile } from '@/domain/fixtures';
import { LAYOUT_CONFIG } from './config';
import { computeLayout, flattenPositions } from './pipeline';
import type { Vec3 } from './relax';

const books = loadSeedCorpus();
const tagMap = loadTagMap();
const index = populateMembers(buildTaxonomyIndex(loadTaxonomyFile()), books, tagMap);
const branchOf = books.map((b) => primaryRootForBook(b, tagMap, index));

const result = computeLayout(books, tagMap, index, LAYOUT_CONFIG);

function neighbourhoodPurity(points: Vec3[], k: number): number {
  let total = 0;
  let counted = 0;
  for (let i = 0; i < points.length; i++) {
    const mine = branchOf[i];
    if (!mine) continue;
    const p = points[i] as Vec3;
    const dists: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < points.length; j++) {
      if (j === i) continue;
      const q = points[j] as Vec3;
      dists.push({ j, d: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 });
    }
    dists.sort((a, b) => a.d - b.d);
    let same = 0;
    for (let n = 0; n < k; n++) {
      const nb = dists[n];
      if (nb && branchOf[nb.j] === mine) same++;
    }
    total += same / k;
    counted++;
  }
  return counted > 0 ? total / counted : 0;
}

/** Mean within-branch spread relative to overall spread. Near 0 means each
 *  branch has collapsed to a point. */
function spreadRatio(points: Vec3[]): number {
  const groups = new Map<string, Vec3[]>();
  for (let i = 0; i < points.length; i++) {
    const b = branchOf[i];
    if (!b) continue;
    const list = groups.get(b) ?? [];
    list.push(points[i] as Vec3);
    groups.set(b, list);
  }
  const rms = (pts: Vec3[]): number => {
    if (pts.length === 0) return 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    cx /= pts.length;
    cy /= pts.length;
    cz /= pts.length;
    let s = 0;
    for (const p of pts) s += (p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2;
    return Math.sqrt(s / pts.length);
  };
  const overall = rms(points);
  let weighted = 0;
  let total = 0;
  for (const pts of groups.values()) {
    weighted += rms(pts) * pts.length;
    total += pts.length;
  }
  return overall > 0 ? weighted / total / overall : 0;
}

describe('computeLayout', () => {
  it('produces one 3D point per book', () => {
    expect(result.positions).toHaveLength(books.length);
    expect(result.bookIds).toEqual(books.map((b) => b.id));
    for (const p of result.positions) expect(p).toHaveLength(3);
  });

  it('produces only finite coordinates', () => {
    for (const [i, p] of result.positions.entries()) {
      for (const v of p) {
        expect(Number.isFinite(v), `book ${books[i]?.id} has non-finite coordinate`).toBe(true);
      }
    }
  });

  it('is deterministic for a fixed seed', () => {
    const again = computeLayout(books, tagMap, index, LAYOUT_CONFIG);
    expect(again.positions).toEqual(result.positions);
  });

  it('actually uses the seed', () => {
    // Guards the failure mode where the PRNG is accidentally ignored and the
    // layout silently stops being reproducible.
    const different = computeLayout(books, tagMap, index, {
      ...LAYOUT_CONFIG,
      seed: LAYOUT_CONFIG.seed + 1,
    });
    expect(different.positions).not.toEqual(result.positions);
  });

  it('scales so the 98th-percentile radius matches the configured radius', () => {
    const radii = result.positions
      .map((p) => Math.hypot(p[0], p[1], p[2]))
      .sort((a, b) => a - b);
    const idx = Math.floor(0.98 * (radii.length - 1));
    expect(radii[idx]).toBeCloseTo(LAYOUT_CONFIG.radius, 3);
  });

  it('separates coincident points so every book is pickable', () => {
    // Books with identical tag sets and authors would otherwise share exact
    // coordinates, making only one of them selectable.
    const minSep = LAYOUT_CONFIG.radius * LAYOUT_CONFIG.minSeparationFraction * 0.5;
    let tooClose = 0;
    for (let i = 0; i < result.positions.length; i++) {
      for (let j = i + 1; j < result.positions.length; j++) {
        const p = result.positions[i] as Vec3;
        const q = result.positions[j] as Vec3;
        if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < minSep) tooClose++;
      }
    }
    expect(tooClose).toBe(0);
  });

  it('groups books by taxonomy branch far better than chance', () => {
    // Random baseline for this corpus is ~13.5% (sum of squared branch shares).
    // This is the claim the visualisation makes — "nearby means related" — so it
    // is worth asserting rather than trusting.
    expect(neighbourhoodPurity(result.positions, 10)).toBeGreaterThan(0.6);
  });

  it('does not collapse branches into points', () => {
    // The counterpart to the purity test, and the more important one: 100%
    // purity is trivially achievable by collapsing each branch to a single
    // position, which would destroy all internal structure. Branches must keep
    // a substantial share of the cloud's spread.
    const ratio = spreadRatio(result.positions);
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.95);
  });

  it('reports diagnostics', () => {
    expect(result.explainedVariance3).toBeGreaterThan(0);
    expect(result.features.vocab.length).toBeGreaterThan(0);
    expect(result.weakest.length).toBeGreaterThan(0);
  });

  it('falls back gracefully for a corpus too small for UMAP', () => {
    const few = books.slice(0, 5);
    const small = computeLayout(few, tagMap, index, LAYOUT_CONFIG);
    expect(small.positions).toHaveLength(5);
    for (const p of small.positions) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });

  it('supports every strategy without producing NaN', () => {
    for (const strategy of ['pca3', 'umap', 'hybrid'] as const) {
      const r = computeLayout(books, tagMap, index, { ...LAYOUT_CONFIG, strategy });
      for (const p of r.positions) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('flattenPositions', () => {
  it('flattens to xyz triples rounded to 4dp', () => {
    const flat = flattenPositions([
      [1.234567, -2.345678, 3.456789],
      [0, 0, 0],
    ]);
    expect(flat).toEqual([1.2346, -2.3457, 3.4568, 0, 0, 0]);
  });

  it('matches three times the point count for the real layout', () => {
    expect(flattenPositions(result.positions)).toHaveLength(books.length * 3);
  });
});
