import { describe, expect, it } from 'vitest';
import graphIndexJson from '@/generated/graph-index.json';
import corpusJson from '@/generated/corpus.json';
import type { GraphIndexFile } from './graphIndex';
import type { Book } from './types';
import { authorRef, bookRef, tagRef, topicRef, type NodeRef } from './nodeRef';
import {
  MAX_AXES,
  axesFor,
  axisNote,
  candidatesFor,
  type Candidate,
} from './branch';

const index = graphIndexJson as unknown as GraphIndexFile;
const books = corpusJson as unknown as Book[];
const bookById = new Map(books.map((b) => [b.id, b]));
const bookOf = (id: string): Book => {
  const book = bookById.get(id);
  if (!book) throw new Error(`fixture book missing: ${id}`);
  return book;
};

/** Similarity lives in `neighbors.json`, which the store injects. A stub keeps
 *  these tests about the axis structure rather than about the bake. */
const someSimilar = (): Candidate[] => [
  { nodeRef: bookRef('dune'), weight: 0.9 },
  { nodeRef: bookRef('foundation'), weight: 0.8 },
];
const noSimilar = (): Candidate[] => [];

describe('no node offers more than three axes', () => {
  // The invariant the canvas arc rests on. Before grouping, a book offered
  // `titles` plus one axis per author plus one per subject — a median of 5 and a
  // maximum of 9. An arc drawn from that would have had to truncate, which hides
  // a branch rather than declining to offer it.
  it('holds for every book in the corpus, with and without neighbours', () => {
    for (const similar of [someSimilar, noSimilar]) {
      const worst = books
        .map((b) => ({ id: b.id, n: axesFor(bookRef(b.id), index, b, similar).length }))
        .sort((a, b) => b.n - a.n)[0];
      expect(worst!.n, `${worst!.id} offers ${worst!.n} axes`).toBeLessThanOrEqual(MAX_AXES);
    }
  });

  it('holds for every subject and author node', () => {
    const refs: NodeRef[] = [
      ...Object.keys(index.topics).map(topicRef),
      ...Object.keys(index.booksForTag).map(tagRef),
      ...Object.keys(index.booksForAuthor).map(authorRef),
    ];
    for (const ref of refs) {
      expect(axesFor(ref, index, undefined, noSimilar).length, ref).toBeLessThanOrEqual(MAX_AXES);
    }
  });
});

describe('a book groups its authors and its subjects', () => {
  it('names the author when there is exactly one worth following', () => {
    const book = bookOf('anna-karenina');
    const axis = axesFor(bookRef(book.id), index, book, noSimilar).find((a) => a.id === 'authors');
    expect(axis).toEqual({ id: 'authors', label: 'By Leo Tolstoy', count: 1 });
  });

  it('counts them instead of naming them when a book has two', () => {
    const book = bookOf('good-omens');
    const axis = axesFor(bookRef(book.id), index, book, noSimilar).find((a) => a.id === 'authors');
    expect(axis).toEqual({ id: 'authors', label: 'Its authors', count: 2 });
  });

  it('omits the axis entirely for a one-book author', () => {
    // 572 of 1038 books are in this position, so it is the common case. The
    // branch would be a single author node whose only child is the book you came
    // from, which reads as a promise the map cannot keep.
    const book = bookOf('neuromancer');
    expect(book.authors).toEqual(['William Gibson']);
    expect(index.booksForAuthor['william-gibson']).toHaveLength(1);
    const ids = axesFor(bookRef(book.id), index, book, noSimilar).map((a) => a.id);
    expect(ids).not.toContain('authors');
  });

  it('offers every subject as one axis, and the count is what it attaches', () => {
    const book = bookOf('neuromancer');
    const axis = axesFor(bookRef(book.id), index, book, noSimilar).find((a) => a.id === 'subjects');
    expect(axis?.count).toBe(book.subjects.length);
    const grown = candidatesFor(bookRef(book.id), 'subjects', index, noSimilar, book);
    expect(grown.map((c) => c.nodeRef)).toEqual(book.subjects.map(tagRef));
  });

  it('keeps the button and the branch reading the same list', () => {
    // `axesFor` and `candidatesFor` share their filters precisely so a count of
    // 4 cannot grow 3 things. Checked across the corpus rather than on one book,
    // because the two would only drift for books whose tags fall out of the
    // vocabulary.
    for (const book of books) {
      const ref = bookRef(book.id);
      for (const axis of axesFor(ref, index, book, noSimilar)) {
        if (axis.id !== 'authors' && axis.id !== 'subjects') continue;
        const grown = candidatesFor(ref, axis.id, index, noSimilar, book);
        expect(grown, `${book.id} / ${axis.id}`).toHaveLength(axis.count);
      }
    }
  });

  it('still leads with related titles, because that is what a seed opens with', () => {
    const book = bookOf('anna-karenina');
    expect(axesFor(bookRef(book.id), index, book, someSimilar)[0]?.id).toBe('titles');
  });

  it('fans out author NODES, not their books — the hop carries the meaning', () => {
    const book = bookOf('anna-karenina');
    const grown = candidatesFor(bookRef(book.id), 'authors', index, noSimilar, book);
    expect(grown.map((c) => c.nodeRef)).toEqual([authorRef('leo-tolstoy')]);
  });

  it('weights the fan by rank so its geometry still encodes order', () => {
    const book = bookOf('neuromancer');
    const weights = candidatesFor(bookRef(book.id), 'subjects', index, noSimilar, book).map(
      (c) => c.weight,
    );
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(new Set(weights).size).toBe(weights.length);
  });
});

describe('links already shared keep replaying', () => {
  it('resolves the per-author and per-subject axis ids that used to be generated', () => {
    // Nothing produces these any more, but they are in the `path` of every URL
    // shared before the axes were grouped. Dropping them would silently replay
    // those links as a different map.
    const ref = bookRef('anna-karenina');
    expect(candidatesFor(ref, authorRef('leo-tolstoy'), index, noSimilar, bookOf('anna-karenina'))).toEqual([
      { nodeRef: authorRef('leo-tolstoy'), weight: 1 },
    ]);
    expect(candidatesFor(ref, tagRef('existentialism'), index, noSimilar, bookOf('anna-karenina'))).toEqual([
      { nodeRef: tagRef('existentialism'), weight: 1 },
    ]);
  });
});

describe('subject and author nodes are unchanged', () => {
  it('leads a topic with children with its children, and a leaf with its books', () => {
    const parent = axesFor(topicRef('philosophy-western-continental'), index, undefined, noSimilar);
    expect(parent[0]?.id).toBe('narrower');
    const leaf = axesFor(
      topicRef('philosophy-western-existentialism'),
      index,
      undefined,
      noSimilar,
    );
    expect(leaf[0]?.id).toBe('books');
  });

  it('offers an author their books', () => {
    const ids = axesFor(authorRef('ursula-k-le-guin'), index, undefined, noSimilar).map((a) => a.id);
    expect(ids).toContain('books');
  });
});

describe('edge notes say why two things are adjacent', () => {
  it('labels the grouped axes', () => {
    expect(axisNote(bookRef('neuromancer'), 'subjects')).toBe('by subject');
    expect(axisNote(bookRef('anna-karenina'), 'authors')).toBe('by author');
  });

  it('still distinguishes an author’s books from a subject’s', () => {
    expect(axisNote(authorRef('leo-tolstoy'), 'books')).toBe('by author');
    expect(axisNote(tagRef('cyberpunk'), 'books')).toBe('by subject');
  });
});
