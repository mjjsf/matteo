import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Book } from '@/domain/types';
import type { FetchLike } from './openlibraryFetch';
import { REQUEST_SPACING_MS, sleep } from './verifyFetch';
import { lookup, type IsbnDoc } from './isbnFetch';
import { bestMatch, verify } from './verifyMatch';
import { pickIsbn13 } from './isbnPick';

/** Give every book an ISBN-13, so its Bookshop.org button opens the book's own
 *  page instead of a search.
 *
 *  Nothing in the app needs changing for that: `bookshopLinkForBook` already
 *  returns `/book/{isbn13}` for any book that has one, and only searches for the
 *  rest. This pass fills the gap in the DATA, which is the only reason every link
 *  is a search today — the corpus is hand-authored and records no ISBNs at all.
 *
 *  UNLIKE `verify-corpus.ts`, THIS WRITES. That is a deliberate departure and the
 *  reason it is safe here: an ISBN is not an editorial fact the way a year or an
 *  attribution is. It is an identifier that either checksums and names this book
 *  or does not, so it can be looked up rather than judged. Years and authorship
 *  stay untouched — this only ever ADDS an `isbn13`, and only to books that have
 *  none.
 *
 *  THE CONFIDENCE BAR. A wrong ISBN is worse than no ISBN: a search link that
 *  finds the book beats a product link that 404s, and worse, a plausible-looking
 *  page for the WRONG book is a quiet lie the reader has no way to detect. So an
 *  ISBN is only taken when `verify` returns `ok` — title matched, an author
 *  surname agreed, year within slack. Anything less keeps the search link. That
 *  reuses the matcher the verify pass already had tested rather than inventing a
 *  second, laxer notion of "close enough".
 *
 *  Usage:
 *    npm run isbn:enrich                  # every book that lacks one
 *    npm run isbn:enrich -- --limit 20    # first 20, to try it out
 *    npm run isbn:enrich -- --dry-run     # report only, write nothing
 */

const CORPUS_DIR = fileURLToPath(new URL('../../data/corpus/', import.meta.url));

export interface EnrichCounts {
  /** Books that gained an `isbn13`. */
  enriched: number;
  /** Already had one, so never looked up. Makes re-runs cheap and idempotent. */
  skippedHadIsbn: number;
  /** Catalogue answered, but no record was this book to the required standard. */
  noConfidentMatch: number;
  /** Matched, but the record carried no valid ISBN. */
  noUsableIsbn: number;
  /** The request itself failed. Not a finding — just rerun. */
  unreachable: number;
  /** Of the enriched, how many had more than one candidate edition. */
  arbitraryEdition: number;
}

export interface EnrichedBook {
  id: string;
  title: string;
  isbn13: string;
  candidates: number;
}

/** One authored corpus part, kept with its filename so it can be written back. */
interface Part {
  file: string;
  books: Book[];
}

function loadParts(dir: string): Part[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const books = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Book[];
      if (!Array.isArray(books)) throw new Error(`corpus part ${file} is not an array`);
      return { file, books };
    });
}

/** Byte-for-byte the format `merge-corpus.ts` writes: two-space JSON, trailing
 *  newline. So the diff of a run is only the added `isbn13` lines, which is what
 *  makes it reviewable — and `isbn13` sorts last in each object because it is
 *  assigned last, matching the order in the `Book` interface. */
function writePart(dir: string, part: Part): void {
  writeFileSync(join(dir, part.file), `${JSON.stringify(part.books, null, 2)}\n`);
}

