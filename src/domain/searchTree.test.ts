import { describe, expect, it } from 'vitest';
import { buildSearchTree, treeMaxDepth } from './searchTree';
import { buildTaxonomyIndex } from './taxonomy';
import type { Book, TagMap, TaxonomyFile } from './types';

const file: TaxonomyFile = {
  version: 1,
  roots: [
    {
      id: 'r1',
      label: 'Root One',
      children: [
        {
          id: 'r1-a',
          label: 'Branch A',
          children: [
            { id: 'r1-a-x', label: 'Leaf X' },
            { id: 'r1-a-y', label: 'Leaf Y' },
          ],
        },
        {
          id: 'r1-b',
          label: 'Branch B',
          children: [{ id: 'r1-b-z', label: 'Leaf Z' }],
        },
      ],
    },
    {
      id: 'r2',
      label: 'Root Two',
      children: [{ id: 'r2-c', label: 'Branch C', children: [{ id: 'r2-c-w', label: 'Leaf W' }] }],
    },
  ],
};

const tagMap: TagMap = {
  x: ['r1-a-x'],
  y: ['r1-a-y'],
  z: ['r1-b-z'],
  w: ['r2-c-w'],
};

const index = buildTaxonomyIndex(file);

const book = (id: string, subjects: string[]): Book => ({
  id,
  title: id,
  authors: ['A'],
  year: 2000,
  subjects,
  description: 'd',
});

describe('buildSearchTree', () => {
  it('returns an empty tree for no matches', () => {
    expect(buildSearchTree([], tagMap, index)).toEqual([]);
    expect(treeMaxDepth([])).toBe(0);
  });

  it('omits nodes with no matched members entirely', () => {
    const tree = buildSearchTree([book('b1', ['x'])], tagMap, index);
    const ids = tree.map((n) => n.id);
    // Nothing from r2 should appear.
    expect(ids).not.toContain('r2');
    expect(ids).not.toContain('r2-c');
    expect(ids).not.toContain('r2-c-w');
    // Nor the unmatched sibling leaf.
    expect(ids).not.toContain('r1-a-y');
    expect(ids).not.toContain('r1-b');
  });

  it('collapses single-child chains carrying the identical member set', () => {
    // One book tagged only `x` means r1 -> r1-a -> r1-a-x all hold exactly that
    // book, so the chain should collapse to a single node rather than three
    // nested spheres saying the same thing.
    const tree = buildSearchTree([book('b1', ['x'])], tagMap, index);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe('r1-a-x');
    expect(tree[0]?.collapsedFrom).toEqual(['r1', 'r1-a']);
    expect(tree[0]?.matchCount).toBe(1);
  });

  it('does not collapse where a node genuinely branches', () => {
    const tree = buildSearchTree(
      [book('b1', ['x']), book('b2', ['y'])],
      tagMap,
      index,
    );
    const ids = tree.map((n) => n.id);
    // r1 -> r1-a still has one retained child, but r1-a has two, so the chain
    // stops there.
    expect(ids).toContain('r1-a');
    expect(ids).toContain('r1-a-x');
    expect(ids).toContain('r1-a-y');
    expect(tree.find((n) => n.id === 'r1-a')?.matchCount).toBe(2);
  });

  it('counts matched members up through ancestors', () => {
    const tree = buildSearchTree(
      [book('b1', ['x']), book('b2', ['z'])],
      tagMap,
      index,
    );
    const root = tree.find((n) => n.id === 'r1');
    expect(root?.matchCount).toBe(2);
    expect(root?.depth).toBe(0);
    expect(root?.parentId).toBeNull();
  });

  it('does not double-count a book tagged into two leaves of one branch', () => {
    const tree = buildSearchTree([book('b1', ['x', 'y'])], tagMap, index);
    expect(tree.find((n) => n.id === 'r1-a')?.matchCount).toBe(1);
  });

  it('handles multiple roots independently', () => {
    const tree = buildSearchTree(
      [book('b1', ['x']), book('b2', ['w'])],
      tagMap,
      index,
    );
    const roots = tree.filter((n) => n.depth === 0);
    expect(roots).toHaveLength(2);
  });

  it('keeps parent links consistent with emitted nodes', () => {
    const tree = buildSearchTree(
      [book('b1', ['x']), book('b2', ['y']), book('b3', ['z'])],
      tagMap,
      index,
    );
    const ids = new Set(tree.map((n) => n.id));
    for (const node of tree) {
      if (node.parentId !== null) expect(ids.has(node.parentId)).toBe(true);
    }
  });

  it('ignores unknown tags without throwing', () => {
    expect(buildSearchTree([book('b1', ['nope'])], tagMap, index)).toEqual([]);
  });

  it('reports the deepest emitted level', () => {
    const tree = buildSearchTree(
      [book('b1', ['x']), book('b2', ['y'])],
      tagMap,
      index,
    );
    expect(treeMaxDepth(tree)).toBeGreaterThanOrEqual(1);
  });
});
