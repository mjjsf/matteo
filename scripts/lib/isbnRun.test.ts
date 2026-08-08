import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Book } from '@/domain/types';
import type { FetchLike } from './openlibraryFetch';
import { searchUrl } from './isbnFetch';
import { run } from './isbnRun';

/** The whole pass, end to end, without a network.
 *
 *  This is the test that matters. `isbnFetch` and `isbnPick` are pure and checked
 *  beside this, but the loop is where the two decisions live that make the pass
 *  trustworthy or not: that it writes ONLY on a confident match, and that it
 *  writes the corpus back in a form a human can review.
 *
 *  It runs against a temp directory rather than `data/corpus`, so a test can
 *  never rewrite the real corpus — which, for the only script in the repo that
 *  writes to authored data, is worth being categorical about. */

const VALID_13 = '9780306406157';
const OTHER_13 = '9780441569595';

let dir: string;
const silent = (): void => {};

const book = (over: Partial<Book> = {}): Book => ({
  id: 'neuromancer',
  title: 'Neuromancer',
  authors: ['William Gibson'],
  year: 1984,
  subjects: ['cyberpunk', 'science-fiction'],
  description: 'A console cowboy takes one last job.',
  ...over,
});

const part = (name: string, books: Book[]): void => {
  writeFileSync(join(dir, name), `${JSON.stringify(books, null, 2)}\n`);
};

const read = (name: string): Book[] => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Book[];
const raw = (name: string): string => readFileSync(join(dir, name), 'utf8');

/** Routes keyed by the URL the pass will actually build, so a typo in the query
 *  shows up as a 404 rather than silently passing. */
function stub(routes: Record<string, { status?: number; body?: unknown }>): FetchLike {
  return async (url) => {
    const route = routes[url] ?? { status: 404 };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => route.body ?? {},
    };
  };
}

const answer = (
  title: string,
  author: string | undefined,
  docs: unknown[],
): Record<string, { body: unknown }> => ({ [searchUrl(title, author)]: { body: { docs } } });

const matching = (isbns: string[]): unknown => ({
  title: 'Neuromancer',
  author_name: ['William Gibson'],
  first_publish_year: 1984,
  isbn: isbns,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matteo-isbn-'));
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a confident match', () => {
  it('adds the ISBN and reports it', async () => {
    part('01-a.json', [book()]);
    const { counts, enriched } = await run(stub(answer('Neuromancer', 'William Gibson', [matching([VALID_13])])), {
      dir,
      spacingMs: 0,
      log: silent,
    });

    expect(counts.enriched).toBe(1);
    expect(read('01-a.json')[0]?.isbn13).toBe(VALID_13);
    expect(enriched).toEqual([
      { id: 'neuromancer', title: 'Neuromancer', isbn13: VALID_13, candidates: 1 },
    ]);
  });

  it('writes the file back in the same format, so the diff stays reviewable', async () => {
    // Two-space JSON with a trailing newline, matching `merge-corpus.ts`. If this
    // reformatted the file, the review that is supposed to catch bad ISBNs would
    // be a thousand-line diff nobody reads.
    //
    // Exactly two lines move per book, and the second is unavoidable: the key
    // that used to be last gains a comma. Everything else must be untouched.
    part('01-a.json', [book()]);
    const before = raw('01-a.json').split('\n');
    await run(stub(answer('Neuromancer', 'William Gibson', [matching([VALID_13])])), {
      dir,
      spacingMs: 0,
      log: silent,
    });
    const after = raw('01-a.json').split('\n');

    expect(raw('01-a.json').endsWith('\n')).toBe(true);
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((l) => !before.includes(l))).toEqual([
      '    "description": "A console cowboy takes one last job.",',
      `    "isbn13": "${VALID_13}"`,
    ]);
    // And the only line that vanished is that same description line, comma-less.
    expect(before.filter((l) => !after.includes(l))).toEqual([
      '    "description": "A console cowboy takes one last job."',
    ]);
  });

  it('puts isbn13 last, where the Book interface has it', async () => {
    part('01-a.json', [book()]);
    await run(stub(answer('Neuromancer', 'William Gibson', [matching([VALID_13])])), {
      dir,
      spacingMs: 0,
      log: silent,
    });
    expect(Object.keys(read('01-a.json')[0]!).at(-1)).toBe('isbn13');
  });

  it('flags an arbitrary edition when the work offered several', async () => {
    part('01-a.json', [book()]);
    const { counts } = await run(
      stub(answer('Neuromancer', 'William Gibson', [matching([VALID_13, OTHER_13])])),
      { dir, spacingMs: 0, log: silent },
    );
    expect(counts.arbitraryEdition).toBe(1);
  });
});

