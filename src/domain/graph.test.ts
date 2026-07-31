import { describe, expect, it } from 'vitest';
import {
  CONE_HALF_ANGLE,
  CROWD_RADIUS,
  EDGE_LEN,
  MAX_DEFLECTION,
  MIN_NODE_GAP_HARD,
  SOFT_CAP,
  TIER,
  capDirections,
  childrenAtDepth,
  collapseNode,
  crowding,
  expandNode,
  graphBounds,
  growthAxis,
  growthReach,
  openGrowthAxis,
  outline,
  placeChildren,
  relaxNewNodes,
  seedGraph,
  tierOf,
  type Graph,
} from './graph';
import { bookRef, type NodeRef } from './nodeRef';

const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

const cand = (n: number, from = 0): Array<{ nodeRef: NodeRef; weight: number }> =>
  Array.from({ length: n }, (_, i) => ({ nodeRef: bookRef(`b${from + i}`), weight: 1 - i * 0.05 }));

/** Grow a graph by repeatedly expanding the first unexpanded node. */
function grow(steps: number): Graph {
  let g = seedGraph(bookRef('seed'));
  let issued = 0;
  for (let s = 0; s < steps; s++) {
    const idx = g.nodes.findIndex((n) => !n.expanded);
    if (idx === -1) break;
    const n = childrenAtDepth(g.nodes[idx]!.generation);
    const result = expandNode(g, idx, cand(n, issued), n);
    issued += n;
    if (result.added.length === 0 && result.reason) break;
    g = result.graph;
  }
  return g;
}

