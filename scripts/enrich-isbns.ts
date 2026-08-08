import type { FetchLike } from './lib/openlibraryFetch';
import { run } from './lib/isbnRun';

/** Give the corpus ISBNs, so Bookshop.org buttons open each book's own page
 *  rather than a search for its title.
 *
 *  The app end already works: `bookshopLinkForBook` returns `/book/{isbn13}` for
 *  any book that has one. Every link is a search today for one reason only — the
 *  corpus is hand-authored and not a single book records an ISBN. This fills that
 *  in; no app code changes.
 *
 *  It only ever ADDS an `isbn13`, only to books with none, and only when the
 *  catalogue record matched on title, author AND year. A wrong ISBN is worse than
 *  none: a search link that finds the book beats a product link that 404s, and a
 *  convincing page for the wrong book is a lie the reader cannot spot.
 *
 *  Usage:
 *    npm run isbn:enrich                  # every book that lacks one (~5 min)
 *    npm run isbn:enrich -- --limit 20    # first 20 lookups, to try it out
 *    npm run isbn:enrich -- --dry-run     # report only, write nothing
 *
 *  Then, and this is the step that is easy to miss:
 *    git diff data/corpus                 # read the ISBNs before trusting them
 *    npm run neighbors                    # until this runs, the app sees nothing
 *
 *  Not run against the live API by whoever wrote it: `openlibrary.org` answers
 *  403 at the egress proxy of that environment. The pieces are unit-tested
 *  against recorded shapes, so what stays unverified is narrowed to one claim —
 *  that `search.json` still answers in that shape and accepts `isbn` as a field.
 *  It fails safe if not: no ISBNs come back, and nothing is written.
 *
 *  The work lives in `lib/isbnRun.ts` so the tests can import it. This file is an
 *  entry point and nothing imports it, so it calls `run` unconditionally. The
 *  usual `import.meta.url === file://${process.argv[1]}` guard does not work
 *  here: `vite-node` strips the script path out of argv, so the condition is
 *  never true and the script silently does nothing. */

function parseArgs(argv: string[]): { limit: number; dryRun: boolean } {
  const limitAt = argv.indexOf('--limit');
  const raw = limitAt === -1 ? NaN : Number(argv[limitAt + 1]);
  return {
    limit: Number.isFinite(raw) && raw > 0 ? raw : Infinity,
    dryRun: argv.includes('--dry-run'),
  };
}

const { limit, dryRun } = parseArgs(process.argv.slice(2));
await run(globalThis.fetch as unknown as FetchLike, { limit, dryRun });
