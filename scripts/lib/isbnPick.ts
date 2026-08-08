import { isValidIsbn10, isValidIsbn13, isbn10ToIsbn13, normalizeIsbn } from '@/domain/isbn';

/** Choosing one ISBN-13 from everything the catalogue knows about a work.
 *
 *  This is the weakest link in the pass, and it is weak for a reason that cannot
 *  be engineered away: Open Library's `isbn` is the union across ALL editions of
 *  a work — hardbacks, paperbacks, reissues, translations, large print, book club
 *  printings. A work can carry dozens, and nothing in the response says which one
 *  a given shop stocks.
 *
 *  So the honest framing is that this picks an EDITION, not a book, and the
 *  choice is arbitrary whenever there is more than one candidate. What it does
 *  guarantee is that the choice is:
 *
 *  - valid — a checksum-failing number is dropped rather than deep-linked;
 *  - deterministic — the same input always yields the same ISBN, so re-running
 *    the pass produces no diff churn and a review stays reviewable.
 *
 *  `candidates` is returned so the run can report where the choice was arbitrary.
 *  A count of 1 is a real answer; a count of 40 is a coin toss between 40
 *  editions, and hiding that behind a single number would misrepresent it. */

export interface IsbnPick {
  isbn13?: string;
  /** How many distinct valid ISBN-13s the work offered. `> 1` means the edition
   *  was chosen arbitrarily. `0` means nothing usable came back. */
  candidates: number;
}

export function pickIsbn13(isbns: readonly string[]): IsbnPick {
  const valid = new Set<string>();

  for (const raw of isbns) {
    const s = normalizeIsbn(raw);
    if (isValidIsbn13(s)) {
      valid.add(s);
      continue;
    }
    // An ISBN-10 is the same edition written a different way, so it is worth
    // converting rather than discarding — plenty of pre-2007 editions are only
    // recorded in the old form. `isbn10ToIsbn13` recomputes the checksum, so the
    // result is a real ISBN-13 and not a reformatting.
    if (isValidIsbn10(s)) {
      const converted = isbn10ToIsbn13(s);
      if (converted) valid.add(converted);
    }
  }

  // Sorted, not "first seen": response order is not stable across Open Library
  // queries, and an unstable choice would rewrite the corpus on every run.
  const sorted = [...valid].sort();
  const first = sorted[0];
  return first === undefined
    ? { candidates: 0 }
    : { isbn13: first, candidates: sorted.length };
}
