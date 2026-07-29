/** Expand the corpus from the Open Library API.
 *
 *  Usage:
 *    npm run fetch -- --subject science_fiction --subject philosophy --limit 200
 *
 *  IMPORTANT — this script has NOT been executed end to end. It was written in
 *  an environment where `openlibrary.org` is blocked by network policy, so the
 *  HTTP path is unverified. What IS verified is the parsing: every transform
 *  lives in `scripts/lib/openlibraryNormalize.ts` and is tested against
 *  committed samples of the real API shape. Expect to adjust the request layer
 *  on first real run; the ~30 lines below are the only untested surface.
 *
 *  Safety properties worth preserving if you edit this:
 *   - Writes ONLY to `data/corpus.fetched.json`, never to the authored
 *     `data/corpus/*.json`. A bad run can never destroy hand-written work.
 *   - Resumable: completed subjects are recorded and skipped on re-run.
 *   - Throttled, with a descriptive User-Agent, because Open Library asks for
 *     both and rate-limits anonymous bulk readers. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Book } from '@/domain/types';
import { loadSeedCorpus, loadTagMap } from '@/domain/fixtures';
import { normalizeWorks, type OpenLibraryWork } from './lib/openlibraryNormalize';
import {
  fetchDescription,
  fetchSubject,
  pendingSubjects,
  type FetchLike,
} from './lib/openlibraryFetch';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const OUT_FILE = `${DATA_DIR}corpus.fetched.json`;
const CURSOR_FILE = `${DATA_DIR}.fetch-cursor.json`;

const THROTTLE_MS = 400;

interface Cursor {
  completedSubjects: string[];
}

function parseArgs(argv: string[]): { subjects: string[]; limit: number } {
  const subjects: string[] = [];
  let limit = 100;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--subject' && argv[i + 1]) subjects.push(argv[++i] as string);
    else if (argv[i] === '--limit' && argv[i + 1]) limit = Number(argv[++i]);
  }
  return { subjects, limit };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The real fetch, injected once here so everything below it is the code the
 *  tests in `lib/openlibraryFetch.test.ts` already exercise. */
const http = globalThis.fetch as unknown as FetchLike;

function loadCursor(): Cursor {
  if (!existsSync(CURSOR_FILE)) return { completedSubjects: [] };
  return JSON.parse(readFileSync(CURSOR_FILE, 'utf8')) as Cursor;
}

function loadFetched(): Book[] {
  if (!existsSync(OUT_FILE)) return [];
  return JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Book[];
}

async function main(): Promise<void> {
  const { subjects, limit } = parseArgs(process.argv.slice(2));
  if (subjects.length === 0) {
    console.error(
      'Usage: npm run fetch -- --subject science_fiction [--subject philosophy] [--limit 200]',
    );
    process.exit(1);
  }

  const tagMap = loadTagMap();
  const seed = loadSeedCorpus();
  const fetched = loadFetched();
  const cursor = loadCursor();

  const existingIds = new Set<string>([...seed, ...fetched].map((b) => b.id));
  const collected: Book[] = [...fetched];

  const todo = pendingSubjects(subjects, cursor.completedSubjects);
  for (const skipped of subjects.filter((s) => !todo.includes(s))) {
    console.log(`skipping ${skipped} (already completed)`);
  }

  for (const subject of todo) {
    console.log(`fetching subject ${subject} (limit ${limit})…`);
    let works: OpenLibraryWork[];
    try {
      works = (await fetchSubject(http, subject, limit)).works ?? [];
    } catch (error) {
      console.error(`  failed: ${(error as Error).message}`);
      continue;
    }

    console.log(`  ${works.length} works returned; fetching descriptions…`);

    const descriptions = new Map<string, string>();
    for (const work of works) {
      if (!work.key) continue;
      const description = await fetchDescription(http, work.key);
      if (description) descriptions.set(work.key, description);
      await sleep(THROTTLE_MS);
    }

    const { books, skipped } = normalizeWorks(works, {
      tagMap,
      existingIds,
      descriptionFor: (w) => (w.key ? descriptions.get(w.key) : undefined),
    });

    for (const book of books) {
      existingIds.add(book.id);
      collected.push(book);
    }

    console.log(`  kept ${books.length}, skipped ${skipped.length}`);
    for (const s of skipped.slice(0, 5)) console.log(`    - ${s.title}: ${s.reason}`);

    cursor.completedSubjects.push(subject);
    writeFileSync(OUT_FILE, `${JSON.stringify(collected, null, 2)}\n`);
    writeFileSync(CURSOR_FILE, `${JSON.stringify(cursor, null, 2)}\n`);
    await sleep(THROTTLE_MS);
  }

  console.log(`\n${collected.length} fetched books in data/corpus.fetched.json`);
  console.log('Next: npm run corpus:merge && npm run neighbors && npm test');
}

void main();
