import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/state/store';

/** Hover picking for the point cloud.
 *
 *  Deliberately NOT R3F's `onPointerMove` on the Points object: R3F's event
 *  system raycasts on every native pointer event and allocates an intersections
 *  array each time. Here a single canvas listener writes NDC coordinates into a
 *  ref (no React state), and the raycast runs at most every other frame inside
 *  `useFrame`, skipped entirely while the camera is being dragged.
 *
 *  `Points` raycasting is a per-vertex distance-to-ray test, so a few thousand
 *  of those every other frame is well under a millisecond. GPU picking would be
 *  the move past ~50k points, but `readPixels` stalls the pipeline every frame,
 *  so it is a real trade rather than a free upgrade. */
export function usePointPicking(
  points: THREE.Points | null,
  enabled: boolean,
  radius: number,
): void {
  const { camera, gl } = useThree();
  const ndc = useRef<{ x: number; y: number; inside: boolean }>({
    x: 0,
    y: 0,
    inside: false,
  });
  const dragging = useRef(false);
  const frame = useRef(0);

  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    // World units. Combined with size attenuation this gives a hit radius that
    // tracks apparent size, so near points are easier to hit — which is correct.
    r.params.Points = { threshold: radius * 0.012 };
    return r;
  }, [radius]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      ndc.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      ndc.current.inside = true;
    };
    const onLeave = (): void => {
      ndc.current.inside = false;
      useStore.getState().setHovered(null);
    };
    const onDown = (): void => {
      dragging.current = true;
    };
    const onUp = (): void => {
      dragging.current = false;
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl]);

  useFrame(() => {
    if (!enabled || !points) return;
    frame.current += 1;
    if (frame.current % 2 !== 0) return;
    if (dragging.current || !ndc.current.inside) return;

    raycaster.setFromCamera(
      new THREE.Vector2(ndc.current.x, ndc.current.y),
      camera,
    );
    const hits = raycaster.intersectObject(points, false);

    const state = useStore.getState();
    if (hits.length === 0) {
      state.setHovered(null);
      return;
    }

    // Prefer the nearest hit that is not dimmed out by the current filter —
    // hovering something the user has filtered away would be confusing.
    const stateAttr = points.geometry.getAttribute('aState');
    let chosen: number | null = null;
    for (const hit of hits) {
      const index = hit.index;
      if (index === undefined) continue;
      if (stateAttr && stateAttr.getX(index) < 0.5) continue;
      chosen = index;
      break;
    }
    if (chosen === null) {
      state.setHovered(null);
      return;
    }

    state.setHovered(state.books[chosen]?.id ?? null);
  });
}

/** Click-to-select, sharing the same hover result so a click always selects
 *  exactly what the ring is showing. */
export function useClickToSelect(enabled: boolean): void {
  const { gl } = useThree();

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    let downAt = { x: 0, y: 0, t: 0 };

    const onDown = (e: PointerEvent): void => {
      downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const onUp = (e: PointerEvent): void => {
      // Ignore drags — an orbit gesture should not select.
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      if (moved > 5 || Date.now() - downAt.t > 600) return;
      const { hoveredId, select } = useStore.getState();
      select(hoveredId ?? null, { fly: hoveredId !== null });
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [enabled, gl]);
}
