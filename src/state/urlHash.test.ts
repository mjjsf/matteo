import { describe, expect, it } from 'vitest';
import { parseHash, serializeHash } from './urlHash';

describe('parseHash', () => {
  it('parses an empty hash', () => {
    expect(parseHash('')).toEqual({ bookId: null, branchId: null, query: '' });
    expect(parseHash('#')).toEqual({ bookId: null, branchId: null, query: '' });
  });

  it('parses a book route', () => {
    expect(parseHash('#/book/dune')).toEqual({ bookId: 'dune', branchId: null, query: '' });
  });

  it('parses a branch route', () => {
    expect(parseHash('#/branch/spec-sf')).toEqual({
      bookId: null,
      branchId: 'spec-sf',
      query: '',
    });
  });

  it('parses a combined branch + book route', () => {
    expect(parseHash('#/branch/spec-sf/book/dune')).toEqual({
      bookId: 'dune',
      branchId: 'spec-sf',
      query: '',
    });
  });

  it('parses a query', () => {
    expect(parseHash('#?q=cyberpunk').query).toBe('cyberpunk');
    expect(parseHash('#/book/dune?q=desert').query).toBe('desert');
  });

  it('decodes percent-encoded ids and queries', () => {
    expect(parseHash('#/book/a%20b').bookId).toBe('a b');
    expect(parseHash('#?q=science%20fiction').query).toBe('science fiction');
  });

  it('does not throw on malformed input', () => {
    for (const bad of ['#/book', '#/branch', '#///', '#/unknown/thing', '#?']) {
      expect(() => parseHash(bad)).not.toThrow();
    }
    expect(parseHash('#/book').bookId).toBeNull();
  });
});

describe('serializeHash', () => {
  it('produces an empty string when there is nothing to encode', () => {
    expect(serializeHash({ bookId: null, branchId: null, query: '' })).toBe('');
    expect(serializeHash({ bookId: null, branchId: null, query: '   ' })).toBe('');
  });

  it('encodes each shape', () => {
    expect(serializeHash({ bookId: 'dune', branchId: null, query: '' })).toBe('#/book/dune');
    expect(serializeHash({ bookId: null, branchId: 'spec-sf', query: '' })).toBe('#/branch/spec-sf');
    expect(serializeHash({ bookId: 'dune', branchId: 'spec-sf', query: '' })).toBe(
      '#/branch/spec-sf/book/dune',
    );
    expect(serializeHash({ bookId: null, branchId: null, query: 'noir' })).toBe('#?q=noir');
  });

  it('round-trips every shape', () => {
    const cases = [
      { bookId: 'dune', branchId: null, query: '' },
      { bookId: null, branchId: 'spec-sf', query: '' },
      { bookId: 'dune', branchId: 'spec-sf', query: 'desert' },
      { bookId: null, branchId: null, query: 'science fiction' },
    ];
    for (const c of cases) {
      expect(parseHash(serializeHash(c))).toEqual(c);
    }
  });

  it('trims the query rather than encoding whitespace', () => {
    expect(serializeHash({ bookId: null, branchId: null, query: '  noir  ' })).toBe('#?q=noir');
  });
});
