import type { NodeRef } from './nodeRef';

/** The exploration graph: a seed plus the generations grown from it.
 *
 *  Pure logic — no three.js, no React — so the placement rules are testable on
 *  their own. */

/** Index into the node array — and therefore also the VERTEX index in the points
 *  geometry, and the index into every per-node buffer. Branded so it cannot be
 *  passed where a corpus row index is expected.
 *
 *  This exists because the previous version of this app conflated the two: it
 *  mapped a raycast vertex index straight into the corpus array. That was correct
 *  only while every book was on screen in corpus order. Under a subgraph it
 *  silently hovers the wrong book — no error, just wrong data. The brand turns
 *  that into a compile error. */
export type Slot = number & { readonly __brand: 'Slot' };
export const asSlot = (n: number): Slot => n as Slot;

/** How a node should read visually. Without this distinction, "click a node to
 *  expand it" is undiscoverable, and clicking an exhausted node does nothing with
 *  no explanation. */
export const TIER = {
  seed: 0,
  expandable: 1,
  expanded: 2,
  exhausted: 3,
} as const;
export type Tier = (typeof TIER)[keyof typeof TIER];

export function tierOf(node: GraphNode): Tier {
  if (node.generation === 0) return TIER.seed;
  if (node.expanded) return TIER.expanded;
  return node.expandable ? TIER.expandable : TIER.exhausted;
}

export interface GraphNode {
  /** What this node refers to — a book, topic, tag or author. Was a bare book
   *  id when the map held only books; see `nodeRef.ts` for why it is namespaced
   *  rather than a discriminated union. */
  nodeRef: NodeRef;
  /** Where the node is settling toward. `position` in the scene animates to it. */
  target: [number, number, number];
  /** Index into the node array, or null for the seed. */
  parentIndex: number | null;
  /** 0 for the seed. */
  generation: number;
  expanded: boolean;
  /** False when every neighbour above the similarity floor is already on screen,
   *  so the UI can show it as a leaf rather than inviting a click that does
   *  nothing. */
  expandable: boolean;
}

/** How two books on the map came to be connected.
 *
 *  `growth` is "I opened that book and this one appeared". `cross` is "this book
 *  is also similar to one already on screen" — real information, and the reason
 *  this is a graph rather than a tree, but it links arbitrarily distant nodes.
 *  At two hundred books those long edges dominate the picture and the branching
 *  stops being legible, so the renderer draws them as a secondary layer. */
export type EdgeKind = 'growth' | 'cross';

export interface GraphEdge {
  from: number;
  to: number;
  kind: EdgeKind;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** nodeRef -> node index, so a thing already on screen is never added twice. */
  indexOf: Map<string, number>;
}

/** Distance from a parent to its children. Everything else scales off this, so
 *  there is no global "radius" constant any more. */
export const EDGE_LEN = 10;
/** Children spread this far off the growth axis. Wide enough to fan out, narrow
 *  enough that growth still reads as heading outward. */
export const CONE_HALF_ANGLE = (52 * Math.PI) / 180;
/** Golden angle — distributes successive children around the axis without them
 *  lining up. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** How far a fan may be turned off its local outward direction to find room.
 *
 *  Capped rather than unbounded: past roughly 45° the children stop reading as
 *  growing away from their parent, which is a worse legibility problem than the
 *  crowding it would be solving. */
export const MAX_DEFLECTION = (44 * Math.PI) / 180;
/** Only what sits within this of the expanding node can crowd it out. Beyond it
 *  the branches are far enough apart to read as separate anyway. */
export const CROWD_RADIUS = EDGE_LEN * 2.6;
/** Directions sampled inside the deflection cap when looking for room. */
const AXIS_CANDIDATES = 32;
/** Crowding below this counts as clear, and the local axis is kept untouched. */
const CLEAR_ENOUGH = 0.05;
/** Price paid, in crowding units, for turning a full 90° off the local axis.
 *  Small enough that a genuinely clearer direction wins, large enough that a
 *  near-tie keeps the natural outward one. */
const DEFLECTION_COST = 0.15;
/** What relaxation AIMS for. */
export const MIN_NODE_GAP = EDGE_LEN * 0.42;
/** What placement GUARANTEES, via the escape pass. Tests assert this one —
 *  asserting the soft target above would give a flaky test. */
