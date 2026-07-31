import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import { EDGE_LEN, MAX_NODES, tierOf, type EdgeKind } from '@/domain/graph';
import { kindOf, type NodeKind, type NodeRef } from '@/domain/nodeRef';
import { hexToRgbTriple, type ThemeColors } from '@/domain/palette';
import { prefersReducedMotion } from './motion';
import {
  SPAWN_MS,
  emptyTransitionState,
  planTransition,
  type TransitionState,
} from './transition';
import {
  graphPointsFragmentShader,
  graphPointsVertexShader,
} from './graphPointsShader';

/** Which mark a grain draws as. Topics and tags share one — both are subjects
 *  to a reader, and the grain distinction is a code concern. */
const MARK_OF: Record<NodeKind, number> = { book: 0, topic: 1, tag: 1, author: 2 };

interface Props {
  theme: ThemeColors;
  onReady: (points: THREE.Points) => void;
  transition: React.MutableRefObject<TransitionState>;
}

/** The book nodes.
 *
 *  Geometry is created ONCE at full capacity and never rebuilt — the previous
 *  version rebuilt it from a `useMemo([books, positions])`, which is fine when the
 *  data never changes and impossible when it grows every click.
 *
 *  Two mechanisms write to it and never overlap:
 *   - `useFrame` owns `position` (continuous, time-driven).
 *   - `useStore.subscribe` owns `aSize`/`aTier` (discrete, event-driven).
 *  Neither causes a React render, which is the invariant that keeps hovering and
 *  animation off the reconciler. */
