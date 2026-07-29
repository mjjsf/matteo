import { describe, expect, it } from 'vitest';
import { loadSeedCorpus, loadLegacyIdAllowlist, loadTagMap, loadUnmappedAllowlist } from './fixtures';
import { isValidIsbn } from './isbn';

const books = loadSeedCorpus();
const tagMap = loadTagMap();
const allowlist = new Set(loadUnmappedAllowlist());
const legacyIds = new Set(loadLegacyIdAllowlist());

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'at', 'is', 'it', 'its', 'for']);

function slugTokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['\u2019]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

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

  it('never gives a book an id naming a different book', () => {
    // Ids appear in shared URLs (`#/from/{id}`), so an id that names another
    // book is not cosmetic — it makes the link lie about what it opens. This
    // caught 97 of them in one authoring pass: `the-shadow-of-what-was-lost`
    // for Jade City, `the-vanishing-half-yellowface` for Yellowface.
    //
    // Abbreviating IS allowed — `harry-potter-philosophers-stone`, or an author
    // surname for disambiguation as in `einstein-isaacson`. The rule is only
    // that every part of the id comes from the book's own title or authors.
    const offenders: string[] = [];
    for (const b of books) {
      if (legacyIds.has(b.id)) continue;
      const allowed = slugTokens(`${b.title} ${b.authors.join(' ')}`);
      const stray = b.id.split('-').filter((t) => !STOPWORDS.has(t) && !allowed.has(t));
      if (stray.length > 0) offenders.push(`${b.id} (${b.title}) <- stray: ${stray.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every legacy id exception still present in the corpus', () => {
    // data/legacy-ids.allow.json exempts ids that shipped before the rule
    // existed and are live in URLs. If one is renamed or removed, drop it from
    // the file rather than leaving a stale exemption behind.
    const ids = new Set(books.map((b) => b.id));
    expect([...legacyIds].filter((id) => !ids.has(id))).toEqual([]);
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
