import type { OpenLibrarySubjectResponse } from './openlibraryNormalize';

/** The HTTP half of the Open Library import, separated from the script so it can
 *  be exercised without a network.
 *
 *  It used to live inline in `scripts/fetch-openlibrary.ts` around a bare
 *  `fetch`, which made it untestable — and it is the one part of the import that
 *  has never actually run, because `openlibrary.org` is blocked from the
 *  environment this was built in. Untestable AND unrun is the worst pair of
 *  properties a piece of code can have.
 *
 *  Everything here takes its `fetch` as an argument. The tests drive it with
 *  recorded response shapes, so what remains unverified is narrowed to one
 *  claim: that the live endpoint still answers in the shape recorded in
 *  `test/fixtures/openlibrary/`. Everything built on top of that answer is
 *  checked. */

export const OPEN_LIBRARY_ORIGIN = 'https://openlibrary.org';

/** Open Library asks anonymous bulk readers to identify themselves and to
 *  throttle. Both are conditions of use, not optimisations. */
export const USER_AGENT =
  'matteo-book-map/0.1 (+https://github.com/mjjsf/matteo) - building a small book discovery dataset';

/** Minimal shape of `globalThis.fetch`, so a test can pass a plain function. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export function subjectUrl(subject: string, limit: number): string {
  // Encoded, because subjects legitimately contain spaces and slashes
  // ("women's studies", "history/europe") and an unencoded slash would silently
  // request a different, existing endpoint rather than fail.
  return `${OPEN_LIBRARY_ORIGIN}/subjects/${encodeURIComponent(subject)}.json?limit=${limit}`;
}

export function workUrl(workKey: string): string {
  // Work keys arrive as "/works/OL123W" — already path-shaped and already
  // encoded by the API. Re-encoding would turn the slashes into %2F.
  return `${OPEN_LIBRARY_ORIGIN}${workKey}.json`;
}

export async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return (await response.json()) as T;
}

/** Open Library returns a description as either a bare string or a
 *  `{ value }` object, and often appends a source attribution after a rule of
 *  dashes. Both shapes appear in live data; neither is documented. */
export function extractDescription(raw: unknown): string | undefined {
  const value =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null && 'value' in raw
        ? (raw as { value?: unknown }).value
        : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.split(/\r?\n----------/)[0]?.trim();
  return trimmed ? trimmed : undefined;
}

export async function fetchSubject(
  fetchImpl: FetchLike,
  subject: string,
  limit: number,
): Promise<OpenLibrarySubjectResponse> {
  return fetchJson<OpenLibrarySubjectResponse>(fetchImpl, subjectUrl(subject, limit));
}

/** A missing or failed description must not abort the run.
 *
 *  Descriptions are one extra request per work, so over a few hundred works some
 *  will time out or 404. Losing the whole subject to one of them would make the
 *  import unusable at exactly the scale it exists for; the book is simply
 *  skipped later for having no description. */
export async function fetchDescription(
  fetchImpl: FetchLike,
  workKey: string,
): Promise<string | undefined> {
  try {
    const work = await fetchJson<{ description?: unknown }>(fetchImpl, workUrl(workKey));
    return extractDescription(work.description);
  } catch {
    return undefined;
  }
}

/** Subjects still to fetch, given what a previous run recorded.
 *
 *  Resumability matters here: a few hundred works is a few hundred throttled
 *  requests, so a run that dies partway through must not start over. */
export function pendingSubjects(requested: string[], completed: string[]): string[] {
  const done = new Set(completed);
  return requested.filter((s) => !done.has(s));
}
