import { describe, expect, it } from 'vitest';
import {
  OPEN_LIBRARY_ORIGIN,
  USER_AGENT,
  extractDescription,
  fetchDescription,
  fetchJson,
  fetchSubject,
  pendingSubjects,
  subjectUrl,
  workUrl,
  type FetchLike,
} from './openlibraryFetch';

/** The request layer, driven by a stub.
 *
 *  This is the only part of the import that has never run against the live
 *  service — `openlibrary.org` is blocked from the environment this was built
 *  in. These tests do not pretend otherwise. What they narrow it to is a single
 *  unverified claim: that the endpoint still answers in the shape recorded in
 *  `test/fixtures/openlibrary/`. Everything the importer does with that answer
 *  is checked here. */

interface Call {
  url: string;
  headers?: Record<string, string>;
}

function stub(
  routes: Record<string, { status?: number; body?: unknown }>,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
    const route = routes[url] ?? { status: 404 };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Not Found',
      json: async () => route.body,
    };
  };
  return { fetch, calls };
}

describe('url construction', () => {
  it('percent-encodes the subject', () => {
    // Subjects legitimately contain spaces and slashes. An unencoded slash would
    // silently address a different, existing endpoint rather than fail.
    expect(subjectUrl("women's studies", 50)).toBe(
      `${OPEN_LIBRARY_ORIGIN}/subjects/women's%20studies.json?limit=50`,
    );
    expect(subjectUrl('history/europe', 10)).toContain('history%2Feurope');
  });

  it('leaves a work key path-shaped', () => {
    // Work keys arrive already encoded and already path-shaped; re-encoding
    // would turn the slashes into %2F and 404 every description.
    expect(workUrl('/works/OL1234W')).toBe(`${OPEN_LIBRARY_ORIGIN}/works/OL1234W.json`);
  });
});

describe('fetchJson', () => {
  it('identifies itself, as Open Library asks anonymous readers to', () => {
    const { fetch, calls } = stub({ 'https://x/a.json': { body: { ok: 1 } } });
    return fetchJson(fetch, 'https://x/a.json').then(() => {
      expect(calls[0]?.headers?.['User-Agent']).toBe(USER_AGENT);
      expect(calls[0]?.headers?.Accept).toBe('application/json');
    });
  });

  it('throws with the status and the url on a non-2xx', async () => {
    const { fetch } = stub({ 'https://x/a.json': { status: 404 } });
    await expect(fetchJson(fetch, 'https://x/a.json')).rejects.toThrow(
      /404 Not Found for https:\/\/x\/a\.json/,
    );
  });
});

describe('extractDescription', () => {
  it('accepts both shapes the API actually returns', () => {
    expect(extractDescription('A plain string.')).toBe('A plain string.');
    expect(extractDescription({ value: 'An object.' })).toBe('An object.');
  });

  it('strips the trailing source attribution', () => {
    const raw = 'The real description.\n----------\nContributed by someone';
    expect(extractDescription(raw)).toBe('The real description.');
    expect(extractDescription({ value: `Object form.\r\n----------\r\nsource` })).toBe(
      'Object form.',
    );
  });

  it('returns undefined rather than an empty string', () => {
    // A book with no description is skipped downstream. An empty string would
    // pass that check and ship a book with a blank description instead.
    expect(extractDescription(undefined)).toBeUndefined();
    expect(extractDescription({})).toBeUndefined();
    expect(extractDescription('')).toBeUndefined();
    expect(extractDescription('   ')).toBeUndefined();
    expect(extractDescription('\n----------\nonly attribution')).toBeUndefined();
    expect(extractDescription(42)).toBeUndefined();
  });
});

describe('fetchDescription', () => {
  it('returns the description for a work', async () => {
    const { fetch } = stub({
      [workUrl('/works/OL1W')]: { body: { description: { value: 'Hello.' } } },
    });
    expect(await fetchDescription(fetch, '/works/OL1W')).toBe('Hello.');
  });

  it('swallows a failure instead of aborting the run', async () => {
    // Descriptions are one extra request per work, so across a few hundred works
    // some will 404 or time out. Losing the whole subject to one of them would
    // make the import useless at exactly the scale it exists for.
    const { fetch } = stub({ [workUrl('/works/OL1W')]: { status: 500 } });
    expect(await fetchDescription(fetch, '/works/OL1W')).toBeUndefined();
  });

  it('survives a response that is not JSON at all', async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    expect(await fetchDescription(fetch, '/works/OL1W')).toBeUndefined();
  });
});

describe('fetchSubject', () => {
  it('requests the subject endpoint and returns its works', async () => {
    const url = subjectUrl('science_fiction', 2);
    const { fetch, calls } = stub({
      [url]: { body: { name: 'science_fiction', works: [{ key: '/works/OL1W' }] } },
    });
    const response = await fetchSubject(fetch, 'science_fiction', 2);
    expect(calls[0]?.url).toBe(url);
    expect(response.works).toHaveLength(1);
  });

  it('propagates a failure so the caller can skip the subject', async () => {
    const { fetch } = stub({ [subjectUrl('nope', 1)]: { status: 503 } });
    await expect(fetchSubject(fetch, 'nope', 1)).rejects.toThrow(/503/);
  });
});

describe('pendingSubjects', () => {
  it('skips what a previous run finished, preserving order', () => {
    // A few hundred works is a few hundred throttled requests. A run that dies
    // partway through must not start over.
    expect(pendingSubjects(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(pendingSubjects(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(pendingSubjects(['a'], [])).toEqual(['a']);
  });
});
