import { describe, expect, it } from 'vitest';
import { loadSeedCorpus, loadTagMap, loadUnmappedAllowlist } from './fixtures';
import { isValidIsbn } from './isbn';

const books = loadSeedCorpus();
const tagMap = loadTagMap();
const allowlist = new Set(loadUnmappedAllowlist());

describe('seed corpus integrity', () => {
  it('is non-trivially sized', () => {
    expect(books.length).toBeGreaterThanOrEqual(300);
  });

  it('has unique ids', () => {
    const seen = new Map<string, number>();
    for (const b of books) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
    const dupes = [...seen].filter(([, c]) => c > 1).map(([id]) => id);
    expect(dupes).toEqual([]);
  });

  it('uses url-safe slug ids', () => {
    const bad = books.filter((b) => !/^[a-z0-9][a-z0-9-]*$/.test(b.id)).map((b) => b.id);
    expect(bad).toEqual([]);
  });

  it('has no duplicate title + author pairs', () => {
    const seen = new Map<string, number>();
    for (const b of books) {
      const key = `${b.title.toLowerCase()}|${b.authors.join(',').toLowerCase()}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen].filter(([, c]) => c > 1).map(([k]) => k)).toEqual([]);
  });

  it('has at least one author per book', () => {
    expect(books.filter((b) => !b.authors?.length).map((b) => b.id)).toEqual([]);
  });

  it('has at least two subjects per book', () => {
    // A single-tag book cannot be meaningfully positioned: with one feature it
    // lands wherever that tag's centroid is and carries no distinguishing signal.
    const bad = books
      .filter((b) => (b.subjects?.length ?? 0) < 2)
      .map((b) => `${b.id} (${b.subjects?.length ?? 0})`);
    expect(bad).toEqual([]);
  });

  it('has no duplicate subject tags within a book', () => {
    const bad = books
      .filter((b) => new Set(b.subjects).size !== b.subjects.length)
      .map((b) => b.id);
    expect(bad).toEqual([]);
  });

  it('has plausible years', () => {
    const bad = books
      .filter((b) => typeof b.year !== 'number' || b.year < -3000 || b.year > 2100)
      .map((b) => `${b.id}: ${String(b.year)}`);
    expect(bad).toEqual([]);
  });

  it('has descriptions between 80 and 600 characters', () => {
    const bad = books
      .filter((b) => (b.description?.length ?? 0) < 80 || (b.description?.length ?? 0) > 600)
      .map((b) => `${b.id}: ${b.description?.length ?? 0}`);
    expect(bad).toEqual([]);
  });

  it('only carries ISBNs that pass their checksum', () => {
    // ISBNs are optional and are never fabricated — a checksum-valid but wrong
    // ISBN would deep-link to the wrong product. Where absent, the Amazon link
    // falls back to a title+author search.
    const bad: string[] = [];
    for (const b of books) {
      if (b.isbn13 && !isValidIsbn(b.isbn13)) bad.push(`${b.id}: isbn13 ${b.isbn13}`);
      if (b.isbn10 && !isValidIsbn(b.isbn10)) bad.push(`${b.id}: isbn10 ${b.isbn10}`);
    }
    expect(bad).toEqual([]);
  });

  it('uses only tags defined in tagMap.json (or explicitly allowlisted)', () => {
    // This is the test that keeps the layout honest. Inconsistent tags
    // ("dystopia" vs "dystopian") silently degrade the embedding and nothing
    // else would catch it, so an unknown tag must fail here.
    const offenders = new Map<string, string[]>();
    for (const b of books) {
      for (const tag of b.subjects) {
        if (tagMap[tag] || allowlist.has(tag)) continue;
        if (!offenders.has(tag)) offenders.set(tag, []);
        offenders.get(tag)?.push(b.id);
      }
    }
    const report = [...offenders].map(([tag, ids]) => `${tag} <- ${ids.join(', ')}`);
    expect(report).toEqual([]);
  });

  it('has no tag with document frequency below 2', () => {
    // The layout prunes df<2 tags (they cannot make two books similar, yet IDF
    // gives them the highest weight). A hapax tag is therefore dead weight in
    // the corpus and should either gain a second book or be removed.
    const df = new Map<string, number>();
    for (const b of books) for (const t of b.subjects) df.set(t, (df.get(t) ?? 0) + 1);
    const hapax = [...df].filter(([, c]) => c < 2).map(([t, c]) => `${t}:${c}`);
    expect(hapax).toEqual([]);
  });
});
