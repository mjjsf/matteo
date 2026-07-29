/** The exploration graph: a seed book plus the generations grown from it.
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
  bookId: string;
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

export interface GraphEdge {
  from: number;
  to: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** bookId -> node index, so a book already on screen is never added twice. */
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

export function seedGraph(bookId: string): Graph {
  return {
    nodes: [
      { bookId, target: [0, 0, 0], parentIndex: null, generation: 0, expanded: false, expandable: true },
    ],
    edges: [],
    indexOf: new Map([[bookId, 0]]),
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

/** Place `count` children on a spherical cap around `origin`, oriented along
 *  `axis`, using a golden-angle spiral so they fan out evenly and deterministically.
 *  `weights` (0..1, higher = more similar) pull a child slightly closer. */
export function placeChildren(
  origin: [number, number, number],
  axis: [number, number, number],
  count: number,
  weights: number[],
): Array<[number, number, number]> {
  const a = normalise(axis);
  const { u, v } = basisFor(a);

  const out: Array<[number, number, number]> = [];
  const cosMax = Math.cos(CONE_HALF_ANGLE);
  for (let i = 0; i < count; i++) {
    // Area-uniform over the spherical cap, so children spread evenly rather than
    // bunching near the axis. Because the polar angle grows with i and neighbours
    // arrive best-match-first, the MOST similar child lands dead ahead on the
    // growth axis and relevance falls off toward the rim — the ranking is encoded
    // in the geometry for free.
    const t = count === 1 ? 0 : (i + 0.5) / count;
    const polar = Math.acos(1 - t * (1 - cosMax));
    const azimuth = i * GOLDEN_ANGLE;

    const sinP = Math.sin(polar);
    const cosP = Math.cos(polar);
    const dir: [number, number, number] = [
      a[0] * cosP + (u[0] * Math.cos(azimuth) + v[0] * Math.sin(azimuth)) * sinP,
      a[1] * cosP + (u[1] * Math.cos(azimuth) + v[1] * Math.sin(azimuth)) * sinP,
      a[2] * cosP + (u[2] * Math.cos(azimuth) + v[2] * Math.sin(azimuth)) * sinP,
    ];

    // More similar books sit a little nearer, so proximity carries meaning.
    const w = weights[i] ?? 0.5;
    const dist = EDGE_LEN * (1.18 - 0.28 * Math.max(0, Math.min(1, w)));

    out.push([origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist]);
  }
  return out;
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
  candidates: Array<{ bookId: string; weight: number }>,
  maxChildren: number,
  maxNodes: number = MAX_NODES,
): ExpansionResult {
  const node = graph.nodes[nodeIndex];
  if (!node) return { graph, added: [], reason: 'unknown-node' };
  if (node.expanded) return { graph, added: [], reason: 'already-expanded' };

  const fresh: Array<{ bookId: string; weight: number }> = [];
  const linkToExisting: number[] = [];
  for (const c of candidates) {
    if (fresh.length >= maxChildren) break;
    const existing = graph.indexOf.get(c.bookId);
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
        ...linkToExisting.map((to) => ({ from: nodeIndex, to })),
      ];
      return { graph: { ...graph, nodes, edges }, added: [] };
    }
    return {
      graph,
      added: [],
      reason: room === 0 ? 'at-capacity' : 'no-new-neighbours',
    };
  }

  const placed = placeChildren(
    node.target,
    growthAxis(graph, nodeIndex),
    admitted.length,
    admitted.map((c) => c.weight),
  );
  const settled = relaxNewNodes(
    graph.nodes.map((n) => n.target),
    placed,
  );

  const nodes = graph.nodes.map((n, i) => (i === nodeIndex ? { ...n, expanded: true } : n));
  const edges = [...graph.edges, ...linkToExisting.map((to) => ({ from: nodeIndex, to }))];
  const indexOf = new Map(graph.indexOf);
  const added: number[] = [];

  admitted.forEach((c, i) => {
    const index = nodes.length;
    nodes.push({
      bookId: c.bookId,
      target: settled[i] as [number, number, number],
      parentIndex: nodeIndex,
      generation: node.generation + 1,
      expanded: false,
      expandable: true,
    });
    indexOf.set(c.bookId, index);
    edges.push({ from: nodeIndex, to: index });
    added.push(index);
  });

  return { graph: { nodes, edges, indexOf }, added };
}

export interface OutlineRow {
  slot: Slot;
  bookId: string;
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
    rows.push({ slot: asSlot(index), bookId: node.bookId, depth });
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
