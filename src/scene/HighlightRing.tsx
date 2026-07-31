import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, slotOf } from '@/state/store';
import { EDGE_LEN } from '@/domain/graph';
import type { ThemeColors } from '@/domain/palette';
import type { NodeRef } from '@/domain/nodeRef';

/** A single reused ring marking the hovered or selected node.
 *
 *  One object whose position is written imperatively in `useFrame`, hidden when
 *  nothing is active. Never re-uploads the point buffer to highlight one point,
 *  and allocates nothing per hover.
 *
 *  Reads the LIVE position buffer rather than `node.target`, so the ring travels
 *  with a node while it is still easing out of its parent instead of waiting at
 *  the destination. */
export function HighlightRing({
  theme,
  pointsRef,
}: {
  theme: ThemeColors;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  const selectedRef = useRef<THREE.Mesh>(null);
  const hoveredRef = useRef<THREE.Mesh>(null);

  // Sized to sit clearly outside a node, not to swallow it.
  //
  // Point size here is 1/distance, so a node's APPARENT size is constant in world
  // terms: the seed works out at ~0.55 units across, generation-one children at
  // ~0.42. The inner radius therefore has to clear 0.275 with visible daylight —
  // at 0.36 the ring hugged the seed so closely that, both being drawn in the
  // focus ink, the selection was invisible on the one node that starts selected.
  const ringGeometry = useMemo(
    () => new THREE.RingGeometry(EDGE_LEN * 0.05, EDGE_LEN * 0.062, 40),
    [],
  );

  const selectedMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(theme.focus),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    [theme.focus],
  );

  const hoveredMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(theme.focus),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    [theme.focus],
  );

  useFrame(({ camera }) => {
    const state = useStore.getState();
    const positions = pointsRef.current?.geometry.getAttribute('position').array as
      | Float32Array
      | undefined;

    const place = (mesh: THREE.Mesh | null, ref: NodeRef | null): void => {
      if (!mesh) return;
      const slot = ref ? slotOf(state, ref) : null;
      if (slot === null || !positions) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(
        positions[slot * 3] as number,
        positions[slot * 3 + 1] as number,
        positions[slot * 3 + 2] as number,
      );
      // Billboard the ring so it always reads as a circle.
      mesh.quaternion.copy(camera.quaternion);
    };

    place(selectedRef.current, state.selectedRef);
    place(
      hoveredRef.current,
      state.hoveredRef && state.hoveredRef !== state.selectedRef ? state.hoveredRef : null,
    );
  });

  return (
    <>
      <mesh ref={selectedRef} geometry={ringGeometry} material={selectedMaterial} visible={false} />
      <mesh ref={hoveredRef} geometry={ringGeometry} material={hoveredMaterial} visible={false} />
    </>
  );
}
