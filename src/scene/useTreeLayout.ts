import { useMemo } from 'react';
import { useStore, positionOf } from '@/state/store';
import { treeMaxDepth } from '@/domain/searchTree';
import { layoutSearchTree, type PlacedNode } from './searchTreeLayout';

/** Placed tree nodes for the current search.
 *
 *  Called both inside the Canvas (spheres and edges) and outside it (the HTML
 *  label overlay). The computation is pure and deterministic, so both callers
 *  agree; it runs only when the query changes and costs a fraction of a
 *  millisecond for a few dozen nodes. */
export function useTreeLayout(): PlacedNode[] {
  const searchTree = useStore((s) => s.searchTree);
  const byId = useStore((s) => s.byId);
  const positions = useStore((s) => s.positions);
  const radius = useStore((s) => s.radius);

  return useMemo(() => {
    if (searchTree.length === 0) return [];
    return layoutSearchTree(searchTree, (id) => positionOf({ byId, positions }, id), {
      radius,
      maxDepth: treeMaxDepth(searchTree),
    });
  }, [searchTree, byId, positions, radius]);
}