export const MIN_NODE_GAP_HARD = MIN_NODE_GAP * 0.8;
/** Hard array capacity. Never exceeded silently. */
export const MAX_NODES = 400;
/** Product limit — how large a graph we let a person grow. Separate from the
 *  array capacity on purpose: this one is a UX judgement, that one is a memory
 *  invariant. */
export const SOFT_CAP = 220;

/** Children per expansion, indexed by the PARENT's generation.
 *
 *  Eight children recursively is 1 + 8 + 64 + 512 — generation 3 alone blows past
 *  any sane graph size. Expansion is on demand so most people never approach it,
 *  but tapering means someone who clicks breadth-first still gets three or four
 *  usable generations instead of hitting a wall inside two. */
export const CHILDREN_BY_DEPTH = [8, 8, 6, 5, 4] as const;

export function childrenAtDepth(depth: number): number {
  return CHILDREN_BY_DEPTH[Math.min(depth, CHILDREN_BY_DEPTH.length - 1)] ?? 4;
}

export function emptyGraph(): Graph {
  return { nodes: [], edges: [], indexOf: new Map() };
}

export function seedGraph(nodeRef: NodeRef): Graph {
  return {
    nodes: [
      { nodeRef, target: [0, 0, 0], parentIndex: null, generation: 0, expanded: false, expandable: true },
    ],
    edges: [],
    indexOf: new Map([[nodeRef, 0]]),
  };
}

function normalise(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Branchless orthonormal basis (Duff/Frisvad) around a unit vector.
 *
 *  Deliberately not `cross(axis, someUpVector)`: that flips discontinuously when
 *  the axis happens to align with the chosen up-vector, which would make the fan
 *  orientation jump for particular growth directions. */
function basisFor(a: [number, number, number]): {
  u: [number, number, number];
  v: [number, number, number];
} {
  const s = a[2] >= 0 ? 1 : -1;
  const A = -1 / (s + a[2]);
  const B = a[0] * a[1] * A;
  return {
    u: [1 + s * a[0] * a[0] * A, s * B, -s * a[0]],
    v: [B, s + a[1] * a[1] * A, -a[1]],
  };
}

/** The direction a node's children should grow in: away from its own parent, so
 *  the graph expands outward instead of folding back over itself. */
export function growthAxis(graph: Graph, nodeIndex: number): [number, number, number] {
  const node = graph.nodes[nodeIndex];
  if (!node) return [0, 1, 0];
  if (node.parentIndex === null) return [0, 1, 0];
  const parent = graph.nodes[node.parentIndex];
  if (!parent) return [0, 1, 0];
  return normalise([
    node.target[0] - parent.target[0],
    node.target[1] - parent.target[1],
    node.target[2] - parent.target[2],
  ]);
}

/** `count` unit directions spread over the spherical cap of half-angle
 *  `halfAngle` around `axis`, as a golden-angle spiral.
 *
 *  Area-uniform, so they spread evenly rather than bunching near the axis, and
 *  ordered by polar angle: direction 0 is nearest the axis and they fan outward
 *  from there. Both `placeChildren` and the free-space search below want exactly
 *  this, which is why it is one function rather than two copies of the maths. */
export function capDirections(
  axis: [number, number, number],
  count: number,
  halfAngle: number,
): Array<[number, number, number]> {
  const a = normalise(axis);
  const { u, v } = basisFor(a);
  const cosMax = Math.cos(halfAngle);

  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i + 0.5) / count;
    const polar = Math.acos(1 - t * (1 - cosMax));
    const azimuth = i * GOLDEN_ANGLE;

    const sinP = Math.sin(polar);
    const cosP = Math.cos(polar);
    out.push([
      a[0] * cosP + (u[0] * Math.cos(azimuth) + v[0] * Math.sin(azimuth)) * sinP,
      a[1] * cosP + (u[1] * Math.cos(azimuth) + v[1] * Math.sin(azimuth)) * sinP,
      a[2] * cosP + (u[2] * Math.cos(azimuth) + v[2] * Math.sin(azimuth)) * sinP,
    ]);
  }
  return out;
}

/** Everything a new fan could collide with, seen from the node being expanded.
 *
 *  Node positions, plus the MIDPOINT of every growth edge. A branch is its nodes
 *  *and* the lines between them, and one extra point per edge approximates that
 *  at no structural cost — without it a fan happily threads between two nodes and
 *  straight through the edge joining them.
 *
 *  Cross edges are left out on purpose: they link arbitrarily distant books and
 *  are drawn faint for exactly that reason, so counting them as occupancy would
 *  make every direction look blocked at once. */
