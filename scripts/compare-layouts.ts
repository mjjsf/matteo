/** Diagnostic: compare layout strategies on measurable quality, so the choice
 *  is made with numbers rather than by eye alone.
 *
 *  Run with: npx vite-node scripts/compare-layouts.ts
 *
 *  Metrics:
 *   - neighbourhood purity: of each book's k nearest neighbours in 3D, the
 *     fraction sharing its primary taxonomy branch. This is the thing the
 *     visualisation actually claims — "nearby means related" — so it is the
 *     honest measure of whether the layout means anything. A random layout
 *     scores around the branch base rate.
 *   - coincident pairs: points closer than a hair apart, which would be
 *     unpickable.
 *   - occupancy: fraction of a coarse voxel grid that contains any point, i.e.
 *     whether the cloud fills space or collapses into a few clumps. */
import { buildTaxonomyIndex, populateMembers, primaryRootForBook } from '@/domain/taxonomy';
import { loadSeedCorpus, loadTagMap, loadTaxonomyFile } from '@/domain/fixtures';
import { LAYOUT_CONFIG } from '@/layout/config';
import { computeLayout } from '@/layout/pipeline';
import type { LayoutStrategy } from '@/domain/types';
import type { Vec3 } from '@/layout/relax';

const books = loadSeedCorpus();
const tagMap = loadTagMap();
const index = populateMembers(buildTaxonomyIndex(loadTaxonomyFile()), books, tagMap);
const branchOf = books.map((b) => primaryRootForBook(b, tagMap, index));

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
      dists.push({
        j,
        d: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2,
      });
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

function baseRate(): number {
  // Expected purity of a random layout: sum of squared branch shares.
  const counts = new Map<string, number>();
  for (const b of branchOf) if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  let sum = 0;
  for (const c of counts.values()) sum += (c / n) ** 2;
  return sum;
}

function coincidentPairs(points: Vec3[], eps: number): number {
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const p = points[i] as Vec3;
      const q = points[j] as Vec3;
      if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < eps) count++;
    }
  }
  return count;
}

function occupancy(points: Vec3[], divisions = 12): number {
  const cells = new Set<string>();
  const r = LAYOUT_CONFIG.radius;
  for (const p of points) {
    const cx = Math.floor(((p[0] + r) / (2 * r)) * divisions);
    const cy = Math.floor(((p[1] + r) / (2 * r)) * divisions);
    const cz = Math.floor(((p[2] + r) / (2 * r)) * divisions);
    cells.add(`${cx},${cy},${cz}`);
  }
  return cells.size / points.length;
}

const strategies: LayoutStrategy[] = ['pca3', 'umap', 'hybrid'];
console.log(`corpus: ${books.length} books, ${index.rootIds.length} branches`);
console.log(`random-layout purity baseline: ${(baseRate() * 100).toFixed(1)}%\n`);

const rows: Array<Record<string, string>> = [];
for (const strategy of strategies) {
  const config = { ...LAYOUT_CONFIG, strategy };
  const started = Date.now();
  const result = computeLayout(books, tagMap, index, config);
  const ms = Date.now() - started;
  rows.push({
    strategy,
    'purity k=10': `${(neighbourhoodPurity(result.positions, 10) * 100).toFixed(1)}%`,
    'purity k=25': `${(neighbourhoodPurity(result.positions, 25) * 100).toFixed(1)}%`,
    'coincident': String(coincidentPairs(result.positions, 0.05)),
    'distinct cells/pt': occupancy(result.positions).toFixed(3),
    'variance top3': `${(result.explainedVariance3 * 100).toFixed(1)}%`,
    ms: String(ms),
  });
}
console.table(rows);

// Also: does the attraction pass matter, and does the seed change the result?
console.log('\nsensitivity checks (hybrid):');
for (const gamma of [0, 0.06, 0.12, 0.2, 0.3]) {
  const result = computeLayout(books, tagMap, index, {
    ...LAYOUT_CONFIG,
    strategy: 'hybrid',
    attractionGamma: gamma,
  });
  console.log(
    `  gamma ${String(gamma).padEnd(5)} -> purity k=10 ${(
      neighbourhoodPurity(result.positions, 10) * 100
    ).toFixed(1)}%  occupancy ${occupancy(result.positions).toFixed(3)}`,
  );
}
for (const seed of [LAYOUT_CONFIG.seed, LAYOUT_CONFIG.seed + 1]) {
  const result = computeLayout(books, tagMap, index, { ...LAYOUT_CONFIG, seed });
  console.log(
    `  seed ${seed} -> purity k=10 ${(neighbourhoodPurity(result.positions, 10) * 100).toFixed(1)}%`,
  );
}
