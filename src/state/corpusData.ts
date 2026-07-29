import type { Book } from '@/domain/types';
import type { NeighborsFile } from '@/domain/similarity';

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

export interface CorpusData {
  books: Book[];
  neighbors: NeighborsFile;
}

/** Fetch the corpus and its neighbour table.
 *
 *  Both requests are same-origin — the app still makes no external network
 *  calls of any kind, which is a property worth preserving. */
export async function fetchCorpusData(): Promise<CorpusData> {
  const [corpusRes, neighborsRes] = await Promise.all([fetch(corpusUrl), fetch(neighborsUrl)]);
  if (!corpusRes.ok) throw new Error(`corpus.json: HTTP ${corpusRes.status}`);
  if (!neighborsRes.ok) throw new Error(`neighbors.json: HTTP ${neighborsRes.status}`);

  const [books, neighbors] = await Promise.all([
    corpusRes.json() as Promise<Book[]>,
    neighborsRes.json() as Promise<NeighborsFile>,
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

  return { books, neighbors };
}
