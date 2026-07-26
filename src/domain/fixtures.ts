/** Loads the authored data from `data/` for tests and build scripts.
 *  The app itself never uses this — it reads `src/generated/`. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Book, TagMap, TaxonomyFile } from './types';

// fileURLToPath rather than `new URL(...).pathname`: the latter misresolves
// under non-node test environments and on Windows paths.
const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

export function loadTaxonomyFile(): TaxonomyFile {
  return JSON.parse(readFileSync(join(DATA_DIR, 'taxonomy.json'), 'utf8')) as TaxonomyFile;
}

export function loadTagMap(): TagMap {
  return JSON.parse(readFileSync(join(DATA_DIR, 'tagMap.json'), 'utf8')) as TagMap;
}

export function loadUnmappedAllowlist(): string[] {
  try {
    return JSON.parse(
      readFileSync(join(DATA_DIR, 'unmapped.allow.json'), 'utf8'),
    ) as string[];
  } catch {
    return [];
  }
}

/** The corpus the layout is built from: the merged file when `corpus:merge` has
 *  produced one, otherwise the authored seed alone.
 *
 *  Both the build script and the freshness test go through this, so they can
 *  never disagree about which corpus is current. */
export function loadCorpusForLayout(): Book[] {
  const merged = join(DATA_DIR, 'corpus.merged.json');
  if (existsSync(merged)) {
    return JSON.parse(readFileSync(merged, 'utf8')) as Book[];
  }
  return loadSeedCorpus();
}

/** All authored corpus parts, concatenated in filename order so the result is
 *  stable regardless of directory listing order. */
export function loadSeedCorpus(): Book[] {
  const dir = join(DATA_DIR, 'corpus');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out: Book[] = [];
  for (const f of files) {
    const part = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Book[];
    if (!Array.isArray(part)) throw new Error(`corpus part ${f} is not an array`);
    out.push(...part);
  }
  return out;
}
