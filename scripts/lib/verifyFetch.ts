import { OPEN_LIBRARY_ORIGIN, fetchJson, type FetchLike } from './openlibraryFetch';
import type { CatalogueRecord } from './verifyMatch';

/** The HTTP half of the verification pass.
 *
 *  Open Library rather than WorldCat, and that is a finding rather than a
 *  fallback. The WorldCat Search API closed to all but libraries holding both an
 *  OCLC Cataloging and Metadata subscription and a FirstSearch/WorldCat
 *  Discovery subscription; support for v1.0 ended 31 December 2024. Open Library
 *  is CC0, needs no key, and answers the only question being asked here — does a
 *  book by this name, by this person, exist.
 *
 *  Same shape as `openlibraryFetch.ts` and reusing its `fetchJson` and
 *  User-Agent: `fetch` comes in as an argument so the tests can drive it without
 *  a network. `openlibrary.org` is blocked from the environment this was written
 *  in, so this has never run live, and the README says so rather than implying
 *  otherwise. */

/** Only the fields the verdict needs. Asking for fewer keeps the response small
 *  over a thousand requests, and keeps the recorded fixture readable. */
const FIELDS = 'key,title,author_name,first_publish_year';

/** Enough records to see past a different book sharing the title, few enough to
 *  stay cheap. `The Trial` is at least four different books. */
export const SEARCH_LIMIT = 5;

export interface SearchDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
}

export interface SearchResponse {
  numFound?: number;
  docs?: SearchDoc[];
}

export function searchUrl(title: string, author: string | undefined): string {
  const params = new URLSearchParams({ title, fields: FIELDS, limit: String(SEARCH_LIMIT) });
  // Searching by title AND author rather than by a single free-text string: a
  // combined query ranks on relevance and happily returns a book about the
  // author instead of one by them.
  if (author) params.set('author', author);
  return `${OPEN_LIBRARY_ORIGIN}/search.json?${params.toString()}`;
}

export function toRecords(response: SearchResponse): CatalogueRecord[] {
  return (response.docs ?? [])
    .filter((d): d is SearchDoc & { title: string } => typeof d.title === 'string')
    .map((d) => ({
      title: d.title,
      authors: d.author_name ?? [],
      ...(typeof d.first_publish_year === 'number' ? { year: d.first_publish_year } : {}),
    }));
}

/** Records for one book, or `undefined` when the lookup itself failed.
 *
 *  The distinction matters and is the reason this does not just return an empty
 *  array on error: no records means "the catalogue does not have this book",
 *  which is a finding worth reporting. A failed request means "we do not know",
 *  which is not. Reporting a rate-limited request as a missing book would fill
 *  the report with accusations against real books. */
export async function lookup(
  fetchImpl: FetchLike,
  title: string,
  author: string | undefined,
): Promise<CatalogueRecord[] | undefined> {
  try {
    const response = await fetchJson<SearchResponse>(fetchImpl, searchUrl(title, author));
    return toRecords(response);
  } catch {
    return undefined;
  }
}

/** Open Library asks anonymous bulk readers to throttle, which is a condition of
 *  use rather than politeness. A thousand books at this spacing is about five
 *  minutes, which is the right trade for a check that runs occasionally. */
export const REQUEST_SPACING_MS = 250;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