export function GraphPoints({ theme, onReady, transition }: Props): React.ReactElement {
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  /** Animation state, deliberately outside React and outside the store: it
   *  changes every frame and nothing may re-render because of it.
   *
   *  `refs` and `parents` mirror the LAST revision's slot assignment. They are
   *  what lets a node be found by identity rather than by index, which is the
   *  whole basis of `planTransition` — `collapseNode` compacts the array, so a
   *  slot does not name the same node from one revision to the next. */
  const anim = useRef({
    target: new Float32Array(MAX_NODES * 3),
    spawn: new Float32Array(MAX_NODES * 3),
    startAt: new Float64Array(MAX_NODES),
    refs: [] as NodeRef[],
    parents: [] as Array<number | null>,
    edges: [] as Array<{ from: number; to: number; kind: EdgeKind }>,
    /** Slots on the map. */
    live: 0,
    /** Slots being drawn while they retreat, immediately after `live`. */
    ghosts: 0,
    until: 0,
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();

    // Zero-filled: unused slots must be finite or the bounding sphere goes NaN
    // and picking dies completely.
    const position = new THREE.BufferAttribute(new Float32Array(MAX_NODES * 3), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', position);

    const size = new THREE.BufferAttribute(new Float32Array(MAX_NODES), 1);
    size.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSize', size);

    const tier = new THREE.BufferAttribute(new Float32Array(MAX_NODES), 1);
    tier.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTier', tier);

    // Orthogonal to tier: a subject node is itself expandable or expanded.
    const kind = new THREE.BufferAttribute(new Float32Array(MAX_NODES), 1);
    kind.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aKind', kind);

    // Explicit index: three compiles ShaderMaterial as GLSL ES 1.00, where
    // gl_VertexID does not exist. Equals the node slot, so the focus test in the
    // vertex shader stays a plain comparison.
    const index = new Float32Array(MAX_NODES);
    for (let i = 0; i < MAX_NODES; i++) index[i] = i;
    geo.setAttribute('aIndex', new THREE.BufferAttribute(index, 1));

    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: graphPointsVertexShader,
        fragmentShader: graphPointsFragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
          // Derived from EDGE_LEN, not a bare number. The old cloud sat inside a
          // radius-50 sphere viewed from ~100 units away, where 300 was right;
          // dropped into a graph whose camera sits ~26 units out, that same
          // constant drew 300px blobs that swallowed the edges and the labels.
          // Tying it to the one length scale in the system means the marks stay
          // the same apparent size if EDGE_LEN ever changes.
          uAttenuation: { value: EDGE_LEN * 4.6 },
          uFocusIndex: { value: -1 },
          uSeed: { value: new THREE.Color(...hexToRgbTriple(theme.focus)) },
          uExpandable: { value: new THREE.Color(...hexToRgbTriple(theme.expandable)) },
          uExpanded: { value: new THREE.Color(...hexToRgbTriple(theme.expanded)) },
          uExhausted: { value: new THREE.Color(...hexToRgbTriple(theme.pointResting)) },
          uSubject: { value: new THREE.Color(...hexToRgbTriple(theme.subject)) },
        },
      }),
    [gl, theme],
  );

  useEffect(() => {
    if (pointsRef.current) onReady(pointsRef.current);
  }, [onReady]);

  /** Recompute the bounding sphere over the LIVE prefix.
   *
   *  Not `computeBoundingSphere()`: three's `Points.raycast` only computes the
   *  sphere when it is null, so once one exists it is never refreshed — a graph
   *  growing beyond it silently stops being hoverable, with no visual symptom at
   *  all because `frustumCulled` is off. It would also iterate all 400 slots
   *  including the unused ones. */
  const commitBounds = useMemo(() => {
    const positions = geometry.getAttribute('position').array as Float32Array;
    return (count: number): void => {
      const sphere = geometry.boundingSphere as THREE.Sphere;
      if (count === 0) {
        sphere.center.set(0, 0, 0);
        sphere.radius = 1;
        return;
      }
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < count; i++) {
        cx += positions[i * 3] as number;
        cy += positions[i * 3 + 1] as number;
        cz += positions[i * 3 + 2] as number;
      }
      cx /= count;
      cy /= count;
      cz /= count;
      let r2 = 0;
      for (let i = 0; i < count; i++) {
        const dx = (positions[i * 3] as number) - cx;
        const dy = (positions[i * 3 + 1] as number) - cy;
        const dz = (positions[i * 3 + 2] as number) - cz;
        r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
      }
      sphere.center.set(cx, cy, cz);
      sphere.radius = Math.sqrt(r2) + 1e-3;
    };
  }, [geometry]);

  // Topology changes: imperative, so the geometry is never rebuilt and no React
  // render is triggered inside the Canvas.
  useEffect(() => {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const tierAttr = geometry.getAttribute('aTier') as THREE.BufferAttribute;
    const kindAttr = geometry.getAttribute('aKind') as THREE.BufferAttribute;
    const positions = positionAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;
    const tiers = tierAttr.array as Float32Array;
    const kinds = kindAttr.array as Float32Array;

    let lastRevision = -1;
    let lastFocus: string | null | undefined;

    const apply = (s: ReturnType<typeof useStore.getState>): void => {
      if (s.revision !== lastRevision) {
        lastRevision = s.revision;
        const nodes = s.graph.nodes;
        const a = anim.current;
        const now = performance.now();
        const reduced = prefersReducedMotion();

        const plan = planTransition({
          prevRefs: a.refs,
          prevParents: a.parents,
          prevEdges: a.edges,
          nextNodes: nodes,
          rendered: positions,
          now,
          reduced,
        });

        // Ghost attributes are CARRIED, not recomputed: the nodes they describe
        // are gone from the graph, so there is nothing left to compute them
        // from. Read before the live writes below, since a ghost's old slot may
        // be one a survivor has just moved into.
        const carried = plan.ghostFrom.map((slot) => ({
          size: sizes[slot] as number,
          tier: tiers[slot] as number,
          kind: kinds[slot] as number,
        }));

        const total = plan.liveCount + plan.ghostCount;
        for (let i = 0; i < total; i++) {
          for (let d = 0; d < 3; d++) {
            a.spawn[i * 3 + d] = plan.from[i * 3 + d] as number;
            a.target[i * 3 + d] = plan.to[i * 3 + d] as number;
            // Written straight away rather than waiting for the next frame: a
            // slot whose node changed identity is showing the wrong node's
            // position until something writes over it.
            positions[i * 3 + d] = plan.from[i * 3 + d] as number;
          }
          a.startAt[i] = plan.startAt[i] as number;
        }

        for (let i = 0; i < plan.liveCount; i++) {
          const node = nodes[i]!;
          sizes[i] = node.generation === 0 ? 13 : Math.max(6, 11 - node.generation * 1.1);
          tiers[i] = tierOf(node);
          kinds[i] = MARK_OF[kindOf(node.nodeRef)];
        }
        carried.forEach((attrs, g) => {
          const slot = plan.liveCount + g;
          sizes[slot] = attrs.size;
          tiers[slot] = attrs.tier;
          kinds[slot] = attrs.kind;
        });

        a.live = plan.liveCount;
        a.ghosts = plan.ghostCount;
        a.until = plan.until;
        a.refs = nodes.slice(0, plan.liveCount).map((n) => n.nodeRef);
        a.parents = nodes.slice(0, plan.liveCount).map((n) => n.parentIndex);
        a.edges = s.graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
        transition.current.ghostEdges = plan.ghostEdges;

        geometry.setDrawRange(0, total);
        positionAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
        tierAttr.needsUpdate = true;
        kindAttr.needsUpdate = true;
        // Over the live nodes only. The bounding sphere is what the raycaster
        // culls against, so leaving retreating nodes out of it is also what
        // keeps them unhoverable.
        commitBounds(plan.liveCount);
      }

      const focusRef = s.hoveredRef ?? s.selectedRef;
      if (focusRef !== lastFocus) {
        lastFocus = focusRef;
        const slot = focusRef ? (s.graph.indexOf.get(focusRef) ?? -1) : -1;
        material.uniforms.uFocusIndex!.value = slot;
      }
    };

    apply(useStore.getState());
    return useStore.subscribe(apply);
  }, [geometry, material, commitBounds, transition]);

  useFrame(() => {
    const a = anim.current;
    const now = performance.now();

    if (now > a.until) {
      // The retreat has finished, so the slots holding it go back to being
      // unused. Done here rather than on a timer: the frame loop already knows
      // what time it is, and a timer could fire during a revision it knows
      // nothing about. Checked before the `live === 0` bail below, or an empty
      // map would leave its ghosts drawn for good.
      if (a.ghosts > 0) {
        a.ghosts = 0;
        geometry.setDrawRange(0, a.live);
        transition.current.ghostEdges = emptyTransitionState().ghostEdges;
      }
      return;
    }

    if (a.live + a.ghosts === 0) return;

    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = positionAttr.array as Float32Array;

    for (let i = 0; i < a.live + a.ghosts; i++) {
      const t = Math.min(1, Math.max(0, (now - (a.startAt[i] as number)) / SPAWN_MS));
      const e = 1 - (1 - t) ** 3;
      for (let d = 0; d < 3; d++) {
        const from = a.spawn[i * 3 + d] as number;
        const to = a.target[i * 3 + d] as number;
        positions[i * 3 + d] = from + (to - from) * e;
      }
    }
    positionAttr.needsUpdate = true;
    commitBounds(a.live);
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  );
}
