import { describe, expect, it } from 'vitest';
import { amazonLinkForBook } from './amazon';
import type { Book } from './types';

const base: Book = {
  id: 'x',
  title: 'Test Book',
  authors: ['Ada Lovelace'],
  year: 2000,
  subjects: ['a', 'b'],
  description: 'd',
};

describe('amazonLinkForBook', () => {
  it('builds a /dp/ link from a 978 ISBN-13', () => {
    const link = amazonLinkForBook({ ...base, isbn13: '9780306406157' }, 'mytag-20');
    expect(link.kind).toBe('dp');
    expect(link.href).toBe('https://www.amazon.com/dp/0306406152?tag=mytag-20');
    expect(link.label).toBe('Buy on Amazon');
  });

  it('falls back to search for a 979 ISBN-13, which has no ISBN-10', () => {
    const link = amazonLinkForBook({ ...base, isbn13: '9791234567896' }, 'mytag-20');
    expect(link.kind).toBe('search');
    expect(link.label).toBe('Find on Amazon');
    expect(link.href).toContain('/s?');
    expect(link.href).toContain('i=stripbooks');
  });

  it('falls back to search when there is no ISBN at all', () => {
    const link = amazonLinkForBook(base);
    expect(link.kind).toBe('search');
    expect(link.href).toContain('k=Test+Book+Ada+Lovelace');
  });

  it('omits the tag entirely when unset — never tag=undefined', () => {
    for (const tag of [undefined, '', '   ']) {
      const dp = amazonLinkForBook({ ...base, isbn13: '9780306406157' }, tag);
      expect(dp.href).toBe('https://www.amazon.com/dp/0306406152');
      expect(dp.href).not.toContain('tag');

      const search = amazonLinkForBook(base, tag);
      expect(search.href).not.toContain('tag=');
    }
  });

  it('appends the tag exactly once', () => {
    const link = amazonLinkForBook({ ...base, isbn13: '9780306406157' }, 'mytag-20');
    expect(link.href.match(/tag=/g)).toHaveLength(1);
  });

  it('url-encodes ampersands and accents in the search fallback', () => {
    const link = amazonLinkForBook({
      ...base,
      title: 'Sense & Sensibility',
      authors: ['Émile Zola'],
    });
    // A raw '&' would silently truncate the query parameter.
    expect(link.href).not.toContain('Sense & Sensibility');
    expect(link.href).toContain('%26');
    expect(link.href).toContain('%C3%89mile');
    expect(new URL(link.href).searchParams.get('k')).toBe('Sense & Sensibility Émile Zola');
  });

  it('handles a book with no authors without emitting "undefined"', () => {
    const link = amazonLinkForBook({ ...base, authors: [] });
    expect(link.href).not.toContain('undefined');
    expect(new URL(link.href).searchParams.get('k')).toBe('Test Book');
  });
});
