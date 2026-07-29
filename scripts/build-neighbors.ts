/** Bakes the top-K similar-books table the graph grows along.
 *
 *  Run with: npm run neighbors
 *
 *  Like the layout artifact it replaces, this is committed and guarded by an
 *  input hash, so a corpus edit without a re-bake fails a test rather than
 *  shipping neighbours that no longer match the books. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTaxonomyIndex, populateMembers } from '@/domain/taxonomy';
import { loadCorpusForLayout, loadTagMap, loadTaxonomyFile } from '@/domain/fixtures';
import { FEATURE_CONFIG, buildFeatureMatrix } from '@/domain/features';
import { inputHash } from '@/domain/hash';
import { quantise, topKAll, type NeighborsFile } from '@/domain/similarity';

const GENERATED_DIR = fileURLToPath(new URL('../src/generated/', import.meta.url));

/** How many neighbours to bake per book. The UI shows fewer per expansion; the
 *  surplus lets it skip books already on screen without running out. */
export const NEIGHBOR_K = 16;

function main(): void {
  const taxonomyFile = loadTaxonomyFile();
  const tagMap = loadTagMap();
  const books = loadCorpusForLayout();
  const index = populateMembers(buildTaxonomyIndex(taxonomyFile), books, tagMap);

  console.log(`corpus: ${books.length} books`);

  const started = Date.now();
  const features = buildFeatureMatrix(books, tagMap, index, FEATURE_CONFIG);
  console.log(
    `features: ${features.vocab.length} kept, ${features.prunedCount} pruned (df < ${FEATURE_CONFIG.minDf})`,
  );

  const neighbors = topKAll(features.matrix, NEIGHBOR_K);
  const elapsed = Date.now() - started;

  // Diagnostics that matter for the graph: a book with no neighbours is a dead
  // end the user can reach and not get out of.
  const empty = neighbors.filter((n) => n.length === 0).length;
  const thin = neighbors.filter((n) => n.length > 0 && n.length < 8).length;
  const meanTop = neighbors.reduce((a, n) => a + (n[0]?.score ?? 0), 0) / (books.length || 1);
  console.log(`neighbours: k=${NEIGHBOR_K}, computed in ${elapsed}ms`);
  console.log(`  dead ends (0 neighbours): ${empty}`);
  console.log(`  thin (<8 neighbours):     ${thin}`);
  console.log(`  mean best-match score:    ${meanTop.toFixed(3)}`);

  if (empty > 0) {
    console.warn(
      `\n  WARNING: ${empty} book(s) have no similar books at all. The graph cannot\n` +
        '  branch from them — they are dead ends if a user seeds there. Give them\n' +
        '  tags that overlap the rest of the corpus.\n',
    );
    for (const [i, list] of neighbors.entries()) {
      if (list.length === 0) console.warn(`    ${books[i]?.id}`);
    }
  }

  const file: NeighborsFile = {
    version: 1,
    inputHash: inputHash({
      corpus: books,
      taxonomy: taxonomyFile,
      tagMap,
      config: { ...FEATURE_CONFIG, k: NEIGHBOR_K },
    }),
    k: NEIGHBOR_K,
    bookIds: books.map((b) => b.id),
    neighbors: quantise(neighbors),
  };

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(`${GENERATED_DIR}corpus.json`, `${JSON.stringify(books)}\n`);
  writeFileSync(`${GENERATED_DIR}neighbors.json`, `${JSON.stringify(file)}\n`);

  console.log(`\nwrote src/generated/corpus.json (${books.length} books)`);
  console.log('wrote src/generated/neighbors.json');
}

main();