function occupiedPoints(graph: Graph, nodeIndex: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    if (i === nodeIndex) continue;
    out.push((graph.nodes[i] as GraphNode).target);
  }
  for (const e of graph.edges) {
    if (e.kind !== 'growth') continue;
    const a = graph.nodes[e.from];
    const b = graph.nodes[e.to];
    if (!a || !b) continue;
    out.push([
      (a.target[0] + b.target[0]) / 2,
      (a.target[1] + b.target[1]) / 2,
      (a.target[2] + b.target[2]) / 2,
    ]);
  }
  return out;
}

/** How much of the graph already sits AHEAD of `dir`, seen from `origin`.
 *  Zero means the direction is clear; larger means more in the way. */
export function crowding(
  origin: [number, number, number],
  dir: [number, number, number],
  occupied: Array<[number, number, number]>,
): number {
  const d = normalise(dir);
  let score = 0;
  for (const q of occupied) {
    const rx = q[0] - origin[0];
    const ry = q[1] - origin[1];
    const rz = q[2] - origin[2];
    const len = Math.hypot(rx, ry, rz);
    if (len < 1e-6 || len >= CROWD_RADIUS) continue;
    const cos = (rx * d[0] + ry * d[1] + rz * d[2]) / len;
    // Behind you is not in your way — which is also why a node's own parent,
    // always directly behind by construction, contributes nothing here.
    if (cos <= 0) continue;
    // Linear falloff with compact support, squared alignment: a direction that
    // merely grazes a cluster scores far below one aimed into it.
    score += (1 - len / CROWD_RADIUS) * cos * cos;
  }
  return score;
}

/** The direction `expandNode` actually fans children into: the local outward
 *  direction, turned toward whatever nearby direction has room.
 *
 *  `growthAxis` alone is blind to the rest of the graph, so opening a node whose
 *  outward direction happens to point at a sibling branch fires eight children
 *  straight into it. Relaxation then only separates them by MIN_NODE_GAP, so the
 *  two branches end up interleaved rather than overlapping — which is what reads
 *  as tangle, and it compounds every generation as adjacent cones converge.
 *
 *  Deterministic: fixed candidate set, no randomness, first index wins ties. */
