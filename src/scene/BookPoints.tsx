import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import {
  computeRelationBuffer,
  computeStateBuffer,
  POINT_STATE,
} from '@/state/selectors';
import { hexToRgbTriple, type ThemeColors } from '@/domain/palette';
import {
  bookPointsFragmentShader,
  bookPointsVertexShader,
} from './bookPointsShader';

interface Props {
  theme: ThemeColors;
  onReady: (points: THREE.Points) => void;
}

/** The book point cloud.
 *
 *  This component subscribes to the store IMPERATIVELY rather than reactively.
 *  Hovering must not cause a React render inside the Canvas — routing hover
 *  through component state is what makes this kind of scene feel laggy. Instead
 *  a `useStore.subscribe` callback writes into the existing buffer attributes and
 *  flips `needsUpdate`, which at a few thousand points costs microseconds. */
export function BookPoints({ theme, onReady }: Props): React.ReactElement {
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  const books = useStore((s) => s.books);
  const positions = useStore((s) => s.positions);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const count = books.length;

    // A mild size variation keyed to how much a book actually has to say, so
    // the cloud does not read as perfectly uniform noise. Books with little
    // distinguishing signal render slightly smaller rather than overclaiming.
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const subjectCount = (books[i]?.subjects.length ?? 2);
      sizes[i] = 5.5 + Math.min(subjectCount, 5) * 0.55;
    }
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const indices = new Float32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    geo.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));

    const state = new Float32Array(count).fill(POINT_STATE.normal);
    const stateAttr = new THREE.BufferAttribute(state, 1);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', stateAttr);

    const relation = new Float32Array(count);
    const relationAttr = new THREE.BufferAttribute(relation, 1);
    relationAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRelation', relationAttr);

    geo.computeBoundingSphere();
    return geo;
  }, [books, positions]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: bookPointsVertexShader,
        fragmentShader: bookPointsFragmentShader,
        transparent: true,
        // Unsorted alpha-blended points look correct on a plain field and this
        // avoids depth-sort artifacts entirely.
        depthWrite: false,
        uniforms: {
          uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
          uSizeScale: { value: 1 },
          uAttenuation: { value: 260 },
          uFocusIndex: { value: -1 },
          uResting: { value: new THREE.Color(...hexToRgbTriple(theme.pointResting)) },
          uDim: { value: new THREE.Color(...hexToRgbTriple(theme.pointDim)) },
          uSameAuthor: { value: new THREE.Color(...hexToRgbTriple(theme.sameAuthor)) },
          uSameSubject: { value: new THREE.Color(...hexToRgbTriple(theme.sameSubject)) },
          uFocusColor: { value: new THREE.Color(...hexToRgbTriple(theme.focus)) },
          uDimAlpha: { value: theme.pointDimAlpha },
        },
      }),
    // Theme changes rebuild the material; that happens on a theme toggle only.
    [gl, theme],
  );

  useEffect(() => {
    const points = pointsRef.current;
    if (points) onReady(points);
  }, [onReady]);

  // Imperative subscription: recompute the two mutable attributes whenever the
  // relevant slices of state change, without re-rendering this component.
  useEffect(() => {
    const geo = geometry;
    const stateAttr = geo.getAttribute('aState') as THREE.BufferAttribute;
    const relationAttr = geo.getAttribute('aRelation') as THREE.BufferAttribute;
    const stateArray = stateAttr.array as Float32Array;
    const relationArray = relationAttr.array as Float32Array;

    let lastHovered: string | null | undefined;
    let lastMatched: Set<string> | null | undefined;
    let lastBranch: string | null | undefined;
    let lastSelected: string | null | undefined;

    const apply = (s: ReturnType<typeof useStore.getState>): void => {
      if (s.matchedIds !== lastMatched || s.activeBranchId !== lastBranch) {
        lastMatched = s.matchedIds;
        lastBranch = s.activeBranchId;
        computeStateBuffer(
          {
            books: s.books,
            matchedIds: s.matchedIds,
            branchMembers: s.activeBranchId
              ? (s.taxonomy.membersOf.get(s.activeBranchId) ?? new Set())
              : null,
          },
          stateArray,
        );
        stateAttr.needsUpdate = true;
      }

      if (s.hoveredId !== lastHovered) {
        lastHovered = s.hoveredId;
        computeRelationBuffer(s.books, s.hoveredId, s.tagMap, s.taxonomy, relationArray);
        relationAttr.needsUpdate = true;
      }

      const focusId = s.hoveredId ?? s.selectedId;
      if (focusId !== lastSelected) {
        lastSelected = focusId;
        const idx = focusId !== null ? (s.byId.get(focusId) ?? -1) : -1;
        material.uniforms.uFocusIndex!.value = idx;
      }
    };

    apply(useStore.getState());
    return useStore.subscribe(apply);
  }, [geometry, material]);

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
