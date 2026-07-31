import { describe, expect, it } from 'vitest';
import { collapseNode, type Graph, type GraphNode } from '@/domain/graph';
import { bookRef, type NodeRef } from '@/domain/nodeRef';
import { SPAWN_MS, STAGGER_MS, planTransition, type TransitionInput } from './transition';

type Vec = [number, number, number];

function node(id: string, target: Vec, parentIndex: number | null, generation: number): GraphNode {
  return {
    nodeRef: bookRef(id),
    target,
    parentIndex,
    generation,
    expanded: false,
    expandable: true,
  };
}

/** A seed with two branches, each opened once. Slots are in the order the nodes
 *  were grown, because `expandNode` appends:
 *
 *      0 seed          at the origin
 *      ├── 1 a         (10, 0, 0)     opened -> 3
 *      └── 2 b         (0, 10, 0)     opened -> 4
 *          3 a1        (20, 0, 0)
 *          4 b1        (0, 20, 0)
 *
 *  Both branches matter. Collapsing `a` removes slot 3, which is NOT the last
 *  slot, so `b1` is compacted from 4 down to 3 — the case where a slot stops
 *  naming the same node, and the one the old animation code got wrong. A fixture
 *  with a single branch cannot reach it, because the only removable slots are at
 *  the end. */
function sample(): Graph {
  const nodes = [
    node('seed', [0, 0, 0], null, 0),
    node('a', [10, 0, 0], 0, 1),
    node('b', [0, 10, 0], 0, 1),
    node('a1', [20, 0, 0], 1, 2),
    node('b1', [0, 20, 0], 2, 2),
  ];
  nodes[1]!.expanded = true;
  nodes[2]!.expanded = true;
  return {
    nodes,
    edges: [
      { from: 0, to: 1, kind: 'growth' },
      { from: 0, to: 2, kind: 'growth' },
      { from: 1, to: 3, kind: 'growth' },
      { from: 2, to: 4, kind: 'growth' },
      { from: 3, to: 4, kind: 'cross' },
    ],
    indexOf: new Map(nodes.map((n, i) => [n.nodeRef, i])),
  };
}

/** Everything settled at its target — the state between two clicks. */
function renderedAt(graph: Graph): Float32Array {
  const out = new Float32Array(graph.nodes.length * 3 + 60);
  graph.nodes.forEach((n, i) => {
    out[i * 3] = n.target[0];
    out[i * 3 + 1] = n.target[1];
    out[i * 3 + 2] = n.target[2];
  });
  return out;
}

function inputFor(prev: Graph, next: Graph, overrides: Partial<TransitionInput> = {}) {
  return {
    prevRefs: prev.nodes.map((n) => n.nodeRef),
    prevParents: prev.nodes.map((n) => n.parentIndex),
    prevEdges: prev.edges,
    nextNodes: next.nodes,
    rendered: renderedAt(prev),
    now: 1000,
    reduced: false,
    ...overrides,
  };
}

const slot = (a: Float32Array, i: number): Vec => [
  a[i * 3] as number,
  a[i * 3 + 1] as number,
  a[i * 3 + 2] as number,
];

describe('growing', () => {
  it('starts a new node at its parent and ends it at its own target', () => {
    const before = sample();
    const after = { ...before, nodes: [...before.nodes, node('c', [0, 0, 10], 0, 1)] };
    const plan = planTransition(inputFor(before, after));

    expect(plan.liveCount).toBe(6);
    expect(plan.ghostCount).toBe(0);
    expect(slot(plan.from, 5)).toEqual([0, 0, 0]);
    expect(slot(plan.to, 5)).toEqual([0, 0, 10]);
  });

  it('leaves every node that did not move exactly where it is', () => {
    const before = sample();
    const after = { ...before, nodes: [...before.nodes, node('c', [0, 0, 10], 0, 1)] };
    const plan = planTransition(inputFor(before, after));

    for (let i = 0; i < before.nodes.length; i++) {
      expect(slot(plan.from, i), `slot ${i}`).toEqual(slot(plan.to, i));
    }
  });

  it('staggers arrivals so a fan unfurls in order', () => {
    const before = sample();
    const after = {
      ...before,
      nodes: [...before.nodes, node('c', [0, 0, 10], 0, 1), node('d', [0, 0, -10], 0, 1)],
    };
    const plan = planTransition(inputFor(before, after));
    expect((plan.startAt[6] as number) - (plan.startAt[5] as number)).toBe(STAGGER_MS);
  });
});

