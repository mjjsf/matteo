import { describe, expect, it } from 'vitest';
import { loadCorpusForLayout, loadTagMap, loadTaxonomyFile } from '@/domain/fixtures';
import { FEATURE_CONFIG } from '@/domain/features';
import { inputHash } from '@/domain/hash';
import { MIN_SIM, type NeighborsFile } from '@/domain/similarity';
import { NEIGHBOR_K } from '../../scripts/build-neighbors';
import neighbors from './neighbors.json';
import corpus from './corpus.json';

/** The entire safety net for baking neighbours at build time. Without this,
 *  editing the corpus and forgetting to re-run `npm run neighbors` would ship
 *  similar-book lists pointing at the wrong books — and because the indices
 *  would still resolve to *something*, the map would look fine while being
 *  quietly wrong. */
describe('generated neighbours freshness', () => {
  const file = neighbors as unknown as NeighborsFile;
  const books = corpus as Array<{ id: string }>;

  it('matches the current corpus, taxonomy, tagMap and config', () => {
    const expected = inputHash({
      corpus: loadCorpusForLayout(),
      taxonomy: loadTaxonomyFile(),
      tagMap: loadTagMap(),
      config: { ...FEATURE_CONFIG, k: NEIGHBOR_K },
    });
    expect(
      file.inputHash,
      'src/generated/neighbors.json is stale — run `npm run neighbors` and commit the result',
    ).toBe(expected);
  });

  it('lists the same books as the generated corpus, in the same order', () => {
    expect(file.bookIds).toEqual(books.map((b) => b.id));
  });

  it('generated corpus matches the authored corpus', () => {
    expect(corpus).toEqual(loadCorpusForLayout());
  });

  it('has one neighbour list per book', () => {
    expect(file.neighbors).toHaveLength(books.length);
  });

  it('never points outside the corpus, never at itself, never past K', () => {
    file.neighbors.forEach((list, i) => {
      expect(list.length).toBeLessThanOrEqual(file.k);
      for (const [j, score] of list) {
        expect(Number.isInteger(j)).toBe(true);
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThan(books.length);
        expect(j).not.toBe(i);
        expect(score).toBeGreaterThanOrEqual(MIN_SIM);
      }
    });
  });

  it('orders every list best match first', () => {
    for (const list of file.neighbors) {
      for (let i = 1; i < list.length; i++) {
        expect((list[i - 1] as [number, number])[1]).toBeGreaterThanOrEqual(
          (list[i] as [number, number])[1],
        );
      }
    }
  });

  it('leaves no book without a single similar book', () => {
    // A book with no neighbours is a dead end: seed there and the map cannot
    // branch at all. This is a corpus property, not a code bug, which is exactly
    // why it belongs in a test rather than in a runtime guard.
    const dead = file.neighbors
      .map((list, i) => (list.length === 0 ? (books[i]?.id ?? String(i)) : null))
      .filter((id): id is string => id !== null);
    expect(dead, `books with no similar books: ${dead.join(', ')}`).toEqual([]);
  });
});
