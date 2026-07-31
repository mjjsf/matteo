import { loadSeedCorpus } from '@/domain/fixtures';
import type { FetchLike } from './openlibraryFetch';
import { REQUEST_SPACING_MS, lookup, sleep } from './verifyFetch';
import { VERDICT_NOTE, VERDICT_ORDER, verify, type Verdict } from './verifyMatch';

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
 */

export interface Finding {
  id: string;
  title: string;
  authors: string[];
  year: number;
  verdict: Exclude<Verdict, { kind: 'ok' }>;
}

export async function run(
  fetchImpl: FetchLike,
  options: {
    limit?: number;
    json?: boolean;
    log?: (line: string) => void;
    /** Only the tests set this. The default is the throttle Open Library asks
     *  anonymous bulk readers for, which a test must not sit through. */
    spacingMs?: number;
  } = {},
): Promise<{ findings: Finding[]; checked: number; unreachable: number }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const spacing = options.spacingMs ?? REQUEST_SPACING_MS;
  const books = loadSeedCorpus().slice(0, options.limit ?? Infinity);

  const findings: Finding[] = [];
  let checked = 0;
  let unreachable = 0;

  for (const [i, book] of books.entries()) {
    if (i > 0 && spacing > 0) await sleep(spacing);
    const records = await lookup(fetchImpl, book.title, book.authors[0]);

    // `undefined` means the request failed, which is not the same as the
    // catalogue having nothing. Counting a rate-limited request as a missing
    // book would fill the report with accusations against real books.
    if (records === undefined) {
      unreachable += 1;
      continue;
    }

    checked += 1;
    const verdict = verify(book, records);
    if (verdict.kind === 'ok') continue;
    findings.push({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      verdict,
    });

    if (!options.json && findings.length % 25 === 0) {
      log(`  … ${checked}/${books.length} checked, ${findings.length} to look at`);
    }
  }

  if (options.json) {
    log(JSON.stringify({ checked, unreachable, findings }, null, 2));
    return { findings, checked, unreachable };
  }

  log('');
  log(`Checked ${checked} of ${books.length} books against Open Library.`);
  if (unreachable > 0) {
    log(`${unreachable} could not be reached and are NOT reported below — rerun to cover them.`);
  }

  if (checked === 0) {
    // Not "everything matched". Nothing was compared to anything, and a run that
    // reached no books must never read as a clean bill of health — that is the
    // one output that would actively mislead. It printed exactly that until the
    // script was run for real against a blocked host.
    log('NOTHING WAS VERIFIED — no book could be checked. The catalogue was unreachable.');
    return { findings, checked, unreachable };
  }

  if (findings.length === 0) {
    log('Nothing to look at: every book matched on title, author and year.');
    return { findings, checked, unreachable };
  }

  for (const kind of VERDICT_ORDER) {
    const group = findings.filter((f) => f.verdict.kind === kind);
    if (group.length === 0) continue;
    log('');
    log(`## ${kind} — ${group.length}`);
    log(VERDICT_NOTE[kind]);
    log('');
    for (const f of group) {
      const v = f.verdict;
      const detail =
        v.kind === 'author-differs'
          ? `ours: ${v.expected.join(', ')} | catalogue: ${v.found.join(', ')}`
          : v.kind === 'not-found'
            ? `${f.authors.join(', ')}, ${f.year}`
            : `ours: ${v.expected} | catalogue: ${v.found}`;
      log(`  ${f.id.padEnd(38)} ${f.title} — ${detail}`);
    }
  }

  log('');
  log(`${findings.length} of ${checked} to look at. Nothing has been changed.`);
  return { findings, checked, unreachable };
}
