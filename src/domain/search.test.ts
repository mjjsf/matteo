import { describe, expect, it } from 'vitest';
import corpusJson from '@/generated/corpus.json';
import type { Book } from './types';
import graphIndexJson from '@/generated/graph-index.json';
import type { GraphIndexFile } from './graphIndex';
import { MIN_QUERY_LENGTH, createSearchIndex, matchTier, runSearch } from './search';

/** Search ranking, against the real corpus.
 *
 *  Deliberately not a handful of fixtures: the complaint that prompted this was
 *  about what 1016 real books do to a fuzzy scorer, and a three-book fixture
 *  cannot reproduce that. */

const books = corpusJson as unknown as Book[];
const index = createSearchIndex(books, graphIndexJson as unknown as GraphIndexFile);
const titles = (q: string, n = 6): string[] =>
  runSearch(index, q)
    .slice(0, n)
    .filter((h) => h.kind === 'book')
    .map((h) => h.label);

describe('single letters', () => {
  it('searches at all', () => {
    // Used to be 2, so "d" returned nothing whatsoever.
    expect(MIN_QUERY_LENGTH).toBe(1);
    expect(runSearch(index, 'd').length).toBeGreaterThan(0);
  });

  it('lists titles starting with that letter, alphabetically', () => {
    const out = titles('d', 8);
    for (const t of out) {
      const bare = t.toLowerCase().replace(/^(?:the|a|an)\s+/, '');
      expect(bare.startsWith('d'), `"${t}" does not start with D`).toBe(true);
    }
    const sorted = [...out].map((t) => t.toLowerCase().replace(/^(?:the|a|an)\s+/, '')).sort();
    expect(out.map((t) => t.toLowerCase().replace(/^(?:the|a|an)\s+/, ''))).toEqual(sorted);
  });

  it('looks past a leading article', () => {
    // A third of English titles hide their first real word behind "The".
    expect(titles('g', 40).some((t) => /^The G/.test(t))).toBe(true);
  });
});

describe('prefix beats fuzz', () => {
  it('puts the exact title first', () => {
    expect(titles('neuromancer')[0]).toBe('Neuromancer');
    expect(titles('the great gatsby')[0]).toMatch(/great gatsby/i);
  });

  it('no longer fills the visible slots with unrelated books', () => {
    // The reported symptom: "neuromancer" returned Neuromancer followed by
    // Outlander, The Hating Game, Book Lovers, The Love Hypothesis and The Kiss
    // Quotient. Fuse is now the last tier, so its loose matches only fill slots
    // nothing better claimed.
    const out = titles('neuromancer');
    for (const noise of ['Outlander', 'The Hating Game', 'Book Lovers', 'The Kiss Quotient']) {
      expect(out, `"${noise}" is still in the top six`).not.toContain(noise);
    }
  });

  it('ranks a title prefix above a mid-word substring', () => {
    const book = books.find((b) => b.title === 'Neuromancer') as Book;
    // "neuro" starts the title; "euroman" only appears inside it.
    expect(matchTier(book, 'neuro')).toBeLessThan(matchTier(book, 'euroman') as number);
  });

  it('treats a leading article as skippable rather than as a substring match', () => {
    // "A Neuro Thing" genuinely IS a prefix match for "neuro" once the article
    // is stripped — the same rule that makes "g" find The Goldfinch.
    expect(matchTier({ ...(books[0] as Book), title: 'A Neuro Thing' } as Book, 'neuro')).toBe(0);
  });
});

describe('authors', () => {
  it('finds a book by surname prefix', () => {
    const out = runSearch(index, 'le guin').slice(0, 6);
    expect(out.some((h) => h.book?.authors.some((a) => /Le Guin/i.test(a)) || h.kind === 'author')).toBe(
      true,
    );
  });

  it('finds a book by forename prefix', () => {
    expect(
      runSearch(index, 'ursula')
        .slice(0, 6)
        .some((h) => h.book?.authors.some((a) => /Ursula/i.test(a)) || /Ursula/i.test(h.label)),
    ).toBe(true);
  });
});

describe('subjects and authors are searchable too', () => {
  const kinds = (q: string, n = 8): Array<[string, string]> =>
    runSearch(index, q)
      .slice(0, n)
      .map((h) => [h.kind, h.label] as [string, string]);

  it('finds a subject by name', () => {
    expect(kinds('exist')).toContainEqual(['topic', 'Existentialism']);
  });

  it('finds an author as an entity, not only as a route to their books', () => {
    expect(kinds('le guin')[0]).toEqual(['author', 'Ursula K. Le Guin']);
    expect(kinds('pratchett')[0]).toEqual(['author', 'Terry Pratchett']);
  });

  it('still lists titles for a plain letter rather than burying them', () => {
    // Ranking subjects above books by book-count broke exactly this: every
    // subject carries a double-digit count and every book carries none, so "d"
    // returned six subjects and not one D title.
    expect(kinds('d').filter(([k]) => k === 'book').length).toBeGreaterThan(3);
  });

  it('does not offer a topic and an identically-named tag as two answers', () => {
    // `Cyberpunk` the topic and `cyberpunk` the tag cover the same ground; both
    // spent two of six slots saying one word twice.
    const labels = kinds('cyberpunk').map(([, l]) => l.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('never offers a subject with no books behind it', () => {
    for (const q of ['a', 'e', 'philosophy', 'romance']) {
      for (const hit of runSearch(index, q)) {
        if (hit.kind === 'book') continue;
        expect(hit.detail, `${hit.label} is empty`).not.toMatch(/^0 books/);
      }
    }
  });

  it('gives every hit a ref that names its kind', () => {
    for (const hit of runSearch(index, 'philosophy')) {
      expect(hit.ref.startsWith(`${hit.kind}:`)).toBe(true);
    }
  });
});

describe('typos still resolve', () => {
  it('falls through to the fuzzy tier', () => {
    // The reason Fuse is kept rather than replaced: no prefix rule catches this.
    expect(titles('neuromancr', 3)).toContain('Neuromancer');
  });
});

describe('edges', () => {
  it('returns nothing for an empty query', () => {
    expect(runSearch(index, '')).toEqual([]);
    expect(runSearch(index, '   ')).toEqual([]);
  });

  it('never repeats a book across tiers', () => {
    for (const q of ['d', 'the', 'a', 'neuromancer', 'dune']) {
      const ids = runSearch(index, q).map((h) => h.ref);
      expect(new Set(ids).size, `"${q}" repeated a book`).toBe(ids.length);
    }
  });

  it('is case- and accent-insensitive', () => {
    expect(titles('NEUROMANCER')[0]).toBe('Neuromancer');
    expect(runSearch(index, 'DUNE').length).toBe(runSearch(index, 'dune').length);
  });
});
