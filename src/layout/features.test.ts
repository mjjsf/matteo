import { describe, expect, it } from 'vitest';
import { buildTaxonomyIndex } from '@/domain/taxonomy';
import type { Book, TagMap, TaxonomyFile } from '@/domain/types';
import { LAYOUT_CONFIG } from './config';
import { buildFeatureMatrix } from './features';

const file: TaxonomyFile = {
  version: 1,
  roots: [
    { id: 'a', label: 'A', children: [{ id: 'a-1', label: 'A1', children: [{ id: 'a-1-x', label: 'X' }] }] },
    { id: 'b', label: 'B', children: [{ id: 'b-1', label: 'B1', children: [{ id: 'b-1-y', label: 'Y' }] }] },
  ],
};
const tagMap: TagMap = { x: ['a-1-x'], y: ['b-1-y'], shared: ['a-1-x', 'b-1-y'], lonely: ['a-1-x'] };
const index = buildTaxonomyIndex(file);

const book = (id: string, subjects: string[], authors: string[]): Book => ({
  id,
  title: id,
  authors,
  year: 2000,
  subjects,
  description: 'd',
});

const corpus = [
  book('b1', ['x', 'shared'], ['Author One']),
  book('b2', ['x', 'shared'], ['Author One']),
  book('b3', ['y', 'shared'], ['Author Two']),
  book('b4', ['y', 'shared'], ['Author Three']),
  book('b5', ['x', 'lonely'], ['Author One']),
  book('b6', ['y', 'shared'], ['Author Two']),
];

const config = { ...LAYOUT_CONFIG, minDf: 2 };
const fm = buildFeatureMatrix(corpus, tagMap, index, config);

const columnsOf = (block: string): number[] =>
  fm.vocab.map((v, i) => (v.block === block ? i : -1)).filter((i) => i >= 0);

describe('buildFeatureMatrix', () => {
  it('prunes subject tags below minDf', () => {
    // `lonely` appears on exactly one book, so it cannot make two books similar
    // — but IDF would give it the highest weight of all.
    expect(fm.vocab.some((v) => v.block === 'subject' && v.key === 'lonely')).toBe(false);
    expect(fm.vocab.some((v) => v.block === 'subject' && v.key === 'x')).toBe(true);
    expect(fm.prunedCount).toBeGreaterThan(0);
  });

  it('prunes single-book authors', () => {
    expect(fm.vocab.some((v) => v.block === 'author' && v.key === 'Author Three')).toBe(false);
    expect(fm.vocab.some((v) => v.block === 'author' && v.key === 'Author One')).toBe(true);
  });

  it('keeps taxonomy ancestors even at df 1, since they are structural', () => {
    const taxonomyKeys = fm.vocab.filter((v) => v.block === 'taxonomy').map((v) => v.key);
    expect(taxonomyKeys).toContain('a');
    expect(taxonomyKeys).toContain('a-1');
    expect(taxonomyKeys).toContain('a-1-x');
  });

  it('gives rarer features higher idf', () => {
    const subjects = fm.vocab.filter((v) => v.block === 'subject');
    const byDf = [...subjects].sort((a, b) => a.df - b.df);
    for (let i = 1; i < byDf.length; i++) {
      const prev = byDf[i - 1];
      const cur = byDf[i];
      if (!prev || !cur || prev.df === cur.df) continue;
      expect(prev.idf).toBeGreaterThan(cur.idf);
    }
  });

  it('orders columns deterministically regardless of corpus order', () => {
    const shuffled = [corpus[2], corpus[0], corpus[5], corpus[1], corpus[4], corpus[3]] as Book[];
    const other = buildFeatureMatrix(shuffled, tagMap, index, config);
    expect(other.vocab.map((v) => `${v.block}:${v.key}`)).toEqual(
      fm.vocab.map((v) => `${v.block}:${v.key}`),
    );
  });

  it('L2-normalises the subject block to 1 before weighting', () => {
    const cols = columnsOf('subject');
    for (const row of fm.matrix) {
      const norm = Math.sqrt(cols.reduce((s, c) => s + (row[c] as number) ** 2, 0));
      expect(norm).toBeCloseTo(1, 6);
    }
  });

  it('scales the author block by authorWeight after normalising it', () => {
    const cols = columnsOf('author');
    // b1 has a retained author, so its author block norm should equal the weight.
    const row = fm.matrix[0] as number[];
    const norm = Math.sqrt(cols.reduce((s, c) => s + (row[c] as number) ** 2, 0));
    expect(norm).toBeCloseTo(config.authorWeight, 6);
  });

  it('scales the taxonomy block by taxonomyWeight', () => {
    const cols = columnsOf('taxonomy');
    const row = fm.matrix[0] as number[];
    const norm = Math.sqrt(cols.reduce((s, c) => s + (row[c] as number) ** 2, 0));
    expect(norm).toBeCloseTo(config.taxonomyWeight, 6);
  });

  it('leaves a pruned-author book with a zero author block rather than NaN', () => {
    const cols = columnsOf('author');
    const row = fm.matrix[3] as number[]; // b4, Author Three (df 1, pruned)
    for (const c of cols) expect(row[c]).toBe(0);
    for (const v of row) expect(Number.isFinite(v)).toBe(true);
  });

  it('makes same-author books closer when authorWeight is raised', () => {
    // b1 and b2 share an author; b1 and b3 do not. Raising authorWeight must
    // widen that gap, otherwise the weight is not doing what it claims.
    const distance = (m: number[][], i: number, j: number): number => {
      const a = m[i] as number[];
      const b = m[j] as number[];
      let s = 0;
      for (let k = 0; k < a.length; k++) s += ((a[k] as number) - (b[k] as number)) ** 2;
      return Math.sqrt(s);
    };
    const low = buildFeatureMatrix(corpus, tagMap, index, { ...config, authorWeight: 0 });
    const high = buildFeatureMatrix(corpus, tagMap, index, { ...config, authorWeight: 1.2 });
    const gapLow = distance(low.matrix, 0, 2) - distance(low.matrix, 0, 1);
    const gapHigh = distance(high.matrix, 0, 2) - distance(high.matrix, 0, 1);
    expect(gapHigh).toBeGreaterThan(gapLow);
  });

  it('reports subject idf mass rather than a degenerate row norm', () => {
    // Row L2 norms collapse to a few discrete values because each block is
    // normalised then weighted, so they are useless as a quality signal.
    expect(fm.subjectIdfMass).toHaveLength(corpus.length);
    expect(fm.survivingSubjectCount[4]).toBe(1); // b5: `lonely` was pruned
    expect(fm.survivingSubjectCount[0]).toBe(2);
    expect(new Set(fm.subjectIdfMass).size).toBeGreaterThan(1);
  });
});
