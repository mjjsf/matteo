import type { Book, SearchTreeNode, TagMap, TaxonomyIndex } from './types';
import { nodesForBook } from './taxonomy';

/** Build the tag tree from a set of matched books.
 *
 *  The tree only exists while a search is active — there is no tree at rest.
 *  That is what keeps it small and legible: a handful of nodes scoped to the
 *  result set rather than all 122 taxonomy nodes competing for label space. It
 *  also reads better, because the tree explains *these results* rather than
 *  restating a fixed classification.
 *
 *  Produces the minimal subtree covering the matches:
 *   - nodes with no matched members are omitted entirely
 *   - single-child chains collapse, so a lone deep match does not render as
 *     three nested spheres saying effectively the same thing */
export function buildSearchTree(
  matched: Book[],
  tagMap: TagMap,
  index: TaxonomyIndex,
): SearchTreeNode[] {
  if (matched.length === 0) return [];

  // Direct (leaf-ish) membership, then propagate up through ancestors.
  const membersByNode = new Map<string, Set<string>>();
  const add = (nodeId: string, bookId: string): void => {
    let set = membersByNode.get(nodeId);
    if (!set) {
      set = new Set();
      membersByNode.set(nodeId, set);
    }
    set.add(bookId);
  };

  for (const book of matched) {
    for (const nodeId of nodesForBook(book, tagMap)) {
      if (!index.byId.has(nodeId)) continue;
      add(nodeId, book.id);
      for (const ancestorId of index.ancestorsOf.get(nodeId) ?? []) {
        add(ancestorId, book.id);
      }
    }
  }

  // Retain only present nodes, keeping the authored parent/child relationships
  // restricted to what survived.
  const present = new Set(membersByNode.keys());
  const retainedChildren = new Map<string, string[]>();
  for (const nodeId of present) {
    const node = index.byId.get(nodeId);
    if (!node) continue;
    retainedChildren.set(
      nodeId,
      node.childIds.filter((c) => present.has(c)),
    );
  }

  const out: SearchTreeNode[] = [];

  const emit = (
    nodeId: string,
    parentId: string | null,
    depth: number,
    collapsedFrom: string[],
  ): void => {
    const node = index.byId.get(nodeId);
    const members = membersByNode.get(nodeId);
    if (!node || !members) return;

    let currentId = nodeId;
    let children = retainedChildren.get(currentId) ?? [];
    const collapsed = [...collapsedFrom];

    // Collapse a chain while this node has exactly one retained child that
    // carries the identical member set — the intermediate node adds no
    // information, only clutter.
    for (;;) {
      if (children.length !== 1) break;
      const onlyChild = children[0] as string;
      const childMembers = membersByNode.get(onlyChild);
      if (!childMembers || childMembers.size !== members.size) break;
      collapsed.push(currentId);
      currentId = onlyChild;
      children = retainedChildren.get(currentId) ?? [];
    }

    const finalNode = index.byId.get(currentId);
    if (!finalNode) return;

    out.push({
      id: currentId,
      label: finalNode.label,
      depth,
      parentId,
      matchCount: members.size,
      matchedBookIds: [...members],
      collapsedFrom: collapsed,
    });

    for (const childId of children) {
      emit(childId, currentId, depth + 1, []);
    }
  };

  for (const rootId of index.rootIds) {
    if (present.has(rootId)) emit(rootId, null, 0, []);
  }

  return out;
}

/** Max depth actually present in a built tree — drives the vertical lift so
 *  the tree's height adapts to the result set instead of being fixed. */
export function treeMaxDepth(nodes: SearchTreeNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.depth), 0);
}
