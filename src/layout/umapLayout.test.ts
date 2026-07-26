import { describe, expect, it } from 'vitest';
import { UMAP } from 'umap-js';
import { mulberry32 } from './prng';
import { LAYOUT_CONFIG } from './config';
import { hasInjectableEmbedding, runUmap } from './umapLayout';

/** Guards the one genuinely fragile line in the codebase: seeding UMAP's
 *  initial embedding requires touching a field that umap-js declares private.
 *  If an upgrade removes it, these tests fail loudly instead of the layout
 *  silently reverting to random initialisation. */

function syntheticData(n: number, dims: number): number[][] {
  const rng = mulberry32(1);
  return Array.from({ length: n }, () => Array.from({ length: dims }, () => rng()));
}

describe('umap-js internals contract', () => {
  it('still exposes an injectable embedding array after initializeFit', () => {
    const umap = new UMAP({ nComponents: 3, nNeighbors: 5, random: mulberry32(1) });
    umap.initializeFit(syntheticData(40, 6));
    expect(hasInjectableEmbedding(umap)).toBe(true);
  });

  it('keeps optimizationState pointing at the same array we mutate', () => {
    // This is the subtlety that makes in-place mutation mandatory:
    // initializeFit copies the embedding reference into optimizationState, so
    // REASSIGNING `embedding` afterwards would leave the optimiser working on
    // the original random array and the seeding would be silently ignored.
    const umap = new UMAP({ nComponents: 3, nNeighbors: 5, random: mulberry32(1) });
    umap.initializeFit(syntheticData(40, 6));
    const internals = umap as unknown as {
      embedding: number[][];
      optimizationState: { headEmbedding: number[][] };
    };
    expect(internals.optimizationState.headEmbedding).toBe(internals.embedding);
  });
});

describe('runUmap', () => {
  const data = syntheticData(60, 8);

  it('returns one 3D point per row with finite values', () => {
    const init = data.map((_, i) => [i * 0.1, 0, 0]);
    const out = runUmap(data, init, LAYOUT_CONFIG, mulberry32(7));
    expect(out).toHaveLength(data.length);
    for (const p of out) {
      expect(p).toHaveLength(3);
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const init = data.map((_, i) => [i * 0.1, 0, 0]);
    const a = runUmap(data, init, LAYOUT_CONFIG, mulberry32(7));
    const b = runUmap(data, init, LAYOUT_CONFIG, mulberry32(7));
    expect(a).toEqual(b);
  });

  it('actually honours the supplied initialisation', () => {
    // Two very different inits under the SAME seed must diverge; if the
    // injection were ignored, both runs would be identical.
    const initA = data.map((_, i) => [i * 0.5, 0, 0]);
    const initB = data.map((_, i) => [0, i * -0.5, 0]);
    const a = runUmap(data, initA, LAYOUT_CONFIG, mulberry32(7));
    const b = runUmap(data, initB, LAYOUT_CONFIG, mulberry32(7));
    expect(a).not.toEqual(b);
  });

  it('tolerates an init shorter than the data', () => {
    const out = runUmap(data, [[1, 2, 3]], LAYOUT_CONFIG, mulberry32(7));
    for (const p of out) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });
});