export function openGrowthAxis(graph: Graph, nodeIndex: number): [number, number, number] {
  const base = growthAxis(graph, nodeIndex);
  const node = graph.nodes[nodeIndex];
  if (!node) return base;

  const occupied = occupiedPoints(graph, nodeIndex);
  const baseScore = crowding(node.target, base, occupied);
  // Nothing in the way: keep the natural axis untouched, so this only acts where
  // there is an actual conflict. The seed's first fan always takes this path.
  if (baseScore <= CLEAR_ENOUGH) return base;

  let best = base;
  let bestScore = baseScore;
  for (const c of capDirections(base, AXIS_CANDIDATES, MAX_DEFLECTION)) {
    const dot = base[0] * c[0] + base[1] * c[1] + base[2] * c[2];
    const score = crowding(node.target, c, occupied) + DEFLECTION_COST * (1 - dot);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** How far past the crowd a boxed-in fan reaches, at full crowding. */
const REACH_GAIN = 0.5;
/** Crowding at which `growthReach` saturates. */
const REACH_SATURATION = 2;

/** How far a fan should reach along `axis`, as a multiple of the normal length.
 *
 *  Turning toward open space is not always enough — in a dense part of the graph
 *  even the clearest direction still has something in it, and the fan lands on
 *  top of a branch it could have cleared by growing a little further. One shared
 *  multiplier per fan rather than per child, so the "more similar sits nearer"
 *  ordering within the fan is untouched. */
export function growthReach(graph: Graph, nodeIndex: number, axis: [number, number, number]): number {
  const node = graph.nodes[nodeIndex];
  if (!node) return 1;
  const residual = crowding(node.target, axis, occupiedPoints(graph, nodeIndex));
  return 1 + REACH_GAIN * Math.min(1, residual / REACH_SATURATION);
}

/** Place `count` children on a spherical cap around `origin`, oriented along
 *  `axis`, using a golden-angle spiral so they fan out evenly and deterministically.
 *  `weights` (0..1, higher = more similar) pull a child slightly closer.
 *  `reach` scales the whole fan outward — see `growthReach`. */
export function placeChildren(
  origin: [number, number, number],
  axis: [number, number, number],
  count: number,
  weights: number[],
  reach = 1,
): Array<[number, number, number]> {
  // Because the polar angle grows with i and neighbours arrive best-match-first,
  // the MOST similar child lands dead ahead on the growth axis and relevance
  // falls off toward the rim — the ranking is encoded in the geometry for free.
  return capDirections(axis, count, CONE_HALF_ANGLE).map((dir, i) => {
    // More similar books sit a little nearer, so proximity carries meaning.
    const w = weights[i] ?? 0.5;
    const dist = EDGE_LEN * (1.18 - 0.28 * Math.max(0, Math.min(1, w))) * reach;
    return [
      origin[0] + dir[0] * dist,
      origin[1] + dir[1] * dist,
      origin[2] + dir[2] * dist,
    ] as [number, number, number];
  });
}

/** Push newly placed nodes apart from each other and from everything already on
 *  screen.
 *
 *  Only the NEW positions move — every existing node is treated as immovable.
 *  That is what stops earlier parts of the graph shifting under the user when a
 *  new generation appears, which would be disorienting and make the graph hard to
 *  re-read. Deterministic: no randomness, fixed iteration count. */
export function relaxNewNodes(
  fixed: Array<[number, number, number]>,
  fresh: Array<[number, number, number]>,
  iterations = 24,
): Array<[number, number, number]> {
  const out = fresh.map((p) => [...p] as [number, number, number]);

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    let moved = false;

    for (let i = 0; i < out.length; i++) {
      const p = out[i] as [number, number, number];

      const pushFrom = (q: readonly [number, number, number], symmetric: boolean): void => {
        const dx = p[0] - q[0];
        const dy = p[1] - q[1];
        const dz = p[2] - q[2];
        const d = Math.hypot(dx, dy, dz);
        if (d >= MIN_NODE_GAP) return;
        moved = true;
        // Degenerate overlap: shove along a fixed axis rather than dividing by ~0.
        const ux = d < 1e-6 ? 1 : dx / d;
        const uy = d < 1e-6 ? 0 : dy / d;
        const uz = d < 1e-6 ? 0 : dz / d;
        const push = (MIN_NODE_GAP - d) * (symmetric ? 0.5 : 1) * cooling;
        p[0] += ux * push;
        p[1] += uy * push;
        p[2] += uz * push;
      };

      for (const q of fixed) pushFrom(q, false);
      for (let j = 0; j < out.length; j++) {
        if (j !== i) pushFrom(out[j] as [number, number, number], true);
      }
    }

    if (!moved) break;
  }

  return escapeOverlaps(fixed, out);
}

/** Relaxation is best-effort — cooling can strand a node inside another. This
 *  pass walks any still-overlapping node outward along its own direction until it
 *  is clear, and terminates unconditionally.
 *
 *  The distinction matters: MIN_NODE_GAP is what relaxation aims for,
 *  MIN_NODE_GAP_HARD is what this guarantees and what the tests assert. */
function escapeOverlaps(
  fixed: Array<[number, number, number]>,
  fresh: Array<[number, number, number]>,
): Array<[number, number, number]> {
  const out = fresh.map((p) => [...p] as [number, number, number]);

  const clearOf = (p: [number, number, number], selfIndex: number): boolean => {
    for (const q of fixed) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < MIN_NODE_GAP_HARD) return false;
    }
    for (let j = 0; j < out.length; j++) {
      if (j === selfIndex) continue;
      const q = out[j] as [number, number, number];
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < MIN_NODE_GAP_HARD) return false;
    }
    return true;
  };

  for (let i = 0; i < out.length; i++) {
    const p = out[i] as [number, number, number];
    if (clearOf(p, i)) continue;

    // Push outward from the origin of the local cluster, i.e. away from the mean
    // of everything it is colliding with.
    const dir = normalise([p[0], p[1], p[2]]);
    for (let step = 0; step < 14 && !clearOf(p, i); step++) {
      p[0] += dir[0] * MIN_NODE_GAP_HARD * 0.6;
      p[1] += dir[1] * MIN_NODE_GAP_HARD * 0.6;
      p[2] += dir[2] * MIN_NODE_GAP_HARD * 0.6;
    }
  }

  return out;
}

export interface ExpansionResult {
  graph: Graph;
  /** Node indices added by this expansion, for animating them in. */
  added: number[];
  /** Set when nothing was added, so the UI can explain why. */
  reason?: 'already-expanded' | 'at-capacity' | 'no-new-neighbours' | 'unknown-node';
}

