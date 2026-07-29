import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import { MAX_NODES, type EdgeKind } from '@/domain/graph';
import type { ThemeColors } from '@/domain/palette';

const MAX_EDGES = MAX_NODES * 2;

/** Connections between a book and the books grown from it.
 *
 *  One `LineSegments` over a preallocated buffer rather than a component per
 *  edge. The deciding reason is not the draw-call count: it is that edges have to
 *  move with the nodes during the spawn animation, so both endpoints of every
 *  edge touching a moving node are rewritten each frame. Here that is one pass
 *  over a flat array with no allocation; with a component per edge it would be
 *  hundreds of refs rebuilding geometry every frame.
 *
 *  Trade accepted: `LineBasicMaterial` ignores `linewidth > 1` on essentially all
 *  platforms, so these are hairlines. At this density that is the right look
 *  anyway — heavier edges read as clutter. */
export function GraphEdges({
  theme,
  pointsRef,
}: {
  theme: ThemeColors;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  const growthSlots = useRef<Array<[number, number]>>([]);
  const crossSlots = useRef<Array<[number, number]>>([]);

  const makeGeometry = (): THREE.BufferGeometry => {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 2 * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    // Never culled — same reasoning as the points: the bounding volume would go
    // stale as the graph grows and the edges would vanish.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return geo;
  };

  const growthGeo = useMemo(makeGeometry, []);
  const crossGeo = useMemo(makeGeometry, []);

  // Two materials rather than one, which is what buys the distinction: a single
  // LineBasicMaterial cannot vary opacity per segment without vertex colours,
  // and this is still only two draw calls.
  const growthMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(theme.focus),
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    [theme],
  );

  const crossMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(theme.focus),
        transparent: true,
        // Faint enough to read as texture rather than structure. These say "also
        // related", and at two hundred books there are enough of them to bury
        // the branching if drawn at the same weight.
        opacity: 0.07,
        depthWrite: false,
      }),
    [theme],
  );

  useEffect(() => {
    let lastRevision = -1;
    const collect = (
      s: ReturnType<typeof useStore.getState>,
      kind: EdgeKind,
    ): Array<[number, number]> =>
      s.graph.edges
        .filter((e) => e.kind === kind)
        .slice(0, MAX_EDGES)
        .map((e) => [e.from, e.to] as [number, number]);

    const apply = (s: ReturnType<typeof useStore.getState>): void => {
      if (s.revision === lastRevision) return;
      lastRevision = s.revision;
      growthSlots.current = collect(s, 'growth');
      crossSlots.current = collect(s, 'cross');
      growthGeo.setDrawRange(0, growthSlots.current.length * 2);
      crossGeo.setDrawRange(0, crossSlots.current.length * 2);
    };
    apply(useStore.getState());
    return useStore.subscribe(apply);
  }, [growthGeo, crossGeo]);

  useFrame(() => {
    const points = pointsRef.current;
    if (!points) return;
    const src = points.geometry.getAttribute('position').array as Float32Array;

    const write = (geo: THREE.BufferGeometry, edges: Array<[number, number]>): void => {
      if (edges.length === 0) return;
      const attr = geo.getAttribute('position') as THREE.BufferAttribute;
      const dst = attr.array as Float32Array;
      for (let e = 0; e < edges.length; e++) {
        const [a, b] = edges[e] as [number, number];
        for (let d = 0; d < 3; d++) {
          dst[e * 6 + d] = src[a * 3 + d] as number;
          dst[e * 6 + 3 + d] = src[b * 3 + d] as number;
        }
      }
      attr.needsUpdate = true;
    };

    write(growthGeo, growthSlots.current);
    write(crossGeo, crossSlots.current);
  });

  return (
    <>
      {/* Cross links first, so growth edges draw over them. */}
      <lineSegments geometry={crossGeo} material={crossMat} frustumCulled={false} />
      <lineSegments geometry={growthGeo} material={growthMat} frustumCulled={false} />
    </>
  );
}