describe('placeChildren', () => {
  it('is deterministic to the bit', () => {
    const a = placeChildren([0, 0, 0], [0, 1, 0], 8, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]);
    const b = placeChildren([0, 0, 0], [0, 1, 0], 8, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]);
    expect(a).toEqual(b);
  });

  it('puts the most similar child on the growth axis', () => {
    // Ranking is encoded in the geometry: best match dead ahead, relevance
    // falling off toward the rim.
    const axis: [number, number, number] = [0, 1, 0];
    const out = placeChildren([0, 0, 0], axis, 6, [1, 0.8, 0.6, 0.4, 0.2, 0]);
    const angle = (p: [number, number, number]): number => {
      const d = Math.hypot(p[0], p[1], p[2]);
      return Math.acos(Math.max(-1, Math.min(1, (p[0] * 0 + p[1] * 1 + p[2] * 0) / d)));
    };
    for (let i = 1; i < out.length; i++) {
      expect(angle(out[i]!)).toBeGreaterThan(angle(out[i - 1]!));
    }
  });

  it('keeps every child inside the cone', () => {
    const axis: [number, number, number] = [0, 0, 1];
    for (const p of placeChildren([0, 0, 0], axis, 8, [1, 1, 1, 1, 1, 1, 1, 1])) {
      const d = Math.hypot(p[0], p[1], p[2]);
      const cos = p[2] / d;
      expect(Math.acos(Math.max(-1, Math.min(1, cos)))).toBeLessThanOrEqual(CONE_HALF_ANGLE + 1e-9);
    }
  });

  it('places more similar children closer', () => {
    const out = placeChildren([0, 0, 0], [0, 1, 0], 2, [1, 0]);
    expect(Math.hypot(...(out[0] as [number, number, number]))).toBeLessThan(
      Math.hypot(...(out[1] as [number, number, number])),
    );
  });

  it('handles a single child and a degenerate axis without NaN', () => {
    for (const axis of [[0, 1, 0], [0, 0, 0], [0, 0, -1]] as Array<[number, number, number]>) {
      for (const p of placeChildren([1, 2, 3], axis, 1, [1])) {
        for (const v of p) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('capDirections', () => {
  it('keeps every direction inside the cap, unit length, deterministically', () => {
    const axis: [number, number, number] = [0, 0, 1];
    const a = capDirections(axis, 16, MAX_DEFLECTION);
    expect(capDirections(axis, 16, MAX_DEFLECTION)).toEqual(a);
    for (const d of a) {
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 9);
      expect(Math.acos(Math.max(-1, Math.min(1, d[2])))).toBeLessThanOrEqual(
        MAX_DEFLECTION + 1e-9,
      );
    }
  });
});

describe('crowding', () => {
  const origin: [number, number, number] = [0, 0, 0];
  const up: [number, number, number] = [0, 1, 0];

  it('is zero when the direction is clear', () => {
    expect(crowding(origin, up, [])).toBe(0);
    // Beyond the radius, and behind — neither is in the way.
    expect(crowding(origin, up, [[0, CROWD_RADIUS + 1, 0]])).toBe(0);
    expect(crowding(origin, up, [[0, -EDGE_LEN, 0]])).toBe(0);
  });

  it('is positive when something sits ahead', () => {
    expect(crowding(origin, up, [[0, EDGE_LEN, 0]])).toBeGreaterThan(0);
  });

  it('scores nearer and better-aligned occupancy higher', () => {
    const near = crowding(origin, up, [[0, EDGE_LEN * 0.5, 0]]);
    const far = crowding(origin, up, [[0, EDGE_LEN * 2, 0]]);
    expect(near).toBeGreaterThan(far);

    const ahead = crowding(origin, up, [[0, EDGE_LEN, 0]]);
    const oblique = crowding(origin, up, [[EDGE_LEN, EDGE_LEN, 0]]);
    expect(ahead).toBeGreaterThan(oblique);
  });
});

describe('openGrowthAxis', () => {
  /** A seed at the origin with one child directly above it, so the child's local
   *  growth axis is exactly +y and its own fan has not been placed yet. */
  const withChildAbove = (extra: Array<[number, number, number]> = []): Graph => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, [{ nodeRef: bookRef('child'), weight: 1 }], 1).graph;
    g.nodes[1]!.target = [0, EDGE_LEN, 0];
    extra.forEach((target, i) => {
      g.nodes.push({
        nodeRef: bookRef(`blocker${i}`),
        target,
        parentIndex: 0,
        generation: 1,
        expanded: false,
        expandable: true,
      });
      g.indexOf.set(bookRef(`blocker${i}`), g.nodes.length - 1);
    });
    return g;
  };

  it('leaves the local axis alone when there is nothing nearby', () => {
    // The common case must stay bit-identical: this only acts on real conflicts,
    // and the seed's very first fan always takes this path.
    const g = withChildAbove();
    expect(openGrowthAxis(g, 1)).toEqual(growthAxis(g, 1));
    expect(openGrowthAxis(seedGraph(bookRef('seed')), 0)).toEqual(growthAxis(seedGraph(bookRef('seed')), 0));
  });

  it('turns away from a region another branch already occupies', () => {
    // A wall of nodes sitting directly on the child's outward axis — exactly the
    // case that used to fire a whole fan into an existing branch.
    const wall: Array<[number, number, number]> = [];
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        wall.push([x * 2, EDGE_LEN * 2, z * 2]);
      }
    }
    const g = withChildAbove(wall);
    const base = growthAxis(g, 1);
    const open = openGrowthAxis(g, 1);
    const occupied = g.nodes.filter((_, i) => i !== 1).map((n) => n.target);

    expect(crowding(g.nodes[1]!.target, open, occupied)).toBeLessThan(
      crowding(g.nodes[1]!.target, base, occupied),
    );

    // But not so far that the fan stops reading as growing away from its parent.
    const dot = base[0] * open[0] + base[1] * open[1] + base[2] * open[2];
    expect(Math.acos(Math.max(-1, Math.min(1, dot)))).toBeLessThanOrEqual(MAX_DEFLECTION + 1e-9);
  });

  it('is deterministic', () => {
    const g = withChildAbove([
      [0, EDGE_LEN * 2, 0],
      [2, EDGE_LEN * 2, 1],
    ]);
    expect(openGrowthAxis(g, 1)).toEqual(openGrowthAxis(g, 1));
  });

  describe('growthReach', () => {
    it('is exactly 1 when the chosen direction is clear', () => {
      const g = withChildAbove();
      expect(growthReach(g, 1, growthAxis(g, 1))).toBe(1);
    });

    it('reaches further when even the best direction is still boxed in', () => {
      // Turning is not always enough: in a dense part of the graph every
      // direction has something in it, and a fan that cannot go around has to go
      // past.
      const box: Array<[number, number, number]> = [];
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
          box.push([x * 3, EDGE_LEN * 1.6, z * 3]);
        }
      }
      const g = withChildAbove(box);
      const reach = growthReach(g, 1, openGrowthAxis(g, 1));
      expect(reach).toBeGreaterThan(1);
      // Bounded, or a crowded fan would fling itself off the map.
      expect(reach).toBeLessThanOrEqual(1.5);
    });

    it('scales the whole fan, preserving the more-similar-is-nearer ordering', () => {
      const weights = [1, 0.6, 0.2];
      const near = placeChildren([0, 0, 0], [0, 1, 0], 3, weights, 1);
      const far = placeChildren([0, 0, 0], [0, 1, 0], 3, weights, 1.4);
      for (let i = 0; i < 3; i++) {
        expect(Math.hypot(...far[i]!) / Math.hypot(...near[i]!)).toBeCloseTo(1.4, 9);
      }
    });
  });
});

