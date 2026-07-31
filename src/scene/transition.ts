import { MAX_NODES, type EdgeKind, type GraphNode } from '@/domain/graph';
import type { NodeRef } from '@/domain/nodeRef';
import { spawnOriginFor, type Vec3 } from './motion';

export type SlotPair = [number, number];

/** Growth and cross edges are drawn at very different opacities — 0.24 against
 *  0.07 — so a retreating cross edge promoted to the growth pass would read as a
 *  faint link suddenly brightening on its way out. */
export type EdgesByKind = Record<EdgeKind, SlotPair[]>;

/** How long one node takes to travel, growing or retreating. */
export const SPAWN_MS = 520;

/** Per-node delay, so a fan unfurls in similarity order — the best match arrives
 *  first, which is a second, free encoding of rank. Retreating uses the same
 *  gap in the opposite order. */
export const STAGGER_MS = 45;

export interface TransitionInput {
  /** Node refs at render slots `0..n-1` as of the previous revision. */
  prevRefs: readonly NodeRef[];
  /** `parentIndex` per previous render slot, for walking up to a survivor. */
  prevParents: readonly (number | null)[];
  /** Previous revision's edges, in previous slot indices. */
  prevEdges: ReadonlyArray<{ from: number; to: number; kind: EdgeKind }>;
  /** The graph as it is now. */
  nextNodes: readonly GraphNode[];
  /** Live rendered positions, indexed by PREVIOUS render slot. */
  rendered: Float32Array;
  now: number;
  reduced: boolean;
}

export interface TransitionPlan {
  /** Render slots `[0, liveCount)` are the graph. */
  liveCount: number;
  /** Render slots `[liveCount, liveCount + ghostCount)` are on their way out. */
  ghostCount: number;
  /** Previous render slot of each ghost, so the caller can carry its size, tier
   *  and mark across to the ghost slot instead of recomputing them from a node
   *  that no longer exists. */
  ghostFrom: number[];
  /** `(liveCount + ghostCount) * 3` — where each slot starts. */
  from: Float32Array;
  /** `(liveCount + ghostCount) * 3` — where each slot ends. */
  to: Float32Array;
  /** When each slot starts moving. `-Infinity` means "already there". */
  startAt: Float64Array;
  /** Previous edges with at least one departing end, in NEW slot indices. Without
   *  these the lines snap out of existence while the nodes they connect are
   *  still visibly travelling. */
  ghostEdges: EdgesByKind;
  /** When every tween in this plan has finished. */
  until: number;
}

/** Work out what every render slot should do between two revisions of the graph.
 *
 *  ONE RULE: a slot travels from wherever it is currently rendered to wherever
 *  its node now belongs. Everything falls out of that.
 *
 *   - A node that did not move has `from === to`, so it holds still.
 *   - A node whose SLOT changed — which is what `collapseNode` does to every
 *     node after the one you collapsed, because it compacts the array — is
 *     found by ref rather than by index, so it is written to its new slot at the
 *     position it already occupies instead of inheriting the previous
 *     occupant's.
 *   - A node that is new starts at its parent, via `spawnOriginFor`.
 *   - A node that is GONE is not dropped on the spot. It keeps a render slot
 *     past the live ones and retreats into the nearest ancestor that survived,
 *     which is the node you clicked.
 *
 *  The previous version had no such rule. It treated `slot >= previousCount` as
 *  "new" and everything else as "already correct", which is only true while the
 *  graph grows. On a collapse the removed subtree vanished in one frame and
 *  every survivor whose slot had shifted teleported to its new position in the
 *  next, because its start time was long past so the tween evaluated as
 *  finished. Two separate jolts, from the same missing idea. */
