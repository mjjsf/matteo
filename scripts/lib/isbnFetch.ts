import { OPEN_LIBRARY_ORIGIN, fetchJson, type FetchLike } from './openlibraryFetch';
import type { CatalogueRecord } from './verifyMatch';

/** The HTTP half of the ISBN enrichment pass.
 *
 *  Deliberately almost identical to `verifyFetch.ts`: same endpoint, same
 *  title-AND-author query, same throttle, same error/empty distinction. The only
 *  difference is that it also asks for `isbn`, because this pass needs to come
 *  back with a number rather than a verdict.
 *
 *  UNVERIFIED FROM THIS ENVIRONMENT, and stated here rather than buried:
 *  `openlibrary.org` answers 403 at the egress proxy of the sandbox this was
 *  written in, so no request has ever been made against it. That `isbn` is a
 *  valid `fields` value on `search.json` is therefore a claim, not an
 *  observation.
 *
 *  Unlike the Bookshop search path, it FAILS SAFE. If the field name is wrong the
 *  response simply carries no ISBNs, `toDocs` yields empty `isbns` arrays, and
 *  the run reports "no usable ISBN" for every book and writes nothing. A wrong
 *  guess here costs a wasted run, not a corpus full of bad data. */

/** `isbn` on top of what the verify pass asks for. Still a narrow field list:
 *  this runs a thousand times, and a full search document is large. */
const FIELDS = 'key,title,author_name,first_publish_year,isbn';

/** Same as the verify pass. Enough records to see past a different book sharing
 *  the title, few enough to stay cheap. */
export const SEARCH_LIMIT = 5;

export interface IsbnSearchDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  /** Every ISBN Open Library knows for the work, across ALL of its editions.
   *  Unordered, and mixing formats, languages and reissues. */
  isbn?: string[];
}

export interface IsbnSearchResponse {
  numFound?: number;
  docs?: IsbnSearchDoc[];
}

/** A catalogue record that also carries the ISBNs it came with.
 *
 *  Structurally a `CatalogueRecord`, which is the point: `verify` and
 *  `bestMatch` take these unchanged, and `bestMatch` returns the very object it
 *  was given, so the ISBNs of the matching record are already in hand. No
 *  parallel lookup table, and no change to the matcher. */
export interface IsbnDoc extends CatalogueRecord {
  isbns: string[];
}

export function searchUrl(title: string, author: string | undefined): string {
  const params = new URLSearchParams({ title, fields: FIELDS, limit: String(SEARCH_LIMIT) });
  // Title AND author as separate parameters, for the same reason as the verify
  // pass: a combined free-text query ranks on relevance and will happily return
  // a book *about* the author instead of one by them.
  if (author) params.set('author', author);
  return `${OPEN_LIBRARY_ORIGIN}/search.json?${params.toString()}`;
}

export function toDocs(response: IsbnSearchResponse): IsbnDoc[] {
  return (response.docs ?? [])
    .filter((d): d is IsbnSearchDoc & { title: string } => typeof d.title === 'string')
    .map((d) => ({
      title: d.title,
      authors: d.author_name ?? [],
      ...(typeof d.first_publish_year === 'number' ? { year: d.first_publish_year } : {}),
      // Tolerant of the field being absent, a non-array, or holding non-strings.
      // A malformed response should cost this one book its ISBN, not the run.
      isbns: Array.isArray(d.isbn) ? d.isbn.filter((x): x is string => typeof x === 'string') : [],
    }));
}

/** Records for one book, or `undefined` when the lookup itself failed.
 *
 *  The distinction is load-bearing, exactly as in `verifyFetch.lookup`: no
 *  records means the catalogue does not have this book, a failed request means we
 *  do not know. Here it decides whether a book is reported as unmatched — an
 *  editorial signal — or as unreachable, which only means "run it again". */
export async function lookup(
  fetchImpl: FetchLike,
  title: string,
  author: string | undefined,
): Promise<IsbnDoc[] | undefined> {
  try {
    const response = await fetchJson<IsbnSearchResponse>(fetchImpl, searchUrl(title, author));
    return toDocs(response);
  } catch {
    return undefined;
  }
}
