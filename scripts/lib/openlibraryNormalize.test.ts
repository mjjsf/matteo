import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTagMap } from '@/domain/fixtures';
import type { TagMap } from '@/domain/types';
import {
  extractAuthors,
  extractIsbn,
  mapSubjectsToTags,
  normalizeSubject,
  normalizeWorks,
  slugifyId,
  type OpenLibrarySubjectResponse,
} from './openlibraryNormalize';

/** This is how the unrunnable fetch script still gets real coverage: the pure
 *  transform is exercised against a committed sample of the actual API shape,
 *  so the parsing is verified even where the host is unreachable. */
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../test/fixtures/openlibrary/subject-science-fiction.json', import.meta.url)),
    'utf8',
  ),
) as OpenLibrarySubjectResponse;

const tagMap: TagMap = loadTagMap();

describe('normalizeSubject', () => {
  it('collapses the many spellings Open Library actually returns', () => {
    expect(normalizeSubject('Science fiction')).toEqual(['science-fiction']);
    expect(normalizeSubject('science-fiction')).toEqual(['science-fiction']);
    expect(normalizeSubject('SPACE OPERA')).toEqual(['space-opera']);
  });

  it('splits comma-separated compound subjects', () => {
    expect(normalizeSubject('Fiction, science fiction, general')).toEqual([
      'science-fiction',
    ]);
  });

  it('drops uninformative filler and single characters', () => {
    // "fiction" and "general" appear on an enormous share of records and would
    // dominate the vocabulary while distinguishing nothing.
    expect(normalizeSubject('general')).toEqual([]);
    expect(normalizeSubject('Fiction')).toEqual([]);
    expect(normalizeSubject('accessible book, protected daisy')).toEqual([]);
    expect(normalizeSubject('a, b')).toEqual([]);
  });

  it('strips apostrophes and punctuation', () => {
    expect(normalizeSubject("Children's literature")).toEqual(['childrens-literature']);
  });
});

describe('mapSubjectsToTags', () => {
  it('keeps only tags in the project vocabulary', () => {
    const tags = mapSubjectsToTags(
      ['Cyberpunk', 'Something Entirely Unmapped', 'Space opera'],
      tagMap,
    );
    expect(tags).toContain('cyberpunk');
    expect(tags).toContain('space-opera');
    expect(tags).not.toContain('something-entirely-unmapped');
  });

  it('deduplicates and sorts', () => {
    expect(mapSubjectsToTags(['Cyberpunk', 'cyberpunk'], tagMap)).toEqual(['cyberpunk']);
  });

  it('returns nothing for entirely unknown input', () => {
    expect(mapSubjectsToTags(['Zzzz Unknown'], tagMap)).toEqual([]);
  });
});

describe('extractIsbn', () => {
  it('prefers a valid ISBN-13', () => {
    expect(extractIsbn({ availability: { isbn: '9780306406157' } })).toEqual({
      isbn13: '9780306406157',
    });
  });

  it('accepts a hyphenated ISBN-10', () => {
    expect(extractIsbn({ availability: { isbn: '0-306-40615-2' } })).toEqual({
      isbn10: '0306406152',
    });
  });

  it('emits nothing for a malformed identifier', () => {
    // Better no link than a link to the wrong product.
    expect(extractIsbn({ availability: { isbn: 'notanisbn' } })).toEqual({});
    expect(extractIsbn({})).toEqual({});
  });
});

describe('slugifyId / extractAuthors', () => {
  it('builds a url-safe id', () => {
    expect(slugifyId('The Left Hand of Darkness', 'Ursula K. Le Guin')).toBe(
      'the-left-hand-of-darkness-ursula-k-le-guin',
    );
  });

  it('never ends with a hyphen', () => {
    expect(slugifyId('Title!!!', undefined)).toBe('title');
  });

  it('drops author entries without a name', () => {
    expect(extractAuthors({ authors: [{ name: 'A' }, { key: '/authors/x' }] })).toEqual(['A']);
  });
});

describe('normalizeWorks against the fixture', () => {
  const describedTitles = new Set([
    'A Well Formed Work',
    'Inconsistent Subject Casing',
    'No Authors Here',
    'Only One Known Subject',
    'Missing Year',
    'Bad Isbn',
  ]);
  const result = normalizeWorks(fixture.works ?? [], {
    tagMap,
    existingIds: new Set(),
    descriptionFor: (w) =>
      describedTitles.has(w.title ?? '')
        ? 'A description of adequate length for the corpus integrity rules, comfortably over the eighty character minimum required.'
        : undefined,
  });

  it('accepts the well-formed works', () => {
    const titles = result.books.map((b) => b.title);
    expect(titles).toContain('A Well Formed Work');
    expect(titles).toContain('Inconsistent Subject Casing');
    expect(titles).toContain('Bad Isbn');
  });

  it('skips works without authors', () => {
    expect(result.skipped.find((s) => s.title === 'No Authors Here')?.reason).toBe('no authors');
  });

  it('skips works with too few recognised subjects', () => {
    expect(result.skipped.find((s) => s.title === 'Only One Known Subject')?.reason).toMatch(
      /needs 2/,
    );
  });

  it('skips works with no usable year', () => {
    expect(result.skipped.find((s) => s.title === 'Missing Year')?.reason).toMatch(
      /implausible or missing year/,
    );
  });

  it('skips a blank title, reporting it as untitled', () => {
    expect(result.skipped.find((s) => s.reason === 'no title')?.title).toBe('(untitled)');
  });

  it('deduplicates against itself', () => {
    // Two fixture entries share title and author.
    const ids = result.books.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.skipped.some((s) => s.reason.startsWith('duplicate id'))).toBe(true);
  });

  it('deduplicates against ids already in the corpus', () => {
    const first = result.books[0];
    expect(first).toBeDefined();
    const second = normalizeWorks(fixture.works ?? [], {
      tagMap,
      existingIds: new Set([first!.id]),
      descriptionFor: () =>
        'A description of adequate length for the corpus integrity rules, comfortably over the eighty character minimum required.',
    });
    expect(second.books.map((b) => b.id)).not.toContain(first!.id);
  });

  it('emits only books that would pass the corpus integrity rules', () => {
    for (const book of result.books) {
      expect(book.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(book.authors.length).toBeGreaterThan(0);
      expect(book.subjects.length).toBeGreaterThanOrEqual(2);
      expect(book.description.length).toBeGreaterThanOrEqual(80);
      expect(book.description.length).toBeLessThanOrEqual(600);
      expect(Number.isFinite(book.year)).toBe(true);
      for (const tag of book.subjects) expect(tagMap[tag]).toBeDefined();
    }
  });

  it('drops the 979 ISBN rather than storing an unconvertible one as isbn10', () => {
    const dup = fixture.works?.find((w) => w.availability?.isbn === '9791234567896');
    expect(dup).toBeDefined();
    // 979 is a valid ISBN-13, so it is retained as isbn13 (the Amazon layer
    // falls back to a search URL for it).
    expect(extractIsbn(dup!)).toEqual({ isbn13: '9791234567896' });
  });
});
