import { describe, expect, it } from 'vitest';
import { loadSeedCorpus, loadTagMap, loadTaxonomyFile } from '@/domain/fixtures';
import { buildTaxonomyIndex, populateMembers } from '@/domain/taxonomy';
import { RELATION } from '@/domain/palette';
import { nodesForBook } from '@/domain/taxonomy';
import type { Book } from '@/domain/types';
import {
  POINT_STATE,
  SPECIFIC_NODE_MAX_SHARE,
  computeRelationBuffer,
  computeStateBuffer,
  relationCounts,
} from './selectors';

const books = loadSeedCorpus();
const tagMap = loadTagMap();
const taxonomy = populateMembers(buildTaxonomyIndex(loadTaxonomyFile()), books, tagMap);

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
    computeRelationBuffer(books, null, tagMap, taxonomy, out);
    expect([...new Set(out)]).toEqual([RELATION.none]);
  });

  it('never marks the hovered book as related to itself', () => {
    const i = indexOf('neuromancer');
    computeRelationBuffer(books, 'neuromancer', tagMap, taxonomy, out);
    expect(out[i]).toBe(RELATION.none);
  });

  it('marks other books by the same author', () => {
    // Le Guin has several books in the corpus.
    computeRelationBuffer(books, 'the-left-hand-of-darkness', tagMap, taxonomy, out);
    const dispossessed = indexOf('the-dispossessed');
    const earthsea = indexOf('the-earthsea-quartet');
    expect(out[dispossessed]).toBe(RELATION.sameAuthor);
    expect(out[earthsea]).toBe(RELATION.sameAuthor);
  });

  it('assigns NO sameAuthor when the hovered author has only one book', () => {
    // Kuhn appears exactly once, so nothing may be coloured as same-author.
    const kuhn = books.filter((b) => b.authors.includes('Thomas S. Kuhn'));
    expect(kuhn).toHaveLength(1);
    computeRelationBuffer(books, 'the-structure-of-scientific-revolutions', tagMap, taxonomy, out);
    const counts = relationCounts(out);
    expect(counts.sameAuthor).toBe(0);
    expect(counts.sameSubject).toBeGreaterThan(0);
  });

  it('marks books sharing a taxonomy leaf as sameSubject', () => {
    computeRelationBuffer(books, 'neuromancer', tagMap, taxonomy, out);
    const snowCrash = indexOf('snow-crash');
    // Both are tagged cyberpunk, so they share a leaf.
    expect(out[snowCrash]).toBe(RELATION.sameSubject);
  });

  it('prefers sameAuthor over sameSubject when both apply', () => {
    // Snow Crash and The Diamond Age share both Stephenson and cyberpunk.
    computeRelationBuffer(books, 'snow-crash', tagMap, taxonomy, out);
    expect(out[indexOf('the-diamond-age')]).toBe(RELATION.sameAuthor);
  });

  it('uses only the three defined relation values plus none', () => {
    computeRelationBuffer(books, 'dune', tagMap, taxonomy, out);
    const allowed = new Set<number>([
      RELATION.none,
      RELATION.sameAuthor,
      RELATION.sameSubject,
      RELATION.sharedTag,
    ]);
    for (const v of out) expect(allowed.has(v)).toBe(true);
  });

  it('handles an unknown hovered id without throwing', () => {
    computeRelationBuffer(books, 'no-such-book', tagMap, taxonomy, out);
    expect([...new Set(out)]).toEqual([RELATION.none]);
  });

  it('relates a comfortable minority of the corpus, not most of it', () => {
    // If hovering lit up half the cloud the colouring would be useless noise.
    computeRelationBuffer(books, 'neuromancer', tagMap, taxonomy, out);
    const counts = relationCounts(out);
    const related = counts.sameAuthor + counts.sameSubject + counts.sharedTag;
    expect(related).toBeGreaterThan(0);
    expect(related).toBeLessThan(books.length * 0.25);
  });

  it('keeps the strongly-coloured set selective for EVERY book', () => {
    // The two hued tiers are what the eye reads first, so they are the ones that
    // must stay small. Checked across the whole corpus rather than a sample,
    // because the worst case is what ruins the effect.
    let worstId = '';
    let worst = 0;
    for (const book of books) {
      computeRelationBuffer(books, book.id, tagMap, taxonomy, out);
      const counts = relationCounts(out);
      const hued = counts.sameAuthor + counts.sameSubject;
      if (hued > worst) {
        worst = hued;
        worstId = book.id;
      }
    }
    // Measured max at the chosen specificity threshold is 22.4%; the typical
    // case is ~7%. The bound guards against a regression back to the 45% wash,
    // not against small tuning changes.
    expect(worst / books.length, `worst case is ${worstId} at ${worst}/${books.length}`).toBeLessThan(
      0.25,
    );
  });

  it('leaves few books without any coloured kin', () => {
    // The counterpart to the bound above: too strict a gate and hovering many
    // books would show no colour at all. Measured at 12 of 361.
    let none = 0;
    for (const book of books) {
      computeRelationBuffer(books, book.id, tagMap, taxonomy, out);
      const c = relationCounts(out);
      if (c.sameAuthor + c.sameSubject === 0) none++;
    }
    expect(none / books.length).toBeLessThan(0.06);
  });

  it('makes the sharedTag tier reachable', () => {
    // Regression guard. When `sharedTag` meant "shares a raw tag" it was
    // unreachable — sharing a tag implies sharing the node it maps to, so
    // sameSubject always matched first and the tier was dead code (measured as 0
    // for every book). It now means "shares only a broader ancestor".
    let everFired = false;
    for (const book of books) {
      computeRelationBuffer(books, book.id, tagMap, taxonomy, out);
      if (relationCounts(out).sharedTag > 0) {
        everFired = true;
        break;
      }
    }
    expect(everFired).toBe(true);
  });

  it('does not mark books that share only a broader branch', () => {
    // Neuromancer and Snow Crash share the cyberpunk leaf, so they are related.
    // Hyperion shares only the Science Fiction ancestor, which is too weak to
    // mark — allowing it put 46% of the corpus into some relation.
    computeRelationBuffer(books, 'neuromancer', tagMap, taxonomy, out);
    expect(out[indexOf('snow-crash')]).toBe(RELATION.sameSubject);
    expect(out[indexOf('hyperion')]).toBe(RELATION.none);
  });

  it('assigns each tier consistently with its definition', () => {
    // A property assertion rather than hardcoded pairs, so it keeps holding as
    // the corpus grows: sameSubject requires a shared SPECIFIC leaf, sharedTag a
    // shared leaf that is too common to be specific.
    const isLeaf = (nodeId: string): boolean =>
      (taxonomy.byId.get(nodeId)?.childIds.length ?? 0) === 0;
    const limit = books.length * SPECIFIC_NODE_MAX_SHARE;
    const specific = (nodeId: string): boolean =>
      (taxonomy.membersOf.get(nodeId)?.size ?? 0) <= limit;

    for (const hovered of ['neuromancer', 'speak-memory', 'silent-spring', 'the-republic']) {
      const hoveredBook = books[indexOf(hovered)] as Book;
      const hoveredLeaves = nodesForBook(hoveredBook, tagMap).filter(isLeaf);
      const hoveredSpecific = new Set(hoveredLeaves.filter(specific));
      const hoveredCommon = new Set(hoveredLeaves.filter((n) => !specific(n)));
      computeRelationBuffer(books, hovered, tagMap, taxonomy, out);

      for (let i = 0; i < books.length; i++) {
        const book = books[i] as Book;
        if (book.id === hovered) continue;
        const leaves = nodesForBook(book, tagMap).filter(isLeaf);

        if (out[i] === RELATION.sameSubject) {
          expect(
            leaves.some((n) => hoveredSpecific.has(n)),
            `${book.id} marked sameSubject to ${hovered} without a shared specific leaf`,
          ).toBe(true);
        }
        if (out[i] === RELATION.sharedTag) {
          expect(
            leaves.some((n) => hoveredCommon.has(n)),
            `${book.id} marked sharedTag to ${hovered} without a shared common leaf`,
          ).toBe(true);
          expect(leaves.some((n) => hoveredSpecific.has(n))).toBe(false);
        }
      }
    }
  });
});
