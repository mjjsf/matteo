import { describe, expect, it } from 'vitest';
import { loadSeedCorpus, loadTagMap } from '@/domain/fixtures';
import { RELATION } from '@/domain/palette';
import type { Book } from '@/domain/types';
import {
  POINT_STATE,
  computeRelationBuffer,
  computeStateBuffer,
  relationCounts,
} from './selectors';

const books = loadSeedCorpus();
const tagMap = loadTagMap();

const idOf = (i: number): string => (books[i] as Book).id;
const indexOf = (id: string): number => books.findIndex((b) => b.id === id);

describe('computeStateBuffer', () => {
  const out = new Float32Array(books.length);

  it('marks everything normal when nothing is filtering', () => {
    computeStateBuffer({ books, matchedIds: null, branchMembers: null }, out);
    expect([...new Set(out)]).toEqual([POINT_STATE.normal]);
  });

  it('emphasizes matches and dims the rest during a search', () => {
    const matched = new Set([idOf(0), idOf(1)]);
    computeStateBuffer({ books, matchedIds: matched, branchMembers: null }, out);
    expect(out[0]).toBe(POINT_STATE.emphasized);
    expect(out[1]).toBe(POINT_STATE.emphasized);
    expect(out[2]).toBe(POINT_STATE.dim);
  });

  it('dims everything when a search matches nothing', () => {
    // The empty Set must behave differently from null — this is the classic bug
    // where clearing the search box hides the whole corpus, or vice versa.
    computeStateBuffer({ books, matchedIds: new Set(), branchMembers: null }, out);
    expect([...new Set(out)]).toEqual([POINT_STATE.dim]);
  });

  it('intersects search with the branch filter', () => {
    const matched = new Set([idOf(0), idOf(1), idOf(2)]);
    const branch = new Set([idOf(1), idOf(2), idOf(3)]);
    computeStateBuffer({ books, matchedIds: matched, branchMembers: branch }, out);
    expect(out[0]).toBe(POINT_STATE.dim); // matched but not in branch
    expect(out[1]).toBe(POINT_STATE.emphasized);
    expect(out[2]).toBe(POINT_STATE.emphasized);
    expect(out[3]).toBe(POINT_STATE.dim); // in branch but not matched
  });

  it('applies a branch filter with no search active', () => {
    const branch = new Set([idOf(5)]);
    computeStateBuffer({ books, matchedIds: null, branchMembers: branch }, out);
    expect(out[5]).toBe(POINT_STATE.emphasized);
    expect(out[4]).toBe(POINT_STATE.dim);
  });

  it('covers the full truth table of search x branch', () => {
    const table: Array<[Set<string> | null, Set<string> | null, number]> = [
      [null, null, POINT_STATE.normal],
      [new Set([idOf(0)]), null, POINT_STATE.emphasized],
      [null, new Set([idOf(0)]), POINT_STATE.emphasized],
      [new Set([idOf(0)]), new Set([idOf(0)]), POINT_STATE.emphasized],
      [new Set(), null, POINT_STATE.dim],
      [null, new Set(), POINT_STATE.dim],
    ];
    for (const [matchedIds, branchMembers, expected] of table) {
      computeStateBuffer({ books, matchedIds, branchMembers }, out);
      expect(out[0]).toBe(expected);
    }
  });
});

describe('computeRelationBuffer', () => {
  const out = new Float32Array(books.length);

  it('clears all relations when nothing is hovered', () => {
    out.fill(RELATION.sameAuthor);
    computeRelationBuffer(books, null, tagMap, out);
    expect([...new Set(out)]).toEqual([RELATION.none]);
  });

  it('never marks the hovered book as related to itself', () => {
    const i = indexOf('neuromancer');
    computeRelationBuffer(books, 'neuromancer', tagMap, out);
    expect(out[i]).toBe(RELATION.none);
  });

  it('marks other books by the same author', () => {
    // Le Guin has several books in the corpus.
    computeRelationBuffer(books, 'the-left-hand-of-darkness', tagMap, out);
    const dispossessed = indexOf('the-dispossessed');
    const earthsea = indexOf('the-earthsea-quartet');
    expect(out[dispossessed]).toBe(RELATION.sameAuthor);
    expect(out[earthsea]).toBe(RELATION.sameAuthor);
  });

  it('assigns NO sameAuthor when the hovered author has only one book', () => {
    // Kuhn appears exactly once, so nothing may be coloured as same-author.
    const kuhn = books.filter((b) => b.authors.includes('Thomas S. Kuhn'));
    expect(kuhn).toHaveLength(1);
    computeRelationBuffer(books, 'the-structure-of-scientific-revolutions', tagMap, out);
    const counts = relationCounts(out);
    expect(counts.sameAuthor).toBe(0);
    expect(counts.sameSubject).toBeGreaterThan(0);
  });

  it('marks books sharing a taxonomy leaf as sameSubject', () => {
    computeRelationBuffer(books, 'neuromancer', tagMap, out);
    const snowCrash = indexOf('snow-crash');
    // Both are tagged cyberpunk, so they share a leaf.
    expect(out[snowCrash]).toBe(RELATION.sameSubject);
  });

  it('prefers sameAuthor over sameSubject when both apply', () => {
    // Snow Crash and The Diamond Age share both Stephenson and cyberpunk.
    computeRelationBuffer(books, 'snow-crash', tagMap, out);
    expect(out[indexOf('the-diamond-age')]).toBe(RELATION.sameAuthor);
  });

  it('uses only the three defined relation values plus none', () => {
    computeRelationBuffer(books, 'dune', tagMap, out);
    const allowed = new Set<number>([
      RELATION.none,
      RELATION.sameAuthor,
      RELATION.sameSubject,
      RELATION.sharedTag,
    ]);
    for (const v of out) expect(allowed.has(v)).toBe(true);
  });

  it('handles an unknown hovered id without throwing', () => {
    computeRelationBuffer(books, 'no-such-book', tagMap, out);
    expect([...new Set(out)]).toEqual([RELATION.none]);
  });

  it('relates a comfortable minority of the corpus, not most of it', () => {
    // If hovering lit up half the cloud the colouring would be useless noise.
    computeRelationBuffer(books, 'neuromancer', tagMap, out);
    const counts = relationCounts(out);
    const related = counts.sameAuthor + counts.sameSubject + counts.sharedTag;
    expect(related).toBeGreaterThan(0);
    expect(related).toBeLessThan(books.length * 0.25);
  });
});