describe('relaxNewNodes', () => {
  it('separates coincident new nodes', () => {
    const out = relaxNewNodes([], [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(dist(out[i]!, out[j]!)).toBeGreaterThanOrEqual(MIN_NODE_GAP_HARD - 1e-6);
      }
    }
  });

  it('pushes new nodes away from fixed ones', () => {
    const fixed: Array<[number, number, number]> = [[0, 0, 0]];
    const out = relaxNewNodes(fixed, [[0.01, 0, 0]]);
    expect(dist(out[0]!, fixed[0]!)).toBeGreaterThanOrEqual(MIN_NODE_GAP_HARD - 1e-6);
  });

  it('never moves the fixed nodes', () => {
    const fixed: Array<[number, number, number]> = [[0, 0, 0]];
    const snapshot = JSON.stringify(fixed);
    relaxNewNodes(fixed, [[0, 0, 0]]);
    expect(JSON.stringify(fixed)).toBe(snapshot);
  });

  it('terminates on a pathological pile-up', () => {
    const fresh = Array.from({ length: 60 }, () => [0, 0, 0] as [number, number, number]);
    const out = relaxNewNodes([], fresh);
    expect(out).toHaveLength(60);
    for (const p of out) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('expandNode', () => {
  it('adds children and links them to the parent', () => {
    const g = seedGraph(bookRef('seed'));
    const { graph, added } = expandNode(g, 0, cand(5), 5);
    expect(added).toHaveLength(5);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
    for (const e of graph.edges) expect(e.from).toBe(0);
    expect(graph.nodes[0]?.expanded).toBe(true);
  });

  it('NEVER moves already-placed nodes when a new generation appears', () => {
    // The property that keeps expansion from disorienting the reader. It holds
    // by construction — relaxation only writes new positions — and this test
    // exists to fail loudly if anyone "improves" it into a global relaxation.
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(6), 6).graph;
    const before = g.nodes.map((n) => JSON.stringify(n.target));

    g = expandNode(g, 1, cand(6, 100), 6).graph;

    const after = g.nodes.slice(0, before.length).map((n) => JSON.stringify(n.target));
    expect(after).toEqual(before);
  });

  it('keeps every node separated across many expansions', () => {
    const g = grow(14);
    expect(g.nodes.length).toBeGreaterThan(20);
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        expect(
          dist(g.nodes[i]!.target, g.nodes[j]!.target),
          `${g.nodes[i]!.nodeRef} and ${g.nodes[j]!.nodeRef} overlap`,
        ).toBeGreaterThanOrEqual(MIN_NODE_GAP_HARD - 1e-6);
      }
    }
  });

  it('grows outward rather than folding back over the parent', () => {
    // Stated as distance from the GRANDPARENT rather than as an angle against a
    // recomputed axis. Two reasons: the axis a fan was placed with depends on how
    // crowded the graph was at that moment, so recomputing it later need not give
    // the same vector; and `openGrowthAxis` may deliberately deflect a fan by up
    // to MAX_DEFLECTION to find room, which an angle assertion would read as
    // regression. "Each generation lands further out than the last" is the
    // property that actually matters, and it survives both.
    const g = grow(10);
    for (const node of g.nodes) {
      if (node.generation < 2 || node.parentIndex === null) continue;
      const parent = g.nodes[node.parentIndex]!;
      if (parent.parentIndex === null) continue;
      const grand = g.nodes[parent.parentIndex]!;
      expect(
        dist(node.target, grand.target),
        `${node.nodeRef} folded back toward ${grand.nodeRef}`,
      ).toBeGreaterThan(dist(parent.target, grand.target));
    }
  });

  it('links to a book already on screen instead of duplicating it', () => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(4), 4).graph;
    const before = g.nodes.length;
    // b1 is already placed (as a sibling); expanding node 1 toward it must add a
    // cross edge, not a duplicate node. Note it must not be b0 — that IS node 1,
    // and a node is never linked to itself.
    const { graph, added } = expandNode(g, 1, [{ nodeRef: bookRef('b1'), weight: 0.9 }], 4);
    expect(added).toHaveLength(0);
    expect(graph.nodes).toHaveLength(before);
    expect(graph.edges.some((e) => e.from === 1)).toBe(true);
    expect(graph.nodes[1]?.expanded).toBe(true);
  });

  it('refuses to expand a node twice', () => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(3), 3).graph;
    const again = expandNode(g, 0, cand(3, 50), 3);
    expect(again.added).toEqual([]);
    expect(again.reason).toBe('already-expanded');
  });

  it('reports capacity rather than silently dropping a branch', () => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(4), 4, 5).graph;
    const full = expandNode(g, 1, cand(4, 200), 4, 5);
    expect(full.added).toEqual([]);
    expect(full.reason).toBe('at-capacity');
  });

  it('reports an unknown node rather than throwing', () => {
    expect(expandNode(seedGraph(bookRef('seed')), 99, cand(3), 3).reason).toBe('unknown-node');
  });

  it('is deterministic across identical expansion sequences', () => {
    expect(JSON.stringify(grow(8).nodes)).toBe(JSON.stringify(grow(8).nodes));
  });

  it('assigns generations that increase away from the seed', () => {
    const g = grow(6);
    for (const node of g.nodes) {
      if (node.parentIndex === null) {
        expect(node.generation).toBe(0);
      } else {
        expect(node.generation).toBe(g.nodes[node.parentIndex]!.generation + 1);
      }
    }
  });
});

