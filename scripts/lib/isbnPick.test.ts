import { describe, expect, it } from 'vitest';
import { pickIsbn13 } from './isbnPick';

/** Choosing an edition, which is what this really is.
 *
 *  Open Library's `isbn` spans every edition of a work, so the two properties
 *  worth pinning are that the choice is VALID and that it is STABLE. An unstable
 *  choice would rewrite the corpus on every run and make the diff unreviewable,
 *  which is a slower kind of broken than picking wrongly. */

// 9780306406157 is the ISBN-13 in the ISBN specification's own worked example,
// and 0306406152 is the same edition in the old ten-digit form. Using documented
// example numbers rather than inventing digits keeps the fixtures honest.
const VALID_13 = '9780306406157';
const VALID_10 = '0306406152';

describe('what it accepts', () => {
  it('takes a valid ISBN-13 as it stands', () => {
    expect(pickIsbn13([VALID_13])).toEqual({ isbn13: VALID_13, candidates: 1 });
  });

  it('accepts punctuation and case, because catalogue records carry both', () => {
    expect(pickIsbn13(['978-0-306-40615-7']).isbn13).toBe(VALID_13);
  });

  it('converts a valid ISBN-10, since plenty of editions are only recorded that way', () => {
    // The same edition, not a different one — so this is worth doing rather than
    // discarding, and the conversion recomputes the checksum.
    expect(pickIsbn13([VALID_10])).toEqual({ isbn13: VALID_13, candidates: 1 });
  });

  it('counts a 10 and its own 13 as ONE edition, not two candidates', () => {
    // Otherwise the report would claim the edition was chosen arbitrarily when
    // there was only ever one edition, described twice.
    expect(pickIsbn13([VALID_10, VALID_13])).toEqual({ isbn13: VALID_13, candidates: 1 });
  });
});

describe('what it refuses', () => {
  it('drops a number whose checksum fails rather than deep-linking it', () => {
    // A checksum-valid but wrong ISBN opens the wrong book; a checksum-INVALID
    // one opens nothing. Both are worse than the search link this falls back to.
    expect(pickIsbn13(['9780306406158'])).toEqual({ candidates: 0 });
  });

  it('returns nothing for an empty list, which is the "no isbn field" case', () => {
    // Reached whenever the response carries no ISBNs at all — including if the
    // `isbn` field name turns out to be wrong. Failing safe means writing nothing.
    expect(pickIsbn13([])).toEqual({ candidates: 0 });
  });

  it('ignores rubbish mixed in with a good number', () => {
    expect(pickIsbn13(['', 'not-an-isbn', '123', VALID_13]).isbn13).toBe(VALID_13);
  });
});

describe('the choice is stable and honest about itself', () => {
  const editions = ['9780441569595', VALID_13, '9780451524935'];

  it('gives the same answer whatever order the catalogue returns', () => {
    // Response order is not stable across Open Library queries. If the pick
    // followed it, re-running the pass would churn the corpus diff.
    const forward = pickIsbn13(editions).isbn13;
    const reversed = pickIsbn13([...editions].reverse()).isbn13;
    const rotated = pickIsbn13([editions[2]!, editions[0]!, editions[1]!]).isbn13;
    expect(new Set([forward, reversed, rotated]).size).toBe(1);
  });

  it('reports how many editions it chose between, so an arbitrary pick is visible', () => {
    // `candidates: 3` is the run's cue to say the edition is arbitrary. Reporting
    // 1 here would misrepresent a three-way coin toss as an answer.
    expect(pickIsbn13(editions).candidates).toBe(3);
  });

  it('de-duplicates repeats, which appear when editions share a number', () => {
    expect(pickIsbn13([VALID_13, VALID_13, VALID_13])).toEqual({
      isbn13: VALID_13,
      candidates: 1,
    });
  });
});
