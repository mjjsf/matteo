import type { SearchTreeNode } from '@/domain/types';

export interface PlacedNode extends SearchTreeNode {
  position: [number, number, number];
  /** Centroid of the node's matched books — the tether's lower end. */
  anchor: [number, number, number];
  /** Sphere radius, from member count. */
  size: number;
}

export interface TreeLayoutOptions {
  radius: number;
  maxDepth: number;
  /** Vertical separation per depth level, as a fraction of the cloud radius. */
  levelLift?: number;
  iterations?: number;
}

/** Position the search-derived tag tree in the same space as the books.
 *
 *  Computed at runtime rather than baked, because it depends on the query.
 *
 *  Three things make it readable:
 *   1. Anchor at the matched-member centroid, so XZ position agrees with where
 *      those books actually are — the tree reads as part of one object rather
 *      than a separate diagram.
 *   2. Lift by depth, so roots float above leaves and parent->child edges
 *      visibly descend. This is also the main anti-overlap mechanism, and it is
 *      free. A centroid alone would bury every label inside the densest part of
 *      its own cluster, making both the label and the points unreadable.
 *   3. A short deterministic spring relaxation to separate nodes that still
 *      overlap. No randomness, so the same query always yields the same tree. */
export function layoutSearchTree(
  nodes: SearchTreeNode[],
  positionOf: (bookId: string) => [number, number, number] | null,
  options: TreeLayoutOptions,
): PlacedNode[] {
  const { radius, maxDepth } = options;
  const levelLift = options.levelLift ?? 0.2;
  const iterations = options.iterations ?? 60;
  if (nodes.length === 0) return [];

  const maxCount = nodes.reduce((m, n) => Math.max(m, n.matchCount), 1);

  const placed: PlacedNode[] = nodes.map((node) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const id of node.matchedBookIds) {
      const p = positionOf(id);
      if (!p) continue;
      cx += p[0];
      cy += p[1];
      cz += p[2];
      n++;
    }
    if (n > 0) {
      cx /= n;
      cy /= n;
      cz /= n;
    }
    const anchor: [number, number, number] = [cx, cy, cz];
    const lift = (maxDepth - node.depth + 1) * levelLift * radius;
    return {
      ...node,
      anchor,
      position: [cx, cy + lift, cz],
      // sqrt so a branch with 200 matches does not become a planet next to one
      // with 5.
      size: radius * 0.02 * (0.7 + 0.6 * Math.sqrt(node.matchCount / maxCount)),
    };
  });

  // Degenerate case that actually happens: when few books match, several nodes
  // describe the SAME books and therefore share an identical centroid. Depth
  // lifting separates different levels, but same-depth siblings would stack
  // exactly on top of each other and their labels would collide illegibly.
  // Fan those out deterministically first, so the relaxation below has some
  // separation to work with instead of fighting the anchor spring.
  const byAnchorDepth = new Map<string, PlacedNode[]>();
  for (const node of placed) {
    const key = `${node.depth}:${node.anchor.map((v) => v.toFixed(2)).join(',')}`;
    const list = byAnchorDepth.get(key) ?? [];
    list.push(node);
    byAnchorDepth.set(key, list);
  }
  for (const group of byAnchorDepth.values()) {
    if (group.length < 2) continue;
    const spread = radius * 0.11 * Math.min(3, Math.sqrt(group.length));
    group.forEach((node, i) => {
      const angle = (i / group.length) * Math.PI * 2;
      node.position[0] += Math.cos(angle) * spread;
      node.position[2] += Math.sin(angle) * spread;
    });
  }

  // The relaxation springs toward these rather than the raw anchor, so it does
  // not simply undo the fan above.
  const springTarget = new Map<string, [number, number]>(
    placed.map((n) => [n.id, [n.position[0], n.position[2]]]),
  );

  // Spring relaxation: pairwise repulsion between nodes, weak spring back to
  // the lifted anchor. Fully deterministic — no randomness needed, since the
  // initial positions are already fixed.
  const byId = new Map(placed.map((p) => [p.id, p]));
  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i] as PlacedNode;
        const b = placed[j] as PlacedNode;
        const dx = b.position[0] - a.position[0];
        const dy = b.position[1] - a.position[1];
        const dz = b.position[2] - a.position[2];
        const dist = Math.hypot(dx, dy, dz);
        // Exclusion distance accounts for the label extending to the right of
        // the sphere, which is where collisions actually happen.
        const minDist = (a.size + b.size) * 1.6 + radius * 0.05;
        if (dist >= minDist) continue;

        const push = ((minDist - dist) / 2) * 0.5 * cooling;
        if (dist < 1e-6) {
          a.position[0] -= push;
          b.position[0] += push;
          continue;
        }
        const ux = dx / dist;
        const uy = dy / dist;
        const uz = dz / dist;
        a.position[0] -= ux * push;
        a.position[1] -= uy * push;
        a.position[2] -= uz * push;
        b.position[0] += ux * push;
        b.position[1] += uy * push;
        b.position[2] += uz * push;
      }
    }

    // Spring back toward the lifted target so nodes do not drift far from the
    // books they describe.
    for (const node of placed) {
      const lift = (maxDepth - node.depth + 1) * levelLift * radius;
      const targetY = node.anchor[1] + lift;
      const [tx, tz] = springTarget.get(node.id) ?? [node.anchor[0], node.anchor[2]];
      node.position[0] += (tx - node.position[0]) * 0.06 * cooling;
      node.position[1] += (targetY - node.position[1]) * 0.12 * cooling;
      node.position[2] += (tz - node.position[2]) * 0.06 * cooling;
    }
  }

  // Keep children below their parents so the tree reads top-down even after
  // relaxation nudged things around.
  for (const node of placed) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent) continue;
    const minGap = radius * levelLift * 0.5;
    if (node.position[1] > parent.position[1] - minGap) {
      node.position[1] = parent.position[1] - minGap;
    }
  }

  return placed;
}
