import { describe, expect, it } from 'vitest';
import { USER_AGENT, type FetchLike } from './openlibraryFetch';
import { SEARCH_LIMIT, lookup, searchUrl, toDocs, type IsbnSearchResponse } from './isbnFetch';
import { bestMatch, verify } from './verifyMatch';
import type { Book } from '@/domain/types';

/** The request layer for the ISBN pass, driven by a stub.
 *
 *  Like the verify pass beside it, this has never run against the live service:
 *  `openlibrary.org` answers 403 at the egress proxy of the environment it was
 *  written in. These tests narrow the unverified part to one claim — that
 *  `/search.json` answers in this shape and accepts `isbn` as a field. What is
 *  checked here is everything done with the answer, INCLUDING that a response
 *  with no ISBNs at all costs nothing, which is what makes a wrong guess about
 *  the field name safe. */

interface Call {
  url: string;
  headers?: Record<string, string>;
}

function stub(routes: Record<string, { status?: number; body?: unknown }>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
    const route = routes[url] ?? { status: 404 };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => route.body ?? {},
    };
  };
  return { fetch, calls };
}

describe('the request', () => {
  it('asks for the isbn field on top of what the verify pass needs', () => {
    // The one thing that makes this pass different from `verifyFetch`.
    const fields = new URL(searchUrl('Neuromancer', 'William Gibson')).searchParams.get('fields');
    expect(fields).toContain('isbn');
    expect(fields).toContain('title');
    expect(fields).toContain('author_name');
    expect(fields).toContain('first_publish_year');
  });

  it('searches title and author as separate fields', () => {
    // A single free-text query ranks on relevance and returns books ABOUT an
    // author as readily as books by them.
    const url = new URL(searchUrl('Neuromancer', 'William Gibson'));
    expect(url.searchParams.get('title')).toBe('Neuromancer');
    expect(url.searchParams.get('author')).toBe('William Gibson');
    expect(url.searchParams.get('limit')).toBe(String(SEARCH_LIMIT));
  });

  it('omits the author rather than sending an empty one', () => {
    expect(new URL(searchUrl('Beowulf', undefined)).searchParams.has('author')).toBe(false);
  });

  it('identifies itself, which Open Library asks bulk readers to do', async () => {
    const url = searchUrl('Neuromancer', 'William Gibson');
    const { fetch, calls } = stub({ [url]: { body: { docs: [] } } });
    await lookup(fetch, 'Neuromancer', 'William Gibson');
    expect(calls[0]?.headers?.['User-Agent']).toBe(USER_AGENT);
  });
});

describe('reading the response', () => {
  it('carries each record’s ISBNs alongside the fields the matcher needs', () => {
    const docs = toDocs({
      docs: [
        {
          key: '/works/OL27258W',
          title: 'Neuromancer',
          author_name: ['William Gibson'],
          first_publish_year: 1984,
          isbn: ['9780441569595', '0441569595'],
        },
      ],
    });
    expect(docs).toEqual([
      {
        title: 'Neuromancer',
        authors: ['William Gibson'],
        year: 1984,
        isbns: ['9780441569595', '0441569595'],
      },
    ]);
  });

  it('yields empty ISBNs when the field is absent, and does not throw', () => {
    // This is the shape a WRONG FIELD NAME produces, so it is the case that
    // decides whether an unverified guess is safe. It has to cost the book its
    // ISBN and nothing more.
    const docs = toDocs({ docs: [{ title: 'Neuromancer', author_name: ['William Gibson'] }] });
    expect(docs).toEqual([{ title: 'Neuromancer', authors: ['William Gibson'], isbns: [] }]);
  });

  it('survives an isbn field that is not an array of strings', () => {
    const docs = toDocs({
      docs: [{ title: 'Neuromancer', isbn: 'nine-seven-eight' as unknown as string[] }],
    });
    expect(docs[0]?.isbns).toEqual([]);
  });

  it('drops non-strings mixed into the isbn array', () => {
    const docs = toDocs({
      docs: [{ title: 'Neuromancer', isbn: [null, 42, '9780441569595'] as unknown as string[] }],
    });
    expect(docs[0]?.isbns).toEqual(['9780441569595']);
  });

  it('skips a record with no title, which the matcher could not use', () => {
    expect(toDocs({ docs: [{ key: '/works/OL1W', first_publish_year: 1984 }] })).toEqual([]);
  });

  it('treats a missing docs array as no records', () => {
    expect(toDocs({} as IsbnSearchResponse)).toEqual([]);
  });
});

describe('the docs feed the existing matcher unchanged', () => {
  const book: Book = {
    id: 'neuromancer',
    title: 'Neuromancer',
    authors: ['William Gibson'],
    year: 1984,
    subjects: ['cyberpunk', 'science-fiction'],
    description: 'x',
  };

  // The whole reason `IsbnDoc extends CatalogueRecord`: no second matcher, and no
  // lookup table pairing records back to their ISBNs.
  const docs = toDocs({
    docs: [
      {
        title: 'Neuromancer: The Graphic Novel',
        author_name: ['William Gibson', 'Tom de Haven'],
        first_publish_year: 1989,
        isbn: ['9781606993071'],
      },
      {
        title: 'Neuromancer',
        author_name: ['William Gibson'],
        first_publish_year: 1984,
        isbn: ['9780441569595'],
      },
    ],
  });

  it('verifies against them without conversion', () => {
    expect(verify(book, docs).kind).toBe('ok');
  });

  it('returns the SAME object, so the winner’s ISBNs are already in hand', () => {
    const match = bestMatch(book, docs);
    expect(match).toBe(docs[1]);
    expect(docs[1]?.isbns).toEqual(['9780441569595']);
  });

  it('does not hand back the graphic novel’s ISBN for the novel', () => {
    // The exact failure this pass has to avoid: a real, checksum-valid ISBN for a
    // genuinely different work would deep-link confidently to the wrong book.
    expect(bestMatch(book, docs)).not.toBe(docs[0]);
  });
});

describe('a failed request is not an empty catalogue', () => {
  it('returns undefined on an error status', async () => {
    // The distinction decides whether a book is reported as unmatched — an
    // editorial signal — or as unreachable, which only means "run it again".
    const url = searchUrl('Neuromancer', 'William Gibson');
    const { fetch } = stub({ [url]: { status: 503 } });
    expect(await lookup(fetch, 'Neuromancer', 'William Gibson')).toBeUndefined();
  });

  it('returns undefined when the transport itself throws', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await lookup(fetch, 'Neuromancer', 'William Gibson')).toBeUndefined();
  });

  it('returns an empty array when the catalogue genuinely has nothing', async () => {
    const url = searchUrl('Nonesuch', undefined);
    const { fetch } = stub({ [url]: { body: { numFound: 0, docs: [] } } });
    expect(await lookup(fetch, 'Nonesuch', undefined)).toEqual([]);
  });
});