/** Grow `candidates` (book ids, best match first, with 0..1 similarity weights)
 *  out of the node at `nodeIndex`. Books already on screen are skipped rather
 *  than duplicated — an edge to the existing node is added instead. */
export function expandNode(
  graph: Graph,
  nodeIndex: number,
  candidates: Array<{ nodeRef: NodeRef; weight: number }>,
  maxChildren: number,
  maxNodes: number = MAX_NODES,
): ExpansionResult {
  const node = graph.nodes[nodeIndex];
  if (!node) return { graph, added: [], reason: 'unknown-node' };
  if (node.expanded) return { graph, added: [], reason: 'already-expanded' };

  const fresh: Array<{ nodeRef: NodeRef; weight: number }> = [];
  const linkToExisting: number[] = [];
  for (const c of candidates) {
    if (fresh.length >= maxChildren) break;
    const existing = graph.indexOf.get(c.nodeRef);
    if (existing !== undefined) {
      if (existing !== nodeIndex) linkToExisting.push(existing);
      continue;
    }
    fresh.push(c);
  }

  const room = Math.max(0, maxNodes - graph.nodes.length);
  const admitted = fresh.slice(0, room);

  if (admitted.length === 0) {
    // Still mark it expanded if we linked to books already present, so the user
    // is not left clicking a node that can never do anything.
    if (linkToExisting.length > 0) {
      const nodes = graph.nodes.map((n, i) => (i === nodeIndex ? { ...n, expanded: true } : n));
      const edges = [
        ...graph.edges,
        ...linkToExisting.map((to) => ({ from: nodeIndex, to, kind: 'cross' as const })),
      ];
      return { graph: { ...graph, nodes, edges }, added: [] };
    }
    return {
      graph,
      added: [],
      reason: room === 0 ? 'at-capacity' : 'no-new-neighbours',
    };
  }

  const axis = openGrowthAxis(graph, nodeIndex);
  const placed = placeChildren(
    node.target,
    axis,
    admitted.length,
    admitted.map((c) => c.weight),
    growthReach(graph, nodeIndex, axis),
  );
  const settled = relaxNewNodes(
    graph.nodes.map((n) => n.target),
    placed,
  );

  const nodes = graph.nodes.map((n, i) => (i === nodeIndex ? { ...n, expanded: true } : n));
  const edges = [
    ...graph.edges,
    ...linkToExisting.map((to) => ({ from: nodeIndex, to, kind: 'cross' as const })),
  ];
  const indexOf = new Map(graph.indexOf);
  const added: number[] = [];

  admitted.forEach((c, i) => {
    const index = nodes.length;
    nodes.push({
      nodeRef: c.nodeRef,
      target: settled[i] as [number, number, number],
      parentIndex: nodeIndex,
      generation: node.generation + 1,
      expanded: false,
      expandable: true,
    });
    indexOf.set(c.nodeRef, index);
    edges.push({ from: nodeIndex, to: index, kind: 'growth' });
    added.push(index);
  });

  return { graph: { nodes, edges, indexOf }, added };
}

export interface CollapseResult {
  graph: Graph;
  /** Old indices that no longer exist, for the caller to drop references to. */
  removed: number[];
  /** Old index -> new index, for every node that survived. */
  oldToNew: Map<number, number>;
}

/** Remove everything grown from `nodeIndex`, leaving that node re-growable.
 *
 *  Array surgery, deliberately, and NOT a replay of the expansion path. Replaying
 *  would re-run `openGrowthAxis` against different crowding and land the surviving
 *  branches somewhere new — so collapsing one branch would visibly reshuffle the
 *  others, which is the same disorientation `relaxNewNodes` exists to prevent.
 *  Compacting instead leaves every surviving node's `target` byte-for-byte where
 *  it was.
 *
 *  Survivors are kept in ascending index order. That is what preserves the
 *  invariant that an array index IS the vertex slot, and it keeps `outline`
 *  ordering (parents before their children) intact for free, since a child is
 *  always appended after its parent. */