describe('the confidence bar — what it refuses to write', () => {
  it('writes nothing when the catalogue attributes the title to someone else', async () => {
    // `verify` returns `author-differs`. A real ISBN for a different author's book
    // of the same name would deep-link convincingly to the wrong book.
    part('01-a.json', [book()]);
    const { counts } = await run(
      stub(
        answer('Neuromancer', 'William Gibson', [
          { title: 'Neuromancer', author_name: ['Someone Else'], first_publish_year: 1984, isbn: [VALID_13] },
        ]),
      ),
      { dir, spacingMs: 0, log: silent },
    );

    expect(counts.noConfidentMatch).toBe(1);
    expect(counts.enriched).toBe(0);
    expect(read('01-a.json')[0]?.isbn13).toBeUndefined();
  });

  it('writes nothing when the years disagree beyond the slack', async () => {
    part('01-a.json', [book()]);
    const { counts } = await run(
      stub(
        answer('Neuromancer', 'William Gibson', [
          { title: 'Neuromancer', author_name: ['William Gibson'], first_publish_year: 2012, isbn: [VALID_13] },
        ]),
      ),
      { dir, spacingMs: 0, log: silent },
    );
    expect(counts.noConfidentMatch).toBe(1);
    expect(read('01-a.json')[0]?.isbn13).toBeUndefined();
  });

  it('writes nothing when the catalogue has never heard of the book', async () => {
    part('01-a.json', [book()]);
    const { counts } = await run(stub(answer('Neuromancer', 'William Gibson', [])), {
      dir,
      spacingMs: 0,
      log: silent,
    });
    expect(counts.noConfidentMatch).toBe(1);
    expect(counts.unreachable).toBe(0);
  });

  it('counts a failed request as unreachable, not as a missing ISBN', async () => {
    // Reporting a rate-limited request as "no ISBN" would quietly retire a book
    // that a rerun would have resolved.
    part('01-a.json', [book()]);
    const { counts } = await run(stub({ [searchUrl('Neuromancer', 'William Gibson')]: { status: 503 } }), {
      dir,
      spacingMs: 0,
      log: silent,
    });
    expect(counts).toMatchObject({ unreachable: 1, noConfidentMatch: 0, noUsableIsbn: 0, enriched: 0 });
  });

  it('counts a match with no isbn field as noUsableIsbn — the wrong-field-name case', async () => {
    part('01-a.json', [book()]);
    const { counts } = await run(
      stub(
        answer('Neuromancer', 'William Gibson', [
          { title: 'Neuromancer', author_name: ['William Gibson'], first_publish_year: 1984 },
        ]),
      ),
      { dir, spacingMs: 0, log: silent },
    );
    expect(counts).toMatchObject({ noUsableIsbn: 1, enriched: 0 });
    expect(read('01-a.json')[0]?.isbn13).toBeUndefined();
  });

  it('rejects a number whose checksum fails', async () => {
    part('01-a.json', [book()]);
    const { counts } = await run(
      stub(answer('Neuromancer', 'William Gibson', [matching(['9780306406158'])])),
      { dir, spacingMs: 0, log: silent },
    );
    expect(counts).toMatchObject({ noUsableIsbn: 1, enriched: 0 });
  });

  it('leaves the file byte-identical when nothing qualified', async () => {
    part('01-a.json', [book()]);
    const before = raw('01-a.json');
    await run(stub(answer('Neuromancer', 'William Gibson', [])), { dir, spacingMs: 0, log: silent });
    expect(raw('01-a.json')).toBe(before);
  });
});

