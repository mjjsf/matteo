import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { USER_AGENT, type FetchLike } from './openlibraryFetch';
import { SEARCH_LIMIT, lookup, searchUrl, toRecords, type SearchResponse } from './verifyFetch';

/** The request layer, driven by a stub.
 *
 *  Like the Open Library importer beside it, this has never run against the live
 *  service: `openlibrary.org` answers 403 at the egress proxy of the environment
 *  it was written in. These tests do not pretend otherwise. What they narrow it
 *  to is one unverified claim — that `/search.json` still answers in the shape
 *  recorded in `test/fixtures/catalogue/`. Everything done with that answer is
 *  checked here. */

const fixture = (name: string): SearchResponse =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../test/fixtures/catalogue/${name}.json`, import.meta.url)), 'utf8'),
  ) as SearchResponse;

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
  it('searches title and author as separate fields', () => {
    // A single free-text query ranks on relevance and returns books ABOUT an
    // author as readily as books by them.
    const url = new URL(searchUrl('Neuromancer', 'William Gibson'));
    expect(url.searchParams.get('title')).toBe('Neuromancer');
    expect(url.searchParams.get('author')).toBe('William Gibson');
    expect(url.searchParams.get('limit')).toBe(String(SEARCH_LIMIT));
  });

  it('encodes titles that would otherwise break the query', () => {
    const url = searchUrl('War & Peace: A Novel', 'Tolstoy');
    expect(url).not.toMatch(/[ &]A Novel/);
    expect(new URL(url).searchParams.get('title')).toBe('War & Peace: A Novel');
  });

  it('omits the author rather than sending an empty one', () => {
    expect(new URL(searchUrl('Beowulf', undefined)).searchParams.has('author')).toBe(false);
  });

  it('asks for only the fields the verdict needs', () => {
    // Over a thousand requests, and it keeps the recorded fixture readable.
    const fields = new URL(searchUrl('x', 'y')).searchParams.get('fields') ?? '';
    expect(fields.split(',').sort()).toEqual([
      'author_name',
      'first_publish_year',
      'key',
      'title',
    ]);
  });

  it('identifies itself, which Open Library asks anonymous bulk readers to do', async () => {
    const url = searchUrl('Neuromancer', 'William Gibson');
    const { fetch, calls } = stub({ [url]: { body: fixture('search-neuromancer') } });
    await lookup(fetch, 'Neuromancer', 'William Gibson');
    expect(calls[0]?.headers?.['User-Agent']).toBe(USER_AGENT);
  });
});

describe('the response', () => {
  it('reads the recorded shape into records', () => {
    const records = toRecords(fixture('search-neuromancer'));
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      title: 'Neuromancer',
      authors: ['William Gibson'],
      year: 1984,
    });
  });

  it('keeps a record that has no year rather than dropping it', () => {
    // A record with no year still proves the book exists, which is the finding
    // that matters most. Dropping it would report a real book as missing.
    const records = toRecords({ docs: [{ title: 'Beowulf', author_name: ['Unknown'] }] });
    expect(records).toEqual([{ title: 'Beowulf', authors: ['Unknown'] }]);
  });

  it('skips a doc with no title, which cannot be matched against anything', () => {
    expect(toRecords({ docs: [{ key: '/works/OL1W', first_publish_year: 1984 }] })).toEqual([]);
  });

  it('survives an empty or malformed body', () => {
    expect(toRecords({})).toEqual([]);
    expect(toRecords({ docs: [] })).toEqual([]);
  });
});

describe('failure is not the same as absence', () => {
  it('returns an empty list when the catalogue genuinely has nothing', async () => {
    const url = searchUrl('A Book That Does Not Exist', 'Nobody');
    const { fetch } = stub({ [url]: { body: { numFound: 0, docs: [] } } });
    await expect(lookup(fetch, 'A Book That Does Not Exist', 'Nobody')).resolves.toEqual([]);
  });

  it('returns undefined when the request failed', async () => {
    // THE distinction this layer exists to make. A rate-limited or timed-out
    // request means "we do not know", and reporting that as "the catalogue has
    // never heard of this book" would fill the report with accusations against
    // real books — which is exactly how a verification pass becomes noise and
    // stops being read.
    for (const status of [429, 500, 503]) {
      const url = searchUrl('Neuromancer', 'William Gibson');
      const { fetch } = stub({ [url]: { status } });
      await expect(lookup(fetch, 'Neuromancer', 'William Gibson')).resolves.toBeUndefined();
    }
  });

  it('returns undefined when the body is not JSON at all', async () => {
    const url = searchUrl('Neuromancer', 'William Gibson');
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    void url;
    await expect(lookup(fetch, 'Neuromancer', 'William Gibson')).resolves.toBeUndefined();
  });
});