describe('collapsing', () => {
  /** Fold up node `a`, which takes `a1` with it. */
  const collapse = () => {
    const before = sample();
    const { graph: after } = collapseNode(before, 1);
    return { before, after };
  };

  it('removes the subtree from the graph but not from the screen', () => {
    const { before, after } = collapse();
    expect(after.nodes).toHaveLength(4);

    const plan = planTransition(inputFor(before, after));
    expect(plan.liveCount).toBe(4);
    // `a1` is gone from the graph and still has somewhere to be drawn, which is
    // the entire point: before this it vanished in the same frame the click
    // landed.
    expect(plan.ghostCount).toBe(1);
    expect(plan.ghostFrom).toEqual([3]);
  });

  it('retreats the subtree into the node that was clicked', () => {
    const { before, after } = collapse();
    const plan = planTransition(inputFor(before, after));
    const ghost = plan.liveCount;
    expect(slot(plan.from, ghost)).toEqual([20, 0, 0]);
    expect(slot(plan.to, ghost)).toEqual([10, 0, 0]);
  });

  it('retreats a whole branch into the clicked node, not into its own parent', () => {
    // Two generations below the collapse. The middle node is departing too, so
    // walking one step up would land the deepest node on a point that is itself
    // travelling; it has to walk to the nearest SURVIVOR.
    const before = sample();
    before.nodes.push(node('a2', [30, 0, 0], 3, 3));
    before.edges.push({ from: 3, to: 5, kind: 'growth' });
    before.indexOf.set(bookRef('a2'), 5);
    const { graph: after } = collapseNode(before, 1);

    const plan = planTransition(inputFor(before, after));
    expect(plan.ghostCount).toBe(2);
    for (let g = 0; g < plan.ghostCount; g++) {
      expect(slot(plan.to, plan.liveCount + g)).toEqual([10, 0, 0]);
    }
  });

  it('lets go deepest first, the reverse of the order they arrived', () => {
    const before = sample();
    before.nodes.push(node('a2', [30, 0, 0], 3, 3));
    before.indexOf.set(bookRef('a2'), 5);
    const { graph: after } = collapseNode(before, 1);

    const plan = planTransition(inputFor(before, after));
    expect(plan.ghostFrom).toEqual([5, 3]);
    expect((plan.startAt[plan.liveCount + 1] as number)).toBeGreaterThan(
      plan.startAt[plan.liveCount] as number,
    );
  });

  it('keeps a survivor still even though its slot moved under it', () => {
    // THE regression this was written for. Collapsing `a` removes slot 3, so
    // `collapseNode` compacts `b1` from slot 4 down to 3 — and `b1` is on the
    // other branch entirely, nowhere near the click. The old code decided what
    // to animate by comparing slot numbers against the previous count, concluded
    // `b1` was not new, and left its start time in the past, so the tween
    // evaluated as finished and `b1` jumped to whatever slot 3 now pointed at in
    // a single frame. Collapsing one branch visibly kicked another.
    const { before, after } = collapse();
    const wasAt = before.nodes.findIndex((n) => n.nodeRef === bookRef('b1'));
    const nowAt = after.nodes.findIndex((n) => n.nodeRef === bookRef('b1'));
    expect(wasAt).toBe(4);
    expect(nowAt).toBe(3);

    const plan = planTransition(inputFor(before, after));
    expect(slot(plan.from, nowAt)).toEqual([0, 20, 0]);
    expect(slot(plan.to, nowAt)).toEqual([0, 20, 0]);
  });

  it('carries the edges out with the nodes, at their own weights', () => {
    const { before, after } = collapse();
    const plan = planTransition(inputFor(before, after));
    const ghost = plan.liveCount;

    const b1 = after.nodes.findIndex((n) => n.nodeRef === bookRef('b1'));
    // a -> a1, remapped: `a` survives at its own slot, `a1` moves to the ghost.
    expect(plan.ghostEdges.growth).toEqual([[1, ghost]]);
    // a1 -> b1 was a cross edge and stays one; drawn at 0.07 rather than 0.24,
    // it would brighten on the way out if it were promoted. The surviving end is
    // remapped to b1's COMPACTED slot, not the slot it had when the edge was
    // recorded.
    expect(plan.ghostEdges.cross).toEqual([[ghost, b1]]);
  });

  it('does not redraw edges between two survivors', () => {
    const { before, after } = collapse();
    const plan = planTransition(inputFor(before, after));
    const live = [...plan.ghostEdges.growth, ...plan.ghostEdges.cross].filter(
      ([a, b]) => a < plan.liveCount && b < plan.liveCount,
    );
    expect(live).toEqual([]);
  });

  it('finishes, and says when', () => {
    const { before, after } = collapse();
    const plan = planTransition(inputFor(before, after));
    expect(plan.until).toBe(1000 + SPAWN_MS);
  });
});

