import type { FetchLike } from './lib/openlibraryFetch';
import { run } from './lib/verifyRun';

/** Check every book in the corpus against an authoritative catalogue.
 *
 *  THIS SCRIPT WRITES NOTHING. It prints a report, and every finding is for a
 *  person to look at and decide about. That is deliberate: a book's year and its
 *  attribution are editorial facts, and a script that silently rewrote them
 *  would be replacing one unverified source with another. `merge-corpus.ts`
 *  makes the same call for the same reason — the authored corpus wins every
 *  conflict.
 *
 *  Why Open Library and not WorldCat: the WorldCat Search API closed to all but
 *  libraries holding both an OCLC Cataloging and Metadata subscription and a
 *  FirstSearch/WorldCat Discovery subscription, and support for v1.0 ended
 *  31 December 2024. Open Library is CC0, needs no key, and answers the question
 *  actually being asked — does a book by this name, by this person, in this
 *  year, exist.
 *
 *  Usage:
 *    npm run verify:corpus                 # every book
 *    npm run verify:corpus -- --limit 50   # first 50, to try it out
 *    npm run verify:corpus -- --json       # machine-readable
 *
 *  The work lives in `lib/verifyRun.ts` so the tests can import it. This file is
 *  an entry point and nothing imports it, which is why it can call `run`
 *  unconditionally the way `fetch-openlibrary.ts` and `merge-corpus.ts` call
 *  their `main`. The usual `import.meta.url === file://${process.argv[1]}` guard
 *  does not work here at all: `vite-node` strips the script path out of argv
 *  entirely, so the condition is never true and the script silently prints
 *  nothing. */

function parseArgs(argv: string[]): { limit: number; json: boolean } {
  const limitAt = argv.indexOf('--limit');
  const raw = limitAt === -1 ? NaN : Number(argv[limitAt + 1]);
  return {
    limit: Number.isFinite(raw) && raw > 0 ? raw : Infinity,
    json: argv.includes('--json'),
  };
}

const { limit, json } = parseArgs(process.argv.slice(2));
await run(globalThis.fetch as unknown as FetchLike, { limit, json });
