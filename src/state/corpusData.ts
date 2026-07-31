import type { Book } from '@/domain/types';
import type { NeighborsFile } from '@/domain/similarity';
import type { GraphIndexFile } from '@/domain/graphIndex';

/** The two baked artifacts, as URLs rather than as bundled modules.
 *
 *  `?url` is the whole point. Importing the JSON directly inlines it into the JS
 *  bundle, which at 1016 books was 550KB of the 1.7MB the browser had to parse
 *  before anything rendered — and it grows linearly with the corpus. Fetched as
 *  assets instead, the code bundle stays flat however many books are added,
 *  the browser's JSON parser is faster than evaluating an equivalent object
 *  literal, and the data caches separately from the code so a code change does
 *  not re-download the corpus.
 *
 *  Vite hashes and rewrites these for whatever base the site is mounted at, so
 *  the relative-base deployment still works untouched. */
import corpusUrl from '@/generated/corpus.json?url';
import neighborsUrl from '@/generated/neighbors.json?url';
import graphIndexUrl from '@/generated/graph-index.json?url';

export interface CorpusData {
  books: Book[];
  neighbors: NeighborsFile;
  graphIndex: GraphIndexFile;
}

/** Fetch the corpus, its neighbour table, and the subject/author index.
 *
 *  All three requests are same-origin — the app still makes no external network
 *  calls of any kind, which is a property worth preserving. They go out in
 *  parallel, so the third artifact costs bandwidth but not a round trip. */
export async function fetchCorpusData(): Promise<CorpusData> {
  const [corpusRes, neighborsRes, graphIndexRes] = await Promise.all([
    fetch(corpusUrl),
    fetch(neighborsUrl),
    fetch(graphIndexUrl),
  ]);
  if (!corpusRes.ok) throw new Error(`corpus.json: HTTP ${corpusRes.status}`);
  if (!neighborsRes.ok) throw new Error(`neighbors.json: HTTP ${neighborsRes.status}`);
  if (!graphIndexRes.ok) throw new Error(`graph-index.json: HTTP ${graphIndexRes.status}`);

  const [books, neighbors, graphIndex] = await Promise.all([
    corpusRes.json() as Promise<Book[]>,
    neighborsRes.json() as Promise<NeighborsFile>,
    graphIndexRes.json() as Promise<GraphIndexFile>,
  ]);

  // A corpus edited without re-running `npm run neighbors` would otherwise show
  // up as recommendations that are subtly wrong rather than as an error. A test
  // guards the committed pair; this guards the pair actually served, which can
  // differ if someone deploys a half-updated build.
  if (neighbors.bookIds.length !== books.length) {
    throw new Error(
      `neighbours table is stale: ${neighbors.bookIds.length} entries for ${books.length} books. ` +
        'Run `npm run neighbors` and redeploy.',
    );
  }

  // Same reasoning as above, for the artifact that carries the subject
  // hierarchy: a mismatch here would show as branches into books that moved.
  if (graphIndex.inputHash !== neighbors.inputHash) {
    throw new Error(
      'graph index and neighbours were baked from different inputs. ' +
        'Run `npm run neighbors` and redeploy.',
    );
  }

  return { books, neighbors, graphIndex };
}
