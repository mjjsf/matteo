import { describe, expect, it } from 'vitest';
import { bookshopLinkForBook, shouldDiscloseAffiliate } from './bookshop';
import type { Book } from './types';

const base: Book = {
  id: 'x',
  title: 'Test Book',
  authors: ['Ada Lovelace'],
  year: 2000,
  subjects: ['a', 'b'],
  description: 'd',
};

describe('the search link, which is every link in the corpus today', () => {
  it('is what a book with no ISBN gets', () => {
    // Not an edge case: no book in the corpus records an ISBN, so this branch is
    // the live one and the product branch below is currently unreachable.
    const link = bookshopLinkForBook(base);
    expect(link.kind).toBe('search');
    expect(link.label).toBe('Find on Bookshop.org');
    expect(new URL(link.href).host).toBe('bookshop.org');
    expect(new URL(link.href).searchParams.get('keywords')).toBe('Test Book Ada Lovelace');
  });

  it('url-encodes ampersands and accents', () => {
    const link = bookshopLinkForBook({
      ...base,
      title: 'Sense & Sensibility',
      authors: ['Émile Zola'],
    });
    // A raw '&' would silently truncate the query parameter.
    expect(link.href).not.toContain('Sense & Sensibility');
    expect(link.href).toContain('%26');
    expect(new URL(link.href).searchParams.get('keywords')).toBe('Sense & Sensibility Émile Zola');
  });

  it('handles a book with no authors without emitting "undefined"', () => {
    const link = bookshopLinkForBook({ ...base, authors: [] });
    expect(link.href).not.toContain('undefined');
    expect(new URL(link.href).searchParams.get('keywords')).toBe('Test Book');
  });

  it('is never marked sponsored, because a search cannot carry attribution', () => {
    // Bookshop attributes through the `/a/{id}` path segment, which a search URL
    // has nowhere to put. `rel="sponsored"` on a link that can earn nothing is a
    // misstatement about a commercial relationship, so the flag says so.
    expect(bookshopLinkForBook(base, 'my-affiliate-id').sponsored).toBe(false);
    expect(bookshopLinkForBook(base, 'my-affiliate-id').href).not.toContain('/a/');
  });
});

describe('the product link, which goes live when the corpus has ISBNs', () => {
  it('uses the documented affiliate format when an id is configured', () => {
    const link = bookshopLinkForBook({ ...base, isbn13: '9780306406157' }, '5780');
    expect(link.kind).toBe('product');
    expect(link.href).toBe('https://bookshop.org/a/5780/9780306406157');
    expect(link.label).toBe('Buy on Bookshop.org');
    expect(link.sponsored).toBe(true);
  });

  it('drops to a plain book URL with no affiliate id', () => {
    for (const id of [undefined, '', '   ']) {
      const link = bookshopLinkForBook({ ...base, isbn13: '9780306406157' }, id);
      expect(link.href).toBe('https://bookshop.org/book/9780306406157');
      expect(link.href).not.toContain('/a/');
      expect(link.sponsored).toBe(false);
    }
  });

  it('accepts a 979 ISBN, which the Amazon path could not', () => {
    // The old link built an ISBN-10 for Amazon's ASIN, and 979-prefixed ISBN-13s
    // have no ISBN-10 at all — so those books silently fell back to a search.
    // Bookshop takes the 13 directly and the whole edge case is gone.
    const link = bookshopLinkForBook({ ...base, isbn13: '9791234567896' }, '5780');
    expect(link.kind).toBe('product');
    expect(link.href).toContain('9791234567896');
  });

  it('converts an ISBN-10 rather than falling back to a search', () => {
    const link = bookshopLinkForBook({ ...base, isbn10: '0306406152' }, '5780');
    expect(link.href).toBe('https://bookshop.org/a/5780/9780306406157');
  });

  it('falls back to a search rather than linking a malformed ISBN', () => {
    const link = bookshopLinkForBook({ ...base, isbn13: '9780306406150' }, '5780');
    expect(link.kind).toBe('search');
  });

  it('encodes an affiliate id rather than trusting it into the path', () => {
    const link = bookshopLinkForBook({ ...base, isbn13: '9780306406157' }, 'a/b');
    expect(link.href).toBe('https://bookshop.org/a/a%2Fb/9780306406157');
  });
});

describe('the affiliate disclosure', () => {
  it('is withheld when there is no affiliate relationship to disclose', () => {
    // The Amazon version rendered unconditionally, so the app told every visitor
    // it earned commission on their purchases while carrying no tag and earning
    // nothing. A false disclosure is a claim about a commercial relationship
    // that does not exist, not a harmless extra.
    expect(shouldDiscloseAffiliate(undefined)).toBe(false);
    expect(shouldDiscloseAffiliate('5780')).toBe(true);
  });
});
