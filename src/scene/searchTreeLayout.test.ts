import { describe, expect, it } from 'vitest';
import type { SearchTreeNode } from '@/domain/types';
import { layoutSearchTree } from './searchTreeLayout';

const node = (
  id: string,
  depth: number,
  parentId: string | null,
  bookIds: string[],
): SearchTreeNode => ({
  id,
  label: id,
  depth,
  parentId,
  matchCount: bookIds.length,
  matchedBookIds: bookIds,
  collapsedFrom: [],
});

const positions: Record<string, [number, number, number]> = {
  b1: [10, 0, 0],
  b2: [-10, 0, 0],
  b3: [0, 0, 10],
};
const posOf = (id: string): [number, number, number] | null => positions[id] ?? null;

const options = { radius: 50, maxDepth: 2 };

describe('layoutSearchTree', () => {
  it('returns nothing for an empty tree', () => {
    expect(layoutSearchTree([], posOf, options)).toEqual([]);
  });

  it('anchors a node at the centroid of its matched books', () => {
    const [placed] = layoutSearchTree([node('r', 0, null, ['b1', 'b2'])], posOf, options);
    expect(placed?.anchor[0]).toBeCloseTo(0, 6);
    expect(placed?.anchor[1]).toBeCloseTo(0, 6);
    expect(placed?.anchor[2]).toBeCloseTo(0, 6);
  });

  it('lifts shallower nodes higher than deeper ones', () => {
    const placed = layoutSearchTree(
      [node('r', 0, null, ['b1']), node('c', 1, 'r', ['b1']), node('g', 2, 'c', ['b1'])],
      posOf,
      options,
    );
    const y = (id: string): number => placed.find((p) => p.id === id)?.position[1] ?? 0;
    expect(y('r')).toBeGreaterThan(y('c'));
    expect(y('c')).toBeGreaterThan(y('g'));
  });

  it('keeps children below their parents', () => {
    const placed = layoutSearchTree(
      [
        node('r', 0, null, ['b1', 'b2', 'b3']),
        node('c1', 1, 'r', ['b1']),
        node('c2', 1, 'r', ['b2']),
      ],
      posOf,
      options,
    );
    const byId = new Map(placed.map((p) => [p.id, p]));
    for (const p of placed) {
      if (!p.parentId) continue;
      expect(p.position[1]).toBeLessThan((byId.get(p.parentId) as { position: number[] }).position[1] ?? 0);
    }
  });

  it('separates same-depth siblings that share an identical centroid', () => {
    // The degenerate single-match case: several nodes describe the same one
    // book, so all their centroids coincide and labels would collide.
    const placed = layoutSearchTree(
      [
        node('a', 1, null, ['b1']),
        node('b', 1, null, ['b1']),
        node('c', 1, null, ['b1']),
      ],
      posOf,
      options,
    );
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i]!.position;
        const q = placed[j]!.position;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        expect(d).toBeGreaterThan(options.radius * 0.05);
      }
    }
  });

  it('is deterministic', () => {
    const nodes = [node('r', 0, null, ['b1', 'b2']), node('c', 1, 'r', ['b1'])];
    expect(layoutSearchTree(nodes, posOf, options)).toEqual(
      layoutSearchTree(nodes, posOf, options),
    );
  });

  it('scales node size sub-linearly with member count', () => {
    const placed = layoutSearchTree(
      [node('big', 0, null, ['b1', 'b2', 'b3']), node('small', 0, null, ['b1'])],
      posOf,
      options,
    );
    const big = placed.find((p) => p.id === 'big')!;
    const small = placed.find((p) => p.id === 'small')!;
    expect(big.size).toBeGreaterThan(small.size);
    // sqrt scaling, so 3x the members must not be 3x the radius.
    expect(big.size / small.size).toBeLessThan(2);
  });

  it('tolerates books with no known position', () => {
    const placed = layoutSearchTree([node('r', 0, null, ['nope'])], posOf, options);
    for (const v of placed[0]?.position ?? []) expect(Number.isFinite(v)).toBe(true);
  });

  it('produces only finite coordinates', () => {
    const placed = layoutSearchTree(
      [node('r', 0, null, ['b1', 'b2', 'b3']), node('c', 1, 'r', ['b3'])],
      posOf,
      options,
    );
    for (const p of placed) {
      for (const v of [...p.position, ...p.anchor]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
