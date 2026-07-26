/** Bakes the 3D layout into `src/generated/`.
 *
 *  Run with: npm run layout
 *
 *  Deliberately NOT wired as a `prebuild` hook. The coordinates are a committed
 *  artifact, so the build stays a pure function of the repo and a layout change
 *  shows up as a reviewable diff. Staleness is caught by the freshness test
 *  instead of papered over by regenerating on every build. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildTaxonomyIndex, populateMembers } from '@/domain/taxonomy';
import {
  loadCorpusForLayout,
  loadTagMap,
  loadTaxonomyFile,
} from '@/domain/fixtures';
import { LAYOUT_CONFIG } from '@/layout/config';
import { computeLayout, flattenPositions } from '@/layout/pipeline';
import { inputHash } from '@/layout/hash';
import type { Book, LayoutFile } from '@/domain/types';

const GENERATED_DIR = new URL('../src/generated/', import.meta.url).pathname;

function main(): void {
  const taxonomyFile = loadTaxonomyFile();
  const tagMap = loadTagMap();
  const books: Book[] = loadCorpusForLayout();

  const index = populateMembers(buildTaxonomyIndex(taxonomyFile), books, tagMap);

  console.log(`corpus: ${books.length} books, ${Object.keys(tagMap).length} tags`);
  console.log(`taxonomy: ${index.byId.size} nodes, ${index.rootIds.length} roots`);
  console.log(`strategy: ${LAYOUT_CONFIG.strategy}, seed: ${LAYOUT_CONFIG.seed}`);

  const started = Date.now();
  const result = computeLayout(books, tagMap, index, LAYOUT_CONFIG);
  const elapsed = Date.now() - started;

  console.log(
    `features: ${result.features.vocab.length} kept, ${result.features.prunedCount} pruned (df < ${LAYOUT_CONFIG.minDf})`,
  );
  console.log(
    `top-3 explained variance: ${(result.explainedVariance3 * 100).toFixed(1)}%${
      result.usedRandomProjection ? ' (after random projection)' : ''
    }`,
  );
  if (result.explainedVariance3 < 0.12) {
    console.warn(
      '\n  WARNING: the first three components explain under 12% of variance.\n' +
        '  The corpus tags are probably too sparse for this layout to mean much.\n' +
        '  Adding more tags per book will help more than tuning the reducer.\n',
    );
  }

  console.log('\nweakest positioning signal (add tags to these):');
  for (const { id, norm } of result.weakest.slice(0, 10)) {
    console.log(`  ${norm.toFixed(4)}  ${id}`);
  }

  const layout: LayoutFile = {
    version: 1,
    inputHash: inputHash({
      corpus: books,
      taxonomy: taxonomyFile,
      tagMap,
      config: LAYOUT_CONFIG,
    }),
    config: {
      seed: LAYOUT_CONFIG.seed,
      strategy: LAYOUT_CONFIG.strategy,
      minDf: LAYOUT_CONFIG.minDf,
      authorWeight: LAYOUT_CONFIG.authorWeight,
      taxonomyWeight: LAYOUT_CONFIG.taxonomyWeight,
      radius: LAYOUT_CONFIG.radius,
    },
    bounds: { radius: LAYOUT_CONFIG.radius },
    positions: flattenPositions(result.positions),
    bookIds: result.bookIds,
    diagnostics: {
      explainedVariance3: Number(result.explainedVariance3.toFixed(6)),
      prunedTagCount: result.features.prunedCount,
      keptFeatureCount: result.features.vocab.length,
      weakestBooks: result.weakest.map((w) => ({
        id: w.id,
        norm: Number(w.norm.toFixed(4)),
      })),
    },
  };

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(`${GENERATED_DIR}corpus.json`, `${JSON.stringify(books, null, 2)}\n`);
  writeFileSync(`${GENERATED_DIR}layout.json`, `${JSON.stringify(layout)}\n`);

  console.log(`\nwrote src/generated/corpus.json (${books.length} books)`);
  console.log(`wrote src/generated/layout.json in ${elapsed}ms`);
}

main();