export async function run(
  fetchImpl: FetchLike,
  options: {
    limit?: number;
    dryRun?: boolean;
    log?: (line: string) => void;
    /** Only the tests set these. The default spacing is the throttle Open
     *  Library asks anonymous bulk readers for, which a test must not sit
     *  through, and the default directory is the real corpus. */
    spacingMs?: number;
    dir?: string;
  } = {},
): Promise<{ counts: EnrichCounts; enriched: EnrichedBook[] }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const spacing = options.spacingMs ?? REQUEST_SPACING_MS;
  const dir = options.dir ?? CORPUS_DIR;
  const dryRun = options.dryRun ?? false;

  const parts = loadParts(dir);
  const counts: EnrichCounts = {
    enriched: 0,
    skippedHadIsbn: 0,
    noConfidentMatch: 0,
    noUsableIsbn: 0,
    unreachable: 0,
    arbitraryEdition: 0,
  };
  const enriched: EnrichedBook[] = [];

  // The limit counts LOOKUPS, not books, so `--limit 20` is twenty requests
  // however many books already have an ISBN. Otherwise a second run with a limit
  // would spend the whole budget re-skipping the books the first run filled.
  const budget = options.limit ?? Infinity;
  let lookups = 0;
  const touched = new Set<string>();

  for (const part of parts) {
    for (const book of part.books) {
      if (book.isbn13) {
        counts.skippedHadIsbn += 1;
        continue;
      }
      if (lookups >= budget) continue;

      if (lookups > 0 && spacing > 0) await sleep(spacing);
      lookups += 1;
      const docs = await lookup(fetchImpl, book.title, book.authors[0]);

      if (docs === undefined) {
        counts.unreachable += 1;
        continue;
      }

      // The bar. `verify` is the verify pass's own standard, unchanged.
      if (verify(book, docs).kind !== 'ok') {
        counts.noConfidentMatch += 1;
        continue;
      }

      // Safe: `docs` is `IsbnDoc[]`, and `bestMatch` returns one of the objects
      // it was handed rather than a copy.
      const match = bestMatch(book, docs) as IsbnDoc | undefined;
      const pick = match ? pickIsbn13(match.isbns) : { candidates: 0 };
      if (!pick.isbn13) {
        counts.noUsableIsbn += 1;
        continue;
      }

      book.isbn13 = pick.isbn13;
      counts.enriched += 1;
      if (pick.candidates > 1) counts.arbitraryEdition += 1;
      enriched.push({
        id: book.id,
        title: book.title,
        isbn13: pick.isbn13,
        candidates: pick.candidates,
      });
      touched.add(part.file);

      if (counts.enriched % 25 === 0) {
        log(`  … ${lookups} looked up, ${counts.enriched} ISBNs found`);
      }
    }
  }

  if (!dryRun) {
    for (const part of parts) {
      if (touched.has(part.file)) writePart(dir, part);
    }
  }

  log('');
  if (lookups === 0) {
    // Never "done, nothing to do". Either every book already had an ISBN — a real
    // result — or the budget was zero, which is not. Saying "all up to date"
    // after looking nothing up is the one output that would actively mislead,
    // which is the mistake `verify-corpus` shipped with until it was run for real.
    log(
      counts.skippedHadIsbn > 0
        ? `NOTHING WAS LOOKED UP — all ${counts.skippedHadIsbn} books already have an ISBN.`
        : 'NOTHING WAS LOOKED UP and no book has an ISBN. Check the limit and the corpus path.',
    );
    return { counts, enriched };
  }

  log(`Looked up ${lookups} books against Open Library.`);
  log(`  ${counts.enriched} gained an ISBN-13 — their buttons now open the book's own page.`);
  if (counts.arbitraryEdition > 0) {
    log(
      `  ${counts.arbitraryEdition} of those had several editions to choose from, so the ` +
        'edition is arbitrary and the page may not be the printing you would pick.',
    );
  }
  if (counts.noConfidentMatch > 0) {
    log(
      `  ${counts.noConfidentMatch} had no confident match and KEEP THEIR SEARCH LINK. ` +
        'That is the intended outcome, not a failure — see `npm run verify:corpus` for why.',
    );
  }
  if (counts.noUsableIsbn > 0) {
    log(`  ${counts.noUsableIsbn} matched but carried no valid ISBN.`);
  }
  if (counts.unreachable > 0) {
    log(`  ${counts.unreachable} could not be reached — rerun to cover them.`);
  }
  if (counts.skippedHadIsbn > 0) {
    log(`  ${counts.skippedHadIsbn} already had one and were not looked up.`);
  }

  log('');
  if (dryRun) {
    log('--dry-run: nothing was written.');
  } else if (counts.enriched === 0) {
    log('Nothing was written.');
  } else {
    log(`Wrote ${touched.size} corpus part(s). Two things remain, and both matter:`);
    log('  1. `git diff data/corpus` — read the ISBNs before trusting them.');
    log('  2. `npm run neighbors` — until the bake runs, the app still sees no ISBNs.');
    log('     `npm test` will fail on the freshness check until you do.');
  }
  return { counts, enriched };
}