describe('collapseNode', () => {
  /** Seed -> 6 children; then expand child 1 and child 4, so there are two
   *  sibling branches and one of them sits in the MIDDLE of the node array. */
  const twoBranches = (): Graph => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(6), 6).graph;
    g = expandNode(g, 1, cand(6, 100), 6).graph;
    g = expandNode(g, 4, cand(6, 200), 6).graph;
    return g;
  };

  it('removes the whole subtree and nothing else', () => {
    const g = twoBranches();
    const doomed = g.nodes.filter((n) => n.parentIndex === 1).map((n) => n.nodeRef);
    expect(doomed.length).toBe(6);

    const { graph, removed } = collapseNode(g, 1);
    expect(removed).toHaveLength(6);
    expect(graph.nodes).toHaveLength(g.nodes.length - 6);
    for (const id of doomed) expect(graph.indexOf.has(id)).toBe(false);
  });

  it('leaves every surviving position bit-identical', () => {
    // The reason this is array surgery and not a replay: replaying would re-run
    // the crowding-aware axis choice and move the OTHER branch.
    const g = twoBranches();
    const before = new Map(g.nodes.map((n) => [n.nodeRef, JSON.stringify(n.target)]));

    const { graph } = collapseNode(g, 1);

    for (const n of graph.nodes) {
      expect(JSON.stringify(n.target), `${n.nodeRef} moved`).toBe(before.get(n.nodeRef));
    }
  });

  it('makes the collapsed node growable again', () => {
    const g = twoBranches();
    g.nodes[1]!.expandable = false; // as `expand` sets it when neighbours run out
    const { graph, oldToNew } = collapseNode(g, 1);
    const node = graph.nodes[oldToNew.get(1) as number]!;
    expect(node.expanded).toBe(false);
    expect(node.expandable).toBe(true);
    expect(tierOf(node)).toBe(TIER.expandable);
  });

  it('keeps the array dense so index still IS the vertex slot', () => {
    const { graph } = collapseNode(twoBranches(), 1);
    for (let i = 0; i < graph.nodes.length; i++) {
      expect(graph.indexOf.get(graph.nodes[i]!.nodeRef)).toBe(i);
    }
    expect(graph.indexOf.size).toBe(graph.nodes.length);
  });

  it('leaves no edge or parent pointing at a removed node', () => {
    const { graph } = collapseNode(twoBranches(), 1);
    for (const e of graph.edges) {
      expect(e.from).toBeLessThan(graph.nodes.length);
      expect(e.to).toBeLessThan(graph.nodes.length);
      expect(e.from).not.toBe(e.to);
    }
    for (const n of graph.nodes) {
      if (n.parentIndex === null) continue;
      expect(n.parentIndex).toBeLessThan(graph.nodes.length);
      expect(n.parentIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps parents ahead of their children, so the outline still reads', () => {
    const { graph } = collapseNode(twoBranches(), 1);
    graph.nodes.forEach((n, i) => {
      if (n.parentIndex !== null) expect(n.parentIndex).toBeLessThan(i);
    });
    expect(outline(graph)).toHaveLength(graph.nodes.length);
  });

  it('round-trips exactly when the collapsed branch was the last one grown', () => {
    // Undoing the most recent expansion returns the graph to precisely the state
    // it was in beforehand, so re-growing reproduces it bit for bit.
    const g = twoBranches();
    const { graph: collapsed, oldToNew } = collapseNode(g, 4);
    const regrown = expandNode(collapsed, oldToNew.get(4) as number, cand(6, 200), 6).graph;
    expect(JSON.stringify(regrown.nodes)).toBe(JSON.stringify(g.nodes));
  });

  it('brings the same books back when an earlier branch is regrown', () => {
    const g = twoBranches();
    const { graph: collapsed, oldToNew } = collapseNode(g, 1);
    const untouched = collapsed.nodes.map((n) => [n.nodeRef, JSON.stringify(n.target)] as const);

    const regrown = expandNode(collapsed, oldToNew.get(1) as number, cand(6, 100), 6).graph;

    expect(regrown.nodes.map((n) => n.nodeRef).sort()).toEqual(g.nodes.map((n) => n.nodeRef).sort());
    // Nothing that survived the collapse is disturbed by the regrowth either.
    for (const [id, target] of untouched) {
      const now = regrown.nodes.find((n) => n.nodeRef === id)!;
      expect(JSON.stringify(now.target), `${id} moved`).toBe(target);
    }
    // The regrown children may land somewhere new, and should: placement is
    // crowding-aware, and the sibling branch grown after them is now on screen.
    // Same books, better-placed — not a regression.
  });

  it('drops a cross edge whose far end was removed', () => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(4), 4).graph;
    g = expandNode(g, 1, cand(4, 100), 4).graph;
    // Point node 2 at one of node 1's children — a cross edge into the subtree.
    const victim = g.nodes.find((n) => n.parentIndex === 1)!.nodeRef;
    g = expandNode(g, 2, [{ nodeRef: victim, weight: 0.9 }], 4).graph;
    expect(g.edges.some((e) => e.kind === 'cross')).toBe(true);

    const { graph } = collapseNode(g, 1);
    expect(graph.indexOf.has(victim)).toBe(false);
    // A surviving cross edge would index whatever book now occupies that slot.
    for (const e of graph.edges) {
      expect(graph.nodes[e.from]).toBeDefined();
      expect(graph.nodes[e.to]).toBeDefined();
    }
  });

  it('is a no-op for a leaf, an unknown index, and an unexpanded node', () => {
    const g = twoBranches();
    for (const i of [2, 99, g.nodes.length - 1]) {
      const { graph, removed } = collapseNode(g, i);
      expect(removed).toEqual([]);
      expect(graph).toBe(g);
    }
  });

  it('can empty the graph back to the seed', () => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(6), 6).graph;
    const { graph } = collapseNode(g, 0);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0]?.expanded).toBe(false);
  });
});

