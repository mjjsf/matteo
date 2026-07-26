/** Pure transforms for Open Library responses.
 *
 *  Kept separate from the HTTP layer, and thoroughly tested against committed
 *  fixtures, because `openlibrary.org` is unreachable from some environments
 *  (including the one this was written in) — so the network path cannot be
 *  exercised everywhere, but the parsing can be. */

import type { Book, TagMap } from '@/domain/types';
import { isValidIsbn10, isValidIsbn13, normalizeIsbn } from '@/domain/isbn';

/** A single work as returned by /subjects/{name}.json */
export interface OpenLibraryWork {
  key?: string;
  title?: string;
  authors?: Array<{ name?: string; key?: string }>;
  subject?: string[];
  first_publish_year?: number;
  availability?: { isbn?: string };
  ia?: string[];
  lending_edition_s?: string;
}

export interface OpenLibrarySubjectResponse {
  name?: string;
  work_count?: number;
  works?: OpenLibraryWork[];
}

/** Subject fragments that carry no information and only add noise. "fiction"
 *  and "general" appear on an enormous share of records. */
const SUBJECT_FILLER = new Set([
  'general',
  'fiction',
  'fiction-general',
  'nonfiction',
  'non-fiction',
  'literature',
  'accessible-book',
  'protected-daisy',
  'in-library',
  'large-type-books',
  'reading-level-grade-9',
]);

/** Open Library subject strings are wildly inconsistent — the same concept
 *  arrives as "Science fiction", "science-fiction", and
 *  "Fiction, science fiction, general". Collapse to a comparable slug. */
export function normalizeSubject(raw: string): string[] {
  return raw
    .split(',')
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((s) => s.length > 1 && !SUBJECT_FILLER.has(s));
}

/** Map normalised Open Library subjects onto the project's own tag vocabulary.
 *  Anything unrecognised is dropped: an unknown tag would fail the corpus
 *  integrity test anyway, and silently inventing vocabulary would degrade the
 *  layout without anything catching it. */
export function mapSubjectsToTags(rawSubjects: string[], tagMap: TagMap): string[] {
  const known = new Set(Object.keys(tagMap));
  const out = new Set<string>();
  for (const raw of rawSubjects) {
    for (const slug of normalizeSubject(raw)) {
      if (known.has(slug)) out.add(slug);
    }
  }
  return [...out].sort();
}

export function slugifyId(title: string, author: string | undefined): string {
  const base = `${title} ${author ?? ''}`
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 60).replace(/-+$/, '');
}

export function extractAuthors(work: OpenLibraryWork): string[] {
  return (work.authors ?? [])
    .map((a) => a.name?.trim())
    .filter((n): n is string => Boolean(n));
}

/** Preference order: a valid ISBN-13, else a valid ISBN-10, else nothing.
 *  Never returns a malformed identifier — a wrong ISBN would deep-link to the
 *  wrong product on Amazon, which is worse than having no link. */
export function extractIsbn(work: OpenLibraryWork): { isbn13?: string; isbn10?: string } {
  const raw = work.availability?.isbn;
  if (!raw) return {};
  const s = normalizeIsbn(raw);
  if (isValidIsbn13(s)) return { isbn13: s };
  if (isValidIsbn10(s)) return { isbn10: s };
  return {};
}

export interface NormalizeOptions {
  tagMap: TagMap;
  /** Ids already present, so fetched books never collide with authored ones. */
  existingIds: Set<string>;
  /** Descriptions are not in the subjects response; supply one if fetched
   *  separately, otherwise the work is skipped (see `minSubjects`). */
  descriptionFor?: (work: OpenLibraryWork) => string | undefined;
  /** The corpus test requires at least two subjects for a book to be
   *  positionable. */
  minSubjects?: number;
}

export interface NormalizeResult {
  books: Book[];
  skipped: Array<{ title: string; reason: string }>;
}

/** Convert a subjects response into corpus books, dropping anything that would
 *  fail the corpus integrity tests rather than emitting it and breaking CI. */
export function normalizeWorks(
  works: OpenLibraryWork[],
  options: NormalizeOptions,
): NormalizeResult {
  const minSubjects = options.minSubjects ?? 2;
  const books: Book[] = [];
  const skipped: Array<{ title: string; reason: string }> = [];
  const seen = new Set(options.existingIds);

  for (const work of works) {
    const title = work.title?.trim();
    if (!title) {
      skipped.push({ title: '(untitled)', reason: 'no title' });
      continue;
    }

    const authors = extractAuthors(work);
    if (authors.length === 0) {
      skipped.push({ title, reason: 'no authors' });
      continue;
    }

    const subjects = mapSubjectsToTags(work.subject ?? [], options.tagMap);
    if (subjects.length < minSubjects) {
      skipped.push({
        title,
        reason: `only ${subjects.length} recognised subject(s); needs ${minSubjects}`,
      });
      continue;
    }

    const year = work.first_publish_year;
    if (typeof year !== 'number' || year < -3000 || year > 2100) {
      skipped.push({ title, reason: 'implausible or missing year' });
      continue;
    }

    const description = options.descriptionFor?.(work)?.trim();
    if (!description || description.length < 80 || description.length > 600) {
      skipped.push({ title, reason: 'description missing or outside 80-600 chars' });
      continue;
    }

    const id = slugifyId(title, authors[0]);
    if (!id || seen.has(id)) {
      skipped.push({ title, reason: id ? `duplicate id "${id}"` : 'empty id' });
      continue;
    }
    seen.add(id);

    books.push({
      id,
      title,
      authors,
      year,
      subjects,
      description,
      ...extractIsbn(work),
    });
  }

  return { books, skipped };
}