export function collapseNode(graph: Graph, nodeIndex: number): CollapseResult {
  const node = graph.nodes[nodeIndex];
  const identity = (): CollapseResult => ({
    graph,
    removed: [],
    oldToNew: new Map(graph.nodes.map((_, i) => [i, i])),
  });
  if (!node) return identity();

  const childrenOf = new Map<number, number[]>();
  graph.nodes.forEach((n, i) => {
    if (n.parentIndex === null) return;
    const list = childrenOf.get(n.parentIndex);
    if (list) list.push(i);
    else childrenOf.set(n.parentIndex, [i]);
  });

  const doomed = new Set<number>();
  const stack = [...(childrenOf.get(nodeIndex) ?? [])];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (doomed.has(i)) continue;
    doomed.add(i);
    for (const child of childrenOf.get(i) ?? []) stack.push(child);
  }
  if (doomed.size === 0) return identity();

  const oldToNew = new Map<number, number>();
  const nodes: GraphNode[] = [];
  graph.nodes.forEach((n, i) => {
    if (doomed.has(i)) return;
    oldToNew.set(i, nodes.length);
    nodes.push(
      i === nodeIndex
        ? // Back to a leaf that invites a click. `expandable` is restored too:
          // it may have been cleared when every neighbour turned out to be on
          // screen already, and those neighbours may be the ones just removed.
          { ...n, expanded: false, expandable: true }
        : { ...n },
    );
  });

  for (const n of nodes) {
    if (n.parentIndex === null) continue;
    n.parentIndex = oldToNew.get(n.parentIndex) ?? null;
  }

  // Cross edges are dropped alongside growth edges when either end goes. They
  // point at arbitrarily distant nodes, so a stale one would index into whatever
  // book now occupies that slot and draw a line to the wrong book.
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    if (doomed.has(e.from) || doomed.has(e.to)) continue;
    const from = oldToNew.get(e.from);
    const to = oldToNew.get(e.to);
    if (from === undefined || to === undefined) continue;
    edges.push({ from, to, kind: e.kind });
  }

  return {
    graph: { nodes, edges, indexOf: new Map(nodes.map((n, i) => [n.nodeRef, i])) },
    removed: [...doomed],
    oldToNew,
  };
}

export interface OutlineRow {
  slot: Slot;
  nodeRef: NodeRef;
  /** Tree depth, which equals `generation`. Exposed separately because the DOM
   *  mirror renders it as `aria-level`, which is 1-based. */
  depth: number;
}

/** Depth-first walk of the graph, for the DOM mirror.
 *
 *  The mirror is not a courtesy copy — it is how keyboard and screen-reader
 *  users do the exploring, so its order has to match what the canvas shows:
 *  each book followed by the books grown from it, siblings in similarity order
 *  (which is insertion order, since `expandNode` appends best-match-first).
 *
 *  Only true parent→child edges are walked. Cross edges — links to a book
 *  already on screen elsewhere — are skipped here on purpose: following them
 *  would make the same book appear repeatedly and turn a tree into something a
 *  screen reader cannot announce a position within. */
export function outline(graph: Graph): OutlineRow[] {
  const childrenOf = new Map<number, number[]>();
  graph.nodes.forEach((node, i) => {
    if (node.parentIndex === null) return;
    const list = childrenOf.get(node.parentIndex);
    if (list) list.push(i);
    else childrenOf.set(node.parentIndex, [i]);
  });

  const rows: OutlineRow[] = [];
  const walk = (index: number, depth: number): void => {
    const node = graph.nodes[index];
    if (!node) return;
    rows.push({ slot: asSlot(index), nodeRef: node.nodeRef, depth });
    for (const child of childrenOf.get(index) ?? []) walk(child, depth + 1);
  };

  graph.nodes.forEach((node, i) => {
    if (node.parentIndex === null) walk(i, 0);
  });
  return rows;
}

/** Centre and radius of the placed nodes, for framing the camera. Replaces the
 *  old fixed `radius = 50`, which assumed a pre-baked cloud. */
export function graphBounds(graph: Graph): { center: [number, number, number]; radius: number } {
  if (graph.nodes.length === 0) return { center: [0, 0, 0], radius: EDGE_LEN };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const n of graph.nodes) {
    cx += n.target[0];
    cy += n.target[1];
    cz += n.target[2];
  }
  const k = graph.nodes.length;
  cx /= k;
  cy /= k;
  cz /= k;
  let radius = 0;
  for (const n of graph.nodes) {
    radius = Math.max(radius, Math.hypot(n.target[0] - cx, n.target[1] - cy, n.target[2] - cz));
  }
  return { center: [cx, cy, cz], radius: Math.max(radius, EDGE_LEN) };
}
