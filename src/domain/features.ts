import type { Book, TagMap, TaxonomyIndex } from './types';
import { nodesWithAncestorsForBook } from './taxonomy';

export interface FeatureConfig {
  /** Tags/authors appearing in fewer than this many books are dropped.
   *  A feature on exactly one book cannot make two books similar, yet IDF gives
   *  it the highest weight — so hapax features dominate their book's vector and
   *  make it look uniquely similar to nothing. Pruning matters more than any
   *  other knob here. */
  minDf: number;
  /** Relative weight of the author block. 0.4 makes same-author books
   *  noticeably similar without letting a prolific author crowd out every
   *  subject relationship — wrong for a *subject* discovery tool. */
  authorWeight: number;
  /** Relative weight of the taxonomy-ancestor block. Without it, two books
   *  sharing no exact tag but sitting in the same corner of the taxonomy would
   *  score zero against each other. */
  taxonomyWeight: number;
}

/** Part of the neighbours artifact's input hash, so changing any of these forces
 *  a re-bake rather than silently shipping stale neighbours. */
export const FEATURE_CONFIG: FeatureConfig = {
  minDf: 2,
  authorWeight: 0.4,
  taxonomyWeight: 0.55,
};

export interface FeatureMeta {
  block: 'subject' | 'author' | 'taxonomy';
  key: string;
  df: number;
  idf: number;
}

export interface FeatureMatrix {
  /** Row per book in the given order, column per surviving feature. */
  matrix: number[][];
  vocab: FeatureMeta[];
  prunedCount: number;
  /** Sum of raw IDF weights of a book's surviving *subject* tags, before any
   *  normalisation.
   *
   *  Note this is deliberately NOT the row L2 norm. Because each block is
   *  L2-normalised to 1 and then scaled by its block weight, every row norm
   *  collapses to one of a few discrete values (e.g. sqrt(1 + 0.55^2) whenever a
   *  book's author was pruned), which says nothing about positioning quality. A
   *  book whose tags are all high-frequency has little distinguishing signal,
   *  and raw IDF mass is what actually measures that. */
  subjectIdfMass: number[];
  /** How many of a book's subject tags survived pruning. */
  survivingSubjectCount: number[];
}

/** IDF, not TF-IDF.
 *
 *  A subject tag occurs at most once per book, so the term-frequency factor is
 *  a constant and there is no TF loop to write. Calling it TF-IDF would imply
 *  a weighting that isn't happening. */
function idf(n: number, df: number): number {
  return Math.log(1 + n / (1 + df));
}

function documentFrequencies(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const keys of docs) {
    for (const key of new Set(keys)) df.set(key, (df.get(key) ?? 0) + 1);
  }
  return df;
}

/** L2-normalise a slice of a row in place. */
function normalizeSlice(row: number[], from: number, to: number): void {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (row[i] as number) ** 2;
  if (sum <= 0) return;
  const inv = 1 / Math.sqrt(sum);
  for (let i = from; i < to; i++) row[i] = (row[i] as number) * inv;
}

/** Build the book x feature matrix as three separately L2-normalised blocks,
 *  concatenated with weights.
 *
 *  Per-block normalisation (rather than one global weight) makes the weighting
 *  independent of how many tags versus authors a given book happens to have —
 *  otherwise a book with six tags and one author would be weighted differently
 *  from one with two tags and three authors, for no principled reason. */
export function buildFeatureMatrix(
  books: Book[],
  tagMap: TagMap,
  index: TaxonomyIndex,
  config: FeatureConfig,
): FeatureMatrix {
  const subjectDocs = books.map((b) => b.subjects);
  const authorDocs = books.map((b) => b.authors);
  const taxonomyDocs = books.map((b) => nodesWithAncestorsForBook(b, tagMap, index));

  const subjectDf = documentFrequencies(subjectDocs);
  const authorDf = documentFrequencies(authorDocs);
  const taxonomyDf = documentFrequencies(taxonomyDocs);

  const n = books.length;
  let prunedCount = 0;

  const keep = (df: Map<string, number>, block: FeatureMeta['block']): FeatureMeta[] => {
    const out: FeatureMeta[] = [];
    // Sort keys so column order is deterministic regardless of insertion order.
    for (const key of [...df.keys()].sort()) {
      const d = df.get(key) as number;
      if (d < config.minDf) {
        prunedCount++;
        continue;
      }
      out.push({ block, key, df: d, idf: idf(n, d) });
    }
    return out;
  };

  const subjectVocab = keep(subjectDf, 'subject');
  const authorVocab = keep(authorDf, 'author');
  // Taxonomy ancestors are structural, not observed tags — a node reached by
  // only one book is still a real part of the hierarchy, so it is not pruned.
  const taxonomyVocab: FeatureMeta[] = [...taxonomyDf.keys()].sort().map((key) => {
    const d = taxonomyDf.get(key) as number;
    return { block: 'taxonomy' as const, key, df: d, idf: idf(n, d) };
  });

  const vocab = [...subjectVocab, ...authorVocab, ...taxonomyVocab];
  const colOf = new Map<string, number>();
  vocab.forEach((f, i) => colOf.set(`${f.block}:${f.key}`, i));

  const sEnd = subjectVocab.length;
  const aEnd = sEnd + authorVocab.length;
  const tEnd = aEnd + taxonomyVocab.length;

  const matrix: number[][] = [];
  const subjectIdfMass: number[] = [];
  const survivingSubjectCount: number[] = [];

  for (let r = 0; r < books.length; r++) {
    const row = new Array<number>(vocab.length).fill(0);

    let idfMass = 0;
    let surviving = 0;
    for (const tag of subjectDocs[r] as string[]) {
      const col = colOf.get(`subject:${tag}`);
      if (col === undefined) continue;
      idfMass += (vocab[col] as FeatureMeta).idf;
      surviving += 1;
    }
    subjectIdfMass.push(idfMass);
    survivingSubjectCount.push(surviving);

    const set = (block: FeatureMeta['block'], keys: string[]): void => {
      for (const key of keys) {
        const col = colOf.get(`${block}:${key}`);
        if (col === undefined) continue;
        row[col] = (vocab[col] as FeatureMeta).idf;
      }
    };

    set('subject', subjectDocs[r] as string[]);
    set('author', authorDocs[r] as string[]);
    set('taxonomy', taxonomyDocs[r] as string[]);

    // Normalise each block independently, then apply the block weight.
    normalizeSlice(row, 0, sEnd);
    normalizeSlice(row, sEnd, aEnd);
    normalizeSlice(row, aEnd, tEnd);

    for (let i = sEnd; i < aEnd; i++) row[i] = (row[i] as number) * config.authorWeight;
    for (let i = aEnd; i < tEnd; i++) row[i] = (row[i] as number) * config.taxonomyWeight;

    matrix.push(row);
  }

  return { matrix, vocab, prunedCount, subjectIdfMass, survivingSubjectCount };
}

/** The books with the least distinguishing signal, for the build script to
 *  report as a to-do list. Not a bug to fix in code — it is a corpus property:
 *  a book tagged only with very common tags has nothing to be positioned by. */
export function weakestBooks(
  books: Book[],
  features: FeatureMatrix,
  count: number,
): Array<{ id: string; norm: number }> {
  return books
    .map((b, i) => ({ id: b.id, norm: features.subjectIdfMass[i] as number }))
    .sort((a, b) => a.norm - b.norm)
    .slice(0, count);
}