export function planTransition(input: TransitionInput): TransitionPlan {
  const { prevRefs, prevParents, prevEdges, nextNodes, rendered, now, reduced } = input;

  const liveCount = Math.min(nextNodes.length, MAX_NODES);
  const prevSlotOf = new Map<NodeRef, number>();
  prevRefs.forEach((ref, i) => prevSlotOf.set(ref, i));

  const newSlotOf = new Map<NodeRef, number>();
  for (let i = 0; i < liveCount; i++) newSlotOf.set(nextNodes[i]!.nodeRef, i);

  const at = (slot: number): Vec3 => [
    rendered[slot * 3] as number,
    rendered[slot * 3 + 1] as number,
    rendered[slot * 3 + 2] as number,
  ];

  // Departing, deepest first. Slots are assigned in append order, so descending
  // slot order runs from the most recently grown leaf back toward the node that
  // was clicked — the reverse of the order they arrived in, which is what makes
  // this read as retraction rather than as a second expansion.
  const ghostFrom: number[] = [];
  // Nothing retreats into an empty map. `reset` swaps the whole graph out at
  // once, and a hundred nodes drifting nowhere in particular is not a collapse —
  // it is the previous map refusing to leave.
  if (!reduced && liveCount > 0) {
    for (let i = prevRefs.length - 1; i >= 0; i--) {
      if (!newSlotOf.has(prevRefs[i] as NodeRef)) ghostFrom.push(i);
    }
  }
  const ghostCount = Math.min(ghostFrom.length, Math.max(0, MAX_NODES - liveCount));
  ghostFrom.length = ghostCount;

  /** Where a ghost retreats to: the rendered position of its nearest ancestor
   *  that is still on the map. Walking the chain rather than assuming the direct
   *  parent survived means a whole subtree collapses into the one node that was
   *  clicked, however deep it was. */
  const anchorFor = (slot: number): Vec3 => {
    const seen = new Set<number>();
    let cursor = prevParents[slot] ?? null;
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const ref = prevRefs[cursor];
      if (ref !== undefined && newSlotOf.has(ref)) return at(cursor);
      cursor = prevParents[cursor] ?? null;
    }
    // Unreachable while the seed survives every collapse, which it does — but
    // standing still beats travelling to the origin if that ever changes.
    return at(slot);
  };

  const total = liveCount + ghostCount;
  const from = new Float32Array(total * 3);
  const to = new Float32Array(total * 3);
  const startAt = new Float64Array(total);
  let until = now;

  let arrivals = 0;
  for (let i = 0; i < liveCount; i++) {
    const node = nextNodes[i]!;
    const wasAt = prevSlotOf.get(node.nodeRef);
    let origin: Vec3;
    let delay: number;
    if (wasAt === undefined) {
      const parent = node.parentIndex === null ? null : nextNodes[node.parentIndex];
      origin = spawnOriginFor(node.target, parent?.target ?? null, reduced);
      delay = arrivals++ * STAGGER_MS;
    } else {
      origin = at(wasAt);
      // No stagger on a node that is merely being corrected: a ripple across
      // nodes that are not conceptually moving reads as the map twitching.
      delay = 0;
    }
    from[i * 3] = origin[0];
    from[i * 3 + 1] = origin[1];
    from[i * 3 + 2] = origin[2];
    to[i * 3] = node.target[0];
    to[i * 3 + 1] = node.target[1];
    to[i * 3 + 2] = node.target[2];
    startAt[i] = reduced ? -Infinity : now + delay;
    if (!reduced) until = Math.max(until, now + delay + SPAWN_MS);
  }

  for (let g = 0; g < ghostCount; g++) {
    const oldSlot = ghostFrom[g] as number;
    const slot = liveCount + g;
    const origin = at(oldSlot);
    const anchor = anchorFor(oldSlot);
    from[slot * 3] = origin[0];
    from[slot * 3 + 1] = origin[1];
    from[slot * 3 + 2] = origin[2];
    to[slot * 3] = anchor[0];
    to[slot * 3 + 1] = anchor[1];
    to[slot * 3 + 2] = anchor[2];
    const delay = g * STAGGER_MS;
    startAt[slot] = now + delay;
    until = Math.max(until, now + delay + SPAWN_MS);
  }

  const ghostSlotOf = new Map<number, number>();
  ghostFrom.forEach((oldSlot, g) => ghostSlotOf.set(oldSlot, liveCount + g));

  const ghostEdges: EdgesByKind = { growth: [], cross: [] };
  if (ghostCount > 0) {
    const resolve = (oldSlot: number): number | undefined => {
      const ghost = ghostSlotOf.get(oldSlot);
      if (ghost !== undefined) return ghost;
      const ref = prevRefs[oldSlot];
      return ref === undefined ? undefined : newSlotOf.get(ref);
    };
    for (const edge of prevEdges) {
      // Edges between two survivors are already in the live edge list; drawing
      // them here as well would double their opacity for half a second.
      if (!ghostSlotOf.has(edge.from) && !ghostSlotOf.has(edge.to)) continue;
      const a = resolve(edge.from);
      const b = resolve(edge.to);
      if (a === undefined || b === undefined) continue;
      ghostEdges[edge.kind].push([a, b]);
    }
  }

  return { liveCount, ghostCount, ghostFrom, from, to, startAt, ghostEdges, until };
}

/** Shared between `GraphPoints`, which writes it, and `GraphEdges`, which reads
 *  it. Deliberately not in the store: it changes mid-animation and nothing may
 *  re-render because of it. */
export interface TransitionState {
  ghostEdges: EdgesByKind;
}

export function emptyTransitionState(): TransitionState {
  return { ghostEdges: { growth: [], cross: [] } };
}