describe('reduced motion', () => {
  it('drops the subtree immediately instead of retreating it', () => {
    const before = sample();
    const { graph: after } = collapseNode(before, 1);
    const plan = planTransition(inputFor(before, after, { reduced: true }));
    expect(plan.ghostCount).toBe(0);
    expect(plan.ghostEdges).toEqual({ growth: [], cross: [] });
  });

  it('still puts every node at its own target, not at its parent', () => {
    // The trap this repeats: writing the parent position AND skipping the tween
    // is not the animation minus the animation, it is a node that departs and
    // never arrives. It shipped that way once and flattened the graph onto a
    // line for anyone who had asked for less motion.
    const before = sample();
    const after = { ...before, nodes: [...before.nodes, node('c', [0, 0, 10], 0, 1)] };
    const plan = planTransition(inputFor(before, after, { reduced: true }));
    expect(slot(plan.from, 5)).toEqual([0, 0, 10]);
    expect(plan.startAt[5]).toBe(-Infinity);
    expect(plan.until).toBe(1000);
  });
});

describe('starting over', () => {
  it('clears the map outright instead of retreating it into nothing', () => {
    // `reset` swaps in an empty graph. Every node departs at once and none of
    // them has a surviving ancestor to travel toward, so they would each stand
    // still — a map that visibly refuses to leave, then blinks out half a second
    // later. Worse, the frame loop's drop path is reached through the live
    // count, so with no live nodes at all they would never be dropped.
    const before = sample();
    const empty: Graph = { nodes: [], edges: [], indexOf: new Map() };
    const plan = planTransition(inputFor(before, empty));
    expect(plan.liveCount).toBe(0);
    expect(plan.ghostCount).toBe(0);
    expect(plan.ghostEdges).toEqual({ growth: [], cross: [] });
  });

  it('starts from nothing without reading off the end of the buffer', () => {
    const first = sample();
    const plan = planTransition({
      prevRefs: [] as NodeRef[],
      prevParents: [],
      prevEdges: [],
      nextNodes: first.nodes,
      rendered: new Float32Array(60),
      now: 0,
      reduced: false,
    });
    expect(plan.liveCount).toBe(5);
    expect(plan.ghostCount).toBe(0);
    expect(slot(plan.to, 0)).toEqual([0, 0, 0]);
  });
});
