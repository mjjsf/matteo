import { describe, expect, it } from 'vitest';
import { parseHash, serializeHash } from './urlHash';
import { authorRef, bookRef, tagRef, topicRef } from '@/domain/nodeRef';

describe('parseHash', () => {
  it('parses an empty hash', () => {
    expect(parseHash('')).toEqual({ seedRef: null, path: [], openRef: null });
    expect(parseHash('#')).toEqual({ seedRef: null, path: [], openRef: null });
  });

  it('reads a bare id as a book, so links shared before node kinds still work', () => {
    // Every URL written before the map held anything but books carries a bare
    // id. Those links must keep resolving to the same graph.
    expect(parseHash('#/from/dune').seedRef).toBe(bookRef('dune'));
    expect(parseHash('#/from/dune?open=neuromancer').openRef).toBe(bookRef('neuromancer'));
  });

  it('parses each node kind', () => {
    expect(parseHash('#/from/topic:philosophy-western').seedRef).toBe(
      topicRef('philosophy-western'),
    );
    expect(parseHash('#/from/tag:existentialism').seedRef).toBe(tagRef('existentialism'));
    expect(parseHash('#/from/author:ursula-k-le-guin').seedRef).toBe(
      authorRef('ursula-k-le-guin'),
    );
  });

  it('parses an expansion path', () => {
    expect(parseHash('#/from/dune/via/3,7,12')).toEqual({
      seedRef: bookRef('dune'),
      path: [3, 7, 12],
      openRef: null,
    });
  });

  it('decodes percent-encoded ids', () => {
    expect(parseHash('#/from/a%20b').seedRef).toBe(bookRef('a b'));
    expect(parseHash('#/from/dune?open=a%20b').openRef).toBe(bookRef('a b'));
  });

  it('drops junk in the expansion path rather than replaying NaN', () => {
    // A hand-edited or truncated URL must degrade to a shorter valid walk, not
    // to a graph built from garbage slot numbers.
    expect(parseHash('#/from/dune/via/2,oops,-4,9').path).toEqual([2, 9]);
  });

  it('rejects an unknown kind rather than inventing one', () => {
    expect(parseHash('#/from/planet:arrakis').seedRef).toBeNull();
  });

  it('does not throw on malformed input', () => {
    for (const bad of ['#/from', '#/via', '#///', '#/unknown/thing', '#?']) {
      expect(() => parseHash(bad)).not.toThrow();
    }
    expect(parseHash('#/from').seedRef).toBeNull();
  });
});

describe('serializeHash', () => {
  it('produces an empty string without a seed', () => {
    // No seed means no map, and a path or an open book without one is not a
    // state that can be restored.
    expect(serializeHash({ seedRef: null, path: [], openRef: null })).toBe('');
    expect(serializeHash({ seedRef: null, path: [1, 2], openRef: bookRef('dune') })).toBe('');
  });

  it('encodes each shape', () => {
    expect(serializeHash({ seedRef: bookRef('dune'), path: [], openRef: null })).toBe(
      '#/from/book%3Adune',
    );
    expect(serializeHash({ seedRef: bookRef('dune'), path: [3, 7], openRef: null })).toBe(
      '#/from/book%3Adune/via/3,7',
    );
    expect(serializeHash({ seedRef: tagRef('existentialism'), path: [], openRef: null })).toBe(
      '#/from/tag%3Aexistentialism',
    );
  });

  it('round-trips every shape and every kind', () => {
    const cases = [
      { seedRef: bookRef('dune'), path: [], openRef: null },
      { seedRef: bookRef('dune'), path: [3, 7, 12], openRef: null },
      { seedRef: bookRef('dune'), path: [1], openRef: bookRef('neuromancer') },
      { seedRef: bookRef('a b'), path: [], openRef: bookRef('c d') },
      { seedRef: topicRef('philosophy-western'), path: [2], openRef: tagRef('existentialism') },
      { seedRef: authorRef('ursula-k-le-guin'), path: [], openRef: null },
    ];
    for (const c of cases) {
      expect(parseHash(serializeHash(c))).toEqual(c);
    }
  });
});
