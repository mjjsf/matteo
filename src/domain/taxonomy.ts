import type {
  Book,
  TagMap,
  TaxonomyFile,
  TaxonomyIndex,
  TaxonomyNode,
  TaxonomyNodeSpec,
} from './types';

/** Flatten the authored nested tree into an indexed form.
 *  Throws on structural problems (duplicate ids) rather than producing a
 *  half-valid index — a malformed taxonomy should fail loudly at load. */
export function buildTaxonomyIndex(file: TaxonomyFile): TaxonomyIndex {
  const byId = new Map<string, TaxonomyNode>();
  const ancestorsOf = new Map<string, string[]>();
  let maxDepth = 0;

  const walk = (
    spec: TaxonomyNodeSpec,
    parentId: string | null,
    depth: number,
    rootId: string,
    ancestors: string[],
  ): void => {
    if (byId.has(spec.id)) {
      throw new Error(`taxonomy: duplicate node id "${spec.id}"`);
    }
    const node: TaxonomyNode = {
      id: spec.id,
      label: spec.label,
      parentId,
      childIds: (spec.children ?? []).map((c) => c.id),
      depth,
      rootId,
    };
    byId.set(spec.id, node);
    ancestorsOf.set(spec.id, ancestors);
    maxDepth = Math.max(maxDepth, depth);
    for (const child of spec.children ?? []) {
      walk(child, spec.id, depth + 1, rootId, [spec.id, ...ancestors]);
    }
  };

  for (const root of file.roots) {
    walk(root, null, 0, root.id, []);
  }

  return {
    byId,
    rootIds: file.roots.map((r) => r.id),
    maxDepth,
    membersOf: new Map(),
    ancestorsOf,
  };
}

/** Resolve a book's raw subject tags to the taxonomy nodes they classify into.
 *  Unknown tags are skipped here; the integrity test is what rejects them, so
 *  a stray tag degrades one book's placement rather than breaking the app. */
export function nodesForBook(book: Book, tagMap: TagMap): string[] {
  const out = new Set<string>();
  for (const tag of book.subjects) {
    for (const nodeId of tagMap[tag] ?? []) out.add(nodeId);
  }
  return [...out];
}

/** Every taxonomy node a book belongs to, including all ancestors. */
export function nodesWithAncestorsForBook(
  book: Book,
  tagMap: TagMap,
  index: TaxonomyIndex,
): string[] {
  const out = new Set<string>();
  for (const nodeId of nodesForBook(book, tagMap)) {
    out.add(nodeId);
    for (const a of index.ancestorsOf.get(nodeId) ?? []) out.add(a);
  }
  return [...out];
}

/** Populate `membersOf` so branch membership is never walked per frame.
 *  Mutates and returns the index. */
export function populateMembers(
  index: TaxonomyIndex,
  books: Book[],
  tagMap: TagMap,
): TaxonomyIndex {
  const membersOf = new Map<string, Set<string>>();
  for (const id of index.byId.keys()) membersOf.set(id, new Set());

  for (const book of books) {
    for (const nodeId of nodesWithAncestorsForBook(book, tagMap, index)) {
      membersOf.get(nodeId)?.add(book.id);
    }
  }
  index.membersOf = membersOf;
  return index;
}

/** The depth-0 branch a book belongs to most strongly, by number of matching
 *  leaf mappings; ties break on the taxonomy's authored root order so the
 *  result is stable rather than dependent on tag order. */
export function primaryRootForBook(
  book: Book,
  tagMap: TagMap,
  index: TaxonomyIndex,
): string | null {
  const counts = new Map<string, number>();
  for (const nodeId of nodesForBook(book, tagMap)) {
    const node = index.byId.get(nodeId);
    if (!node) continue;
    counts.set(node.rootId, (counts.get(node.rootId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const rootId of index.rootIds) {
    const c = counts.get(rootId) ?? 0;
    if (c > bestCount) {
      best = rootId;
      bestCount = c;
    }
  }
  return best;
}

export function isLeaf(node: TaxonomyNode): boolean {
  return node.childIds.length === 0;
}

export function leafIds(index: TaxonomyIndex): string[] {
  return [...index.byId.values()].filter(isLeaf).map((n) => n.id);
}

/** Detect cycles and unreachable nodes. Returns problem descriptions; empty
 *  means structurally sound. Used by the integrity test. */
export function validateStructure(index: TaxonomyIndex): string[] {
  const problems: string[] = [];

  for (const node of index.byId.values()) {
    if (node.parentId !== null && !index.byId.has(node.parentId)) {
      problems.push(`node "${node.id}" has unresolvable parent "${node.parentId}"`);
    }
    for (const childId of node.childIds) {
      if (!index.byId.has(childId)) {
        problems.push(`node "${node.id}" has unresolvable child "${childId}"`);
      }
    }
  }

  // Reachability from roots doubles as a cycle check: a cycle is unreachable
  // from any root, since every node in it has a parent inside the cycle.
  const seen = new Set<string>();
  const stack = [...index.rootIds];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) {
      problems.push(`node "${id}" reachable more than once (cycle or shared child)`);
      continue;
    }
    seen.add(id);
    stack.push(...(index.byId.get(id)?.childIds ?? []));
  }
  for (const id of index.byId.keys()) {
    if (!seen.has(id)) problems.push(`node "${id}" is not reachable from any root`);
  }

  return problems;
}
