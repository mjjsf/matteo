import Fuse from 'fuse.js';
import type { Book, SearchHit } from './types';

/** Fuzzy search over the corpus.
 *
 *  `description` is deliberately EXCLUDED from the index. At a few thousand
 *  books, indexing descriptions costs hundreds of milliseconds of bitap build
 *  on startup, and it makes matching noticeably worse: a description that
 *  happens to mention "space" would rank alongside a book actually titled
 *  *Space*. Title, authors, and subjects are what people search by. */
export function createSearchIndex(books: Book[]): Fuse<Book> {
  return new Fuse(books, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'authors', weight: 0.3 },
      { name: 'subjects', weight: 0.2 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
}

/** Minimum query length that produces results. One character matches almost
 *  everything and makes the scene flash on every keystroke. */
export const MIN_QUERY_LENGTH = 2;

export function runSearch(fuse: Fuse<Book>, query: string): SearchHit[] {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];
  return fuse.search(q).map((r) => ({ book: r.item, score: r.score ?? 1 }));
}

/** Matched ids, or `null` when there is no active search.
 *
 *  `null` and an empty Set mean different things and must not be conflated:
 *  null = "no search, show everything", empty Set = "searched, found nothing,
 *  dim everything". Collapsing them is the classic bug where clearing the
 *  search box hides the entire corpus. */
export function matchedIdsFor(hits: SearchHit[], query: string): Set<string> | null {
  if (query.trim().length < MIN_QUERY_LENGTH) return null;
  return new Set(hits.map((h) => h.book.id));
}