describe('node identity', () => {
  it('keeps the node array dense so array index IS the vertex slot', () => {
    // The whole point-index/corpus-index bug class depends on this invariant.
    const g = grow(10);
    for (let i = 0; i < g.nodes.length; i++) {
      expect(g.indexOf.get(g.nodes[i]!.nodeRef)).toBe(i);
    }
    expect(g.indexOf.size).toBe(g.nodes.length);
  });

  it('never places the same book twice', () => {
    const g = grow(12);
    const ids = g.nodes.map((n) => n.nodeRef);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits only edges pointing at real nodes', () => {
    const g = grow(10);
    for (const e of g.edges) {
      expect(e.from).toBeLessThan(g.nodes.length);
      expect(e.to).toBeLessThan(g.nodes.length);
      expect(e.from).not.toBe(e.to);
    }
  });
});

describe('tiers', () => {
  it('distinguishes seed, expandable, expanded and exhausted', () => {
    let g = seedGraph(bookRef('seed'));
    g = expandNode(g, 0, cand(3), 3).graph;
    // The seed keeps its own tier even after expanding — it stays the visually
    // distinct origin of the graph rather than blending into the expanded nodes.
    expect(tierOf(g.nodes[0]!)).toBe(TIER.seed);
    expect(tierOf(g.nodes[1]!)).toBe(TIER.expandable);

    g = expandNode(g, 1, cand(3, 20), 3).graph;
    expect(tierOf(g.nodes[1]!)).toBe(TIER.expanded);

    g.nodes[2]!.expandable = false;
    expect(tierOf(g.nodes[2]!)).toBe(TIER.exhausted);
  });
});

describe('graphBounds', () => {
  it('returns a usable frame for an empty and a single-node graph', () => {
    expect(graphBounds({ nodes: [], edges: [], indexOf: new Map() }).radius).toBe(EDGE_LEN);
    expect(graphBounds(seedGraph(bookRef('a'))).radius).toBe(EDGE_LEN);
  });

  it('grows with the graph', () => {
    const small = graphBounds(grow(2));
    const large = graphBounds(grow(12));
    expect(large.radius).toBeGreaterThan(small.radius);
    for (const v of [...large.center, large.radius]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('children taper', () => {
  it('narrows with depth so breadth-first clicking still reaches deep', () => {
    expect(childrenAtDepth(0)).toBe(8);
    expect(childrenAtDepth(4)).toBeLessThan(childrenAtDepth(0));
    expect(childrenAtDepth(99)).toBeGreaterThan(0);
  });

  it('stays under the soft cap for a realistic exploration', () => {
    expect(grow(20).nodes.length).toBeLessThanOrEqual(SOFT_CAP);
  });
});
