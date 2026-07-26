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
/** Upper bound on emitted nodes.
 *
 *  Without a cap the tree scales with how broadly the results are tagged, not
 *  with how many there are: a query matching 232 books produced 120 nodes, which
 *  is 120 floating labels in the scene and a 120-row outline — unreadable, and
 *  the opposite of what the tree is for. Roots are always kept so the shape of
 *  the result set stays visible; depth is what gets trimmed. */
export const MAX_TREE_NODES = 28;

export function buildSearchTree(
  matched: Book[],
  tagMap: TagMap,
  index: TaxonomyIndex,
  maxNodes: number = MAX_TREE_NODES,
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

  return prune(out, maxNodes);
}

/** Trim a built tree to `maxNodes`, keeping the most informative nodes.
 *
 *  Depth-0 nodes are always kept — they are the shape of the result set. Beyond
 *  those, nodes are admitted by match count (biggest groups first), and a node is
 *  only admitted if its parent already was, so no orphan ever ends up pointing at
 *  a parent that was trimmed away. */
function prune(nodes: SearchTreeNode[], maxNodes: number): SearchTreeNode[] {
  if (nodes.length <= maxNodes) return nodes;

  const keep = new Set<string>();
  for (const node of nodes) {
    if (node.depth === 0) keep.add(node.id);
  }

  const candidates = nodes
    .filter((n) => n.depth > 0)
    .sort((a, b) => b.matchCount - a.matchCount || a.depth - b.depth);

  // Repeat passes so a deep node can still be admitted once its ancestor is,
  // regardless of sort order.
  let added = true;
  while (added && keep.size < maxNodes) {
    added = false;
    for (const node of candidates) {
      if (keep.size >= maxNodes) break;
      if (keep.has(node.id)) continue;
      if (node.parentId !== null && !keep.has(node.parentId)) continue;
      keep.add(node.id);
      added = true;
    }
  }

  // Preserve the original emission order so the outline still reads top-down.
  return nodes.filter((n) => keep.has(n.id));
}

/** Max depth actually present in a built tree — drives the vertical lift so
 *  the tree's height adapts to the result set instead of being fixed. */
export function treeMaxDepth(nodes: SearchTreeNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.depth), 0);
}