describe('re-running is safe', () => {
  it('skips books that already have an ISBN and never looks them up', async () => {
    part('01-a.json', [book({ isbn13: VALID_13 })]);
    // Every route 404s, so any lookup at all would show up as `unreachable`.
    const { counts } = await run(stub({}), { dir, spacingMs: 0, log: silent });
    expect(counts).toMatchObject({ skippedHadIsbn: 1, unreachable: 0, enriched: 0 });
  });

  it('does not rewrite a file it had no reason to touch', async () => {
    part('01-a.json', [book({ isbn13: VALID_13 })]);
    const before = raw('01-a.json');
    await run(stub({}), { dir, spacingMs: 0, log: silent });
    expect(raw('01-a.json')).toBe(before);
  });

  it('spends the limit on LOOKUPS, so a second capped run makes progress', async () => {
    // If the limit counted books, a `--limit 1` rerun would spend its whole
    // budget re-skipping the book the first run already filled.
    part('01-a.json', [book({ id: 'done', isbn13: VALID_13 }), book({ id: 'todo' })]);
    const { counts } = await run(
      stub(answer('Neuromancer', 'William Gibson', [matching([OTHER_13])])),
      { dir, spacingMs: 0, log: silent, limit: 1 },
    );
    expect(counts).toMatchObject({ skippedHadIsbn: 1, enriched: 1 });
  });
});

describe('--dry-run', () => {
  it('reports what it would do and writes nothing', async () => {
    part('01-a.json', [book()]);
    const before = raw('01-a.json');
    const { counts } = await run(
      stub(answer('Neuromancer', 'William Gibson', [matching([VALID_13])])),
      { dir, spacingMs: 0, log: silent, dryRun: true },
    );

    expect(counts.enriched).toBe(1);
    expect(raw('01-a.json')).toBe(before);
  });
});

describe('the report never reads as a clean bill of health it did not earn', () => {
  it('says NOTHING WAS LOOKED UP rather than implying success', async () => {
    // The mistake `verify-corpus` shipped with: it printed "every book matched"
    // after checking zero books. Silence about having done nothing is the one
    // output that actively misleads.
    part('01-a.json', [book({ isbn13: VALID_13 })]);
    const lines: string[] = [];
    await run(stub({}), { dir, spacingMs: 0, log: (l) => lines.push(l) });
    expect(lines.join('\n')).toContain('NOTHING WAS LOOKED UP');
  });

  it('distinguishes an empty corpus from one that is already complete', async () => {
    part('01-a.json', []);
    const lines: string[] = [];
    await run(stub({}), { dir, spacingMs: 0, log: (l) => lines.push(l) });
    const text = lines.join('\n');
    expect(text).toContain('NOTHING WAS LOOKED UP');
    expect(text).toContain('no book has an ISBN');
  });

  it('names the bake, because ISBNs do not reach the app until it runs', async () => {
    part('01-a.json', [book()]);
    const lines: string[] = [];
    await run(stub(answer('Neuromancer', 'William Gibson', [matching([VALID_13])])), {
      dir,
      spacingMs: 0,
      log: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    expect(text).toContain('npm run neighbors');
    expect(text).toContain('git diff data/corpus');
  });

  it('says that unmatched books keeping their search link is intended', async () => {
    part('01-a.json', [book()]);
    const lines: string[] = [];
    await run(stub(answer('Neuromancer', 'William Gibson', [])), {
      dir,
      spacingMs: 0,
      log: (l) => lines.push(l),
    });
    expect(lines.join('\n')).toContain('KEEP THEIR SEARCH LINK');
  });
});

describe('several corpus parts', () => {
  it('writes only the parts that changed', async () => {
    part('01-a.json', [book()]);
    part('02-b.json', [book({ id: 'dune', title: 'Dune', authors: ['Frank Herbert'], year: 1965 })]);
    const untouchedBefore = raw('02-b.json');

    const { counts } = await run(
      stub({
        ...answer('Neuromancer', 'William Gibson', [matching([VALID_13])]),
        ...answer('Dune', 'Frank Herbert', []),
      }),
      { dir, spacingMs: 0, log: silent },
    );

    expect(counts).toMatchObject({ enriched: 1, noConfidentMatch: 1 });
    expect(read('01-a.json')[0]?.isbn13).toBe(VALID_13);
    expect(raw('02-b.json')).toBe(untouchedBefore);
  });
});
