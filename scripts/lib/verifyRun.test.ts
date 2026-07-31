import { describe, expect, it } from 'vitest';
import { loadSeedCorpus } from '@/domain/fixtures';
import type { FetchLike } from './openlibraryFetch';
import { searchUrl } from './verifyFetch';
import { run } from './verifyRun';

/** The whole pass, driven by a stub catalogue.
 *
 *  This never touches the network — `openlibrary.org` is blocked from the
 *  environment it was written in, and would be the wrong thing to depend on in a
 *  test regardless. What it proves is that the runner, the matcher and the
 *  request layer fit together over the REAL corpus: a catalogue that agrees
 *  produces silence, and one that disagrees produces exactly the finding it
 *  should. */

const books = loadSeedCorpus();

/** A catalogue that mirrors the corpus back, with per-book overrides. */
function catalogue(overrides: Record<string, unknown[]> = {}): FetchLike {
  const byUrl = new Map<string, unknown[]>();
  for (const book of books) {
    const url = searchUrl(book.title, book.authors[0]);
    byUrl.set(
      url,
      overrides[book.id] ?? [
        { title: book.title, author_name: book.authors, first_publish_year: book.year },
      ],
    );
  }
  return async (url) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ docs: byUrl.get(url) ?? [] }),
  });
}

const silent = { log: () => {}, spacingMs: 0, limit: 40 };

describe('the pass over the real corpus', () => {
  it('reports nothing when the catalogue agrees', async () => {
    const result = await run(catalogue(), silent);
    expect(result.findings).toEqual([]);
    expect(result.checked).toBe(40);
    expect(result.unreachable).toBe(0);
  });

  it('reports a book the catalogue does not have', async () => {
    const victim = books[3]!;
    const result = await run(catalogue({ [victim.id]: [] }), silent);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.id).toBe(victim.id);
    expect(result.findings[0]?.verdict.kind).toBe('not-found');
  });

  it('reports a title the catalogue attributes to someone else', async () => {
    const victim = books[2]!;
    const result = await run(
      catalogue({
        [victim.id]: [
          { title: victim.title, author_name: ['Someone Else Entirely'], first_publish_year: victim.year },
        ],
      }),
      silent,
    );
    expect(result.findings[0]?.verdict).toMatchObject({
      kind: 'author-differs',
      found: ['Someone Else Entirely'],
    });
  });

  it('separates a year we date too late from one we date early', async () => {
    const [a, b] = [books[0]!, books[1]!];
    const result = await run(
      catalogue({
        [a.id]: [{ title: a.title, author_name: a.authors, first_publish_year: a.year - 30 }],
        [b.id]: [{ title: b.title, author_name: b.authors, first_publish_year: b.year + 30 }],
      }),
      silent,
    );
    const kinds = Object.fromEntries(result.findings.map((f) => [f.id, f.verdict.kind]));
    expect(kinds[a.id]).toBe('year-later');
    expect(kinds[b.id]).toBe('year-earlier');
  });
});

describe('a failed request is not a missing book', () => {
  it('counts it as unreachable and keeps it out of the findings', async () => {
    // The failure mode that would make the report worthless: five hundred real
    // books listed as "the catalogue has never heard of this" because the
    // service rate-limited us halfway through.
    const failing: FetchLike = async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    });
    const result = await run(failing, silent);
    expect(result.findings).toEqual([]);
    expect(result.checked).toBe(0);
    expect(result.unreachable).toBe(40);
  });

  it('says so in the report rather than quietly reporting a clean run', async () => {
    const lines: string[] = [];
    const failing: FetchLike = async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
    });
    await run(failing, { ...silent, log: (l) => lines.push(l) });
    const output = lines.join('\n');
    expect(output).toMatch(/40 could not be reached/);
    expect(output).toMatch(/rerun/);
  });

  it('never reads as a clean bill of health when nothing was checked', async () => {
    // The one output that would actively mislead, and it is what the script
    // printed the first time it was actually run: "every book matched on title,
    // author and year" after reaching precisely zero books. No test caught it,
    // because every test until this one supplied a catalogue that answered.
    const lines: string[] = [];
    const failing: FetchLike = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({}),
    });
    await run(failing, { ...silent, log: (l) => lines.push(l) });
    const output = lines.join('\n');
    expect(output).not.toMatch(/every book matched/);
    expect(output).toMatch(/NOTHING WAS VERIFIED/);
  });
});

describe('the report', () => {
  it('names the book and both values, so a finding can be acted on', async () => {
    const victim = books[5]!;
    const lines: string[] = [];
    await run(
      catalogue({
        [victim.id]: [
          { title: victim.title, author_name: victim.authors, first_publish_year: victim.year + 40 },
        ],
      }),
      { ...silent, log: (l) => lines.push(l) },
    );
    const output = lines.join('\n');
    expect(output).toContain(victim.id);
    expect(output).toContain(`ours: ${victim.year}`);
    expect(output).toContain(`catalogue: ${victim.year + 40}`);
  });

  it('states plainly that it changed nothing', async () => {
    const lines: string[] = [];
    await run(catalogue({ [books[1]!.id]: [] }), { ...silent, log: (l) => lines.push(l) });
    expect(lines.join('\n')).toMatch(/Nothing has been changed/);
  });

  it('emits machine-readable output on request', async () => {
    const lines: string[] = [];
    await run(catalogue({ [books[1]!.id]: [] }), { ...silent, json: true, log: (l) => lines.push(l) });
    const parsed = JSON.parse(lines.join('\n')) as { findings: unknown[]; checked: number };
    expect(parsed.checked).toBe(40);
    expect(parsed.findings).toHaveLength(1);
  });
});
