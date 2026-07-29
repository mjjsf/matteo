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
import { quantise, topKAll, type Neighbor, type NeighborsFile } from '@/domain/similarity';
import type { Book } from '@/domain/types';

const GENERATED_DIR = fileURLToPath(new URL('../src/generated/', import.meta.url));

/** How many neighbours to bake per book. The UI shows fewer per expansion; the
 *  surplus lets it skip books already on screen without running out. */
export const NEIGHBOR_K = 16;

/** How many of a book's top neighbours are worth reporting on. */
const QUALITY_K = 8;
/** How many weakly-connected books to name. */
const WEAKEST_N = 10;

/** Diagnostics that are unambiguous, and a note on the ones that are not.
 *
 *  **Subject overlap** — the share of a book's top neighbours that share an
 *  actual subject tag, rather than being matched on broad taxonomy-ancestor
 *  overlap alone. Ancestor-only matches are the weakest thing the model can
 *  produce, so this should sit at or very near 1.0.
 *
 *  **Weakest seeds** — books whose best match is poor. These are the seeds where
 *  someone will land and get a disappointing map, and the fix is always the
 *  same: give the book tags that overlap the rest of the corpus.
 *
 *  Deliberately NOT here: an automated judgement of whether a recommendation is
 *  *good*. Two were tried and both produced mostly false positives.
 *
 *   - Comparing each book's primary root against its neighbours' flagged
 *     *Mrs Dalloway → To the Lighthouse*, which is a perfect match;
 *     `primaryRootForBook` is a crude count over a multi-tag book.
 *   - Aggregating the same idea per tag flagged `colonialism` for mapping into
 *     history while most of its books are novels — which is correct behaviour,
 *     and precisely how a novel about empire finds the history of empire.
 *
 *  The real bug this was chasing — `court-politics` mapped to epic fantasy,
 *  making *Wolf Hall*'s nearest books *Elantris* and *The Curse of Chalion* —
 *  was found by reading the lists, and that remains the method. A noisy gate
 *  would be worse than none, because it trains you to skip the output. */
function reportQuality(books: Book[], neighbors: Neighbor[][]): void {
  let subjectSum = 0;
  let counted = 0;

  books.forEach((book, i) => {
    const list = neighbors[i]?.slice(0, QUALITY_K) ?? [];
    if (list.length === 0) return;
    counted++;
    const mine = new Set(book.subjects);
    subjectSum +=
      list.filter((n) => (books[n.index] as Book).subjects.some((s) => mine.has(s))).length /
      list.length;
  });

  if (counted > 0) {
    console.log(`  subject overlap (top-${QUALITY_K}): ${(subjectSum / counted).toFixed(3)}`);
  }

  const weakest = books
    .map((b, i) => ({ id: b.id, score: neighbors[i]?.[0]?.score ?? 0 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, WEAKEST_N);

  console.log(`\n  weakest seeds — a reader landing here gets a thin map:`);
  for (const w of weakest) console.log(`    ${w.score.toFixed(2)}  ${w.id}`);
}

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

  reportQuality(books, neighbors);

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
