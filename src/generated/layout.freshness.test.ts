import { describe, expect, it } from 'vitest';
import { loadCorpusForLayout, loadTagMap, loadTaxonomyFile } from '@/domain/fixtures';
import { LAYOUT_CONFIG } from '@/layout/config';
import { inputHash } from '@/layout/hash';
import type { LayoutFile } from '@/domain/types';
import layout from './layout.json';
import corpus from './corpus.json';

/** The entire safety net for baking coordinates at build time. Without this,
 *  editing the corpus and forgetting to re-run `npm run layout` would ship a
 *  layout whose positions no longer correspond to the books. */
describe('generated layout freshness', () => {
  const file = layout as unknown as LayoutFile;

  it('matches the current corpus, taxonomy, tagMap and config', () => {
    const expected = inputHash({
      corpus: loadCorpusForLayout(),
      taxonomy: loadTaxonomyFile(),
      tagMap: loadTagMap(),
      config: LAYOUT_CONFIG,
    });
    expect(
      file.inputHash,
      'src/generated/layout.json is stale — run `npm run layout` and commit the result',
    ).toBe(expected);
  });

  it('has three coordinates per book', () => {
    expect(file.positions).toHaveLength(file.bookIds.length * 3);
  });

  it('lists the same books as the generated corpus, in the same order', () => {
    expect(file.bookIds).toEqual((corpus as Array<{ id: string }>).map((b) => b.id));
  });

  it('generated corpus matches the corpus the layout was built from', () => {
    expect(corpus).toEqual(loadCorpusForLayout());
  });

  it('contains only finite coordinates', () => {
    for (const v of file.positions) expect(Number.isFinite(v)).toBe(true);
  });

  it('echoes the config it was built with', () => {
    expect(file.config.seed).toBe(LAYOUT_CONFIG.seed);
    expect(file.config.strategy).toBe(LAYOUT_CONFIG.strategy);
    expect(file.bounds.radius).toBe(LAYOUT_CONFIG.radius);
  });
});
