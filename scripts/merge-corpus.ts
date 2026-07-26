/** Merge the authored seed corpus with anything the fetch script produced.
 *
 *  Run with: npm run corpus:merge
 *
 *  The authored corpus always wins on conflict, so a bad fetch run can never
 *  overwrite hand-written entries. Output goes to `data/corpus.merged.json`,
 *  which `build-layout` picks up if present. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Book } from '@/domain/types';
import { loadSeedCorpus, loadTagMap } from '@/domain/fixtures';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const FETCHED = `${DATA_DIR}corpus.fetched.json`;
const MERGED = `${DATA_DIR}corpus.merged.json`;

function main(): void {
  const seed = loadSeedCorpus();
  const tagMap = loadTagMap();

  if (!existsSync(FETCHED)) {
    console.log('No data/corpus.fetched.json — nothing to merge.');
    console.log(`Seed corpus alone has ${seed.length} books.`);
    return;
  }

  const fetched = JSON.parse(readFileSync(FETCHED, 'utf8')) as Book[];
  const byId = new Map<string, Book>();
  // Seed first, so a later fetched entry with the same id is discarded.
  for (const book of seed) byId.set(book.id, book);

  let added = 0;
  let conflicts = 0;
  let rejected = 0;

  for (const book of fetched) {
    if (byId.has(book.id)) {
      conflicts++;
      continue;
    }
    // Re-validate rather than trusting the file: an unknown tag would fail the
    // corpus integrity test later, and it is far easier to diagnose here.
    const unknown = book.subjects.filter((t) => !tagMap[t]);
    if (unknown.length > 0) {
      console.warn(`  rejecting ${book.id}: unknown tags ${unknown.join(', ')}`);
      rejected++;
      continue;
    }
    byId.set(book.id, book);
    added++;
  }

  const merged = [...byId.values()];
  writeFileSync(MERGED, `${JSON.stringify(merged, null, 2)}\n`);

  console.log(`seed: ${seed.length}`);
  console.log(`fetched: ${fetched.length} (added ${added}, ${conflicts} already present, ${rejected} rejected)`);
  console.log(`merged total: ${merged.length} -> data/corpus.merged.json`);
  console.log('\nNext: npm run layout && npm test');
}

main();
