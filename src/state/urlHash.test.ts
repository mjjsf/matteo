import { describe, expect, it } from 'vitest';
import { parseHash, serializeHash } from './urlHash';

describe('parseHash', () => {
  it('parses an empty hash', () => {
    expect(parseHash('')).toEqual({ seedId: null, path: [], openId: null });
    expect(parseHash('#')).toEqual({ seedId: null, path: [], openId: null });
  });

  it('parses a seed route', () => {
    expect(parseHash('#/from/dune')).toEqual({ seedId: 'dune', path: [], openId: null });
  });

  it('parses an expansion path', () => {
    expect(parseHash('#/from/dune/via/3,7,12')).toEqual({
      seedId: 'dune',
      path: [3, 7, 12],
      openId: null,
    });
  });

  it('parses the open book', () => {
    expect(parseHash('#/from/dune?open=neuromancer').openId).toBe('neuromancer');
  });

  it('decodes percent-encoded ids', () => {
    expect(parseHash('#/from/a%20b').seedId).toBe('a b');
    expect(parseHash('#/from/dune?open=a%20b').openId).toBe('a b');
  });

  it('drops junk in the expansion path rather than replaying NaN', () => {
    // A hand-edited or truncated URL must degrade to a shorter valid walk, not
    // to a graph built from garbage slot numbers.
    expect(parseHash('#/from/dune/via/2,oops,-4,9').path).toEqual([2, 9]);
  });

  it('does not throw on malformed input', () => {
    for (const bad of ['#/from', '#/via', '#///', '#/unknown/thing', '#?']) {
      expect(() => parseHash(bad)).not.toThrow();
    }
    expect(parseHash('#/from').seedId).toBeNull();
  });
});

describe('serializeHash', () => {
  it('produces an empty string without a seed', () => {
    // No seed means no map, and a path or an open book without one is not a
    // state that can be restored.
    expect(serializeHash({ seedId: null, path: [], openId: null })).toBe('');
    expect(serializeHash({ seedId: null, path: [1, 2], openId: 'dune' })).toBe('');
  });

  it('encodes each shape', () => {
    expect(serializeHash({ seedId: 'dune', path: [], openId: null })).toBe('#/from/dune');
    expect(serializeHash({ seedId: 'dune', path: [3, 7], openId: null })).toBe('#/from/dune/via/3,7');
    expect(serializeHash({ seedId: 'dune', path: [], openId: 'neuromancer' })).toBe(
      '#/from/dune?open=neuromancer',
    );
  });

  it('round-trips every shape', () => {
    const cases = [
      { seedId: 'dune', path: [], openId: null },
      { seedId: 'dune', path: [3, 7, 12], openId: null },
      { seedId: 'dune', path: [1], openId: 'neuromancer' },
      { seedId: 'a b', path: [], openId: 'c d' },
    ];
    for (const c of cases) {
      expect(parseHash(serializeHash(c))).toEqual(c);
    }
  });
});
