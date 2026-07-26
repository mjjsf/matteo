import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, positionOf } from '@/state/store';
import type { ThemeColors } from '@/domain/palette';

/** A single reused ring marking the hovered or selected point.
 *
 *  One object whose position is written imperatively in `useFrame`, hidden when
 *  nothing is active. Never re-uploads the point buffer to highlight one point,
 *  and allocates nothing per hover. */
export function HighlightRing({
  radius,
  theme,
}: {
  radius: number;
  theme: ThemeColors;
}): React.ReactElement {
  const selectedRef = useRef<THREE.Mesh>(null);
  const hoveredRef = useRef<THREE.Mesh>(null);

  const ringGeometry = useMemo(
    () => new THREE.RingGeometry(radius * 0.016, radius * 0.021, 40),
    [radius],
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

    const place = (mesh: THREE.Mesh | null, id: string | null): void => {
      if (!mesh) return;
      if (!id) {
        mesh.visible = false;
        return;
      }
      const p = positionOf(state, id);
      if (!p) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(p[0], p[1], p[2]);
      // Billboard the ring so it always reads as a circle.
      mesh.quaternion.copy(camera.quaternion);
    };

    place(selectedRef.current, state.selectedId);
    place(
      hoveredRef.current,
      state.hoveredId && state.hoveredId !== state.selectedId ? state.hoveredId : null,
    );
  });

  return (
    <>
      <mesh ref={selectedRef} geometry={ringGeometry} material={selectedMaterial} visible={false} />
      <mesh ref={hoveredRef} geometry={ringGeometry} material={hoveredMaterial} visible={false} />
    </>
  );
}
