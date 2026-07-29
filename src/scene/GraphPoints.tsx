import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import { EDGE_LEN, MAX_NODES, tierOf } from '@/domain/graph';
import { hexToRgbTriple, type ThemeColors } from '@/domain/palette';
import { prefersReducedMotion, spawnOriginFor } from './motion';
import {
  graphPointsFragmentShader,
  graphPointsVertexShader,
} from './graphPointsShader';

const SPAWN_MS = 520;
/** Per-child delay so a fan unfurls in similarity order — the best match arrives
 *  first, which is a second, free encoding of rank. */
const STAGGER_MS = 45;

interface Props {
  theme: ThemeColors;
  onReady: (points: THREE.Points) => void;
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
export function GraphPoints({ theme, onReady }: Props): React.ReactElement {
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  /** Animation state, deliberately outside React and outside the store: it
   *  changes every frame and nothing may re-render because of it. */
  const anim = useRef({
    target: new Float32Array(MAX_NODES * 3),
    spawn: new Float32Array(MAX_NODES * 3),
    startAt: new Float32Array(MAX_NODES),
    count: 0,
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
    const positions = positionAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;
    const tiers = tierAttr.array as Float32Array;

    let lastRevision = -1;
    let lastFocus: string | null | undefined;

    const apply = (s: ReturnType<typeof useStore.getState>): void => {
      if (s.revision !== lastRevision) {
        lastRevision = s.revision;
        const nodes = s.graph.nodes;
        const count = Math.min(nodes.length, MAX_NODES);
        const a = anim.current;
        const now = performance.now();
        const reduced = prefersReducedMotion();

        for (let i = 0; i < count; i++) {
          const node = nodes[i]!;
          const isNew = i >= a.count;

          a.target[i * 3] = node.target[0];
          a.target[i * 3 + 1] = node.target[1];
          a.target[i * 3 + 2] = node.target[2];

          if (isNew) {
            const parent = node.parentIndex === null ? null : nodes[node.parentIndex];
            // Under reduced motion this is the node's own target, not the
            // parent's — the tween below is skipped entirely, so a spawn origin
            // that is not already the destination would strand the node there.
            const from = spawnOriginFor(node.target, parent?.target ?? null, reduced);
            a.spawn[i * 3] = from[0];
            a.spawn[i * 3 + 1] = from[1];
            a.spawn[i * 3 + 2] = from[2];
            a.startAt[i] = reduced ? -Infinity : now + (i - a.count) * STAGGER_MS;
            positions[i * 3] = from[0];
            positions[i * 3 + 1] = from[1];
            positions[i * 3 + 2] = from[2];
          }

          sizes[i] = node.generation === 0 ? 13 : Math.max(6, 11 - node.generation * 1.1);
          tiers[i] = tierOf(node);
        }

        a.count = count;
        a.until = reduced ? 0 : now + SPAWN_MS + count * STAGGER_MS;

        geometry.setDrawRange(0, count);
        positionAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
        tierAttr.needsUpdate = true;
        commitBounds(count);
      }

      const focusId = s.hoveredId ?? s.selectedId;
      if (focusId !== lastFocus) {
        lastFocus = focusId;
        const slot = focusId ? (s.graph.indexOf.get(focusId) ?? -1) : -1;
        material.uniforms.uFocusIndex!.value = slot;
      }
    };

    apply(useStore.getState());
    return useStore.subscribe(apply);
  }, [geometry, material, commitBounds]);

  useFrame(() => {
    const a = anim.current;
    const now = performance.now();
    if (now > a.until || a.count === 0) return;

    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = positionAttr.array as Float32Array;

    for (let i = 0; i < a.count; i++) {
      const t = Math.min(1, Math.max(0, (now - (a.startAt[i] as number)) / SPAWN_MS));
      const e = 1 - (1 - t) ** 3;
      for (let d = 0; d < 3; d++) {
        const from = a.spawn[i * 3 + d] as number;
        const to = a.target[i * 3 + d] as number;
        positions[i * 3 + d] = from + (to - from) * e;
      }
    }
    positionAttr.needsUpdate = true;
    commitBounds(a.count);
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  );
}
