import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import { EDGE_LEN, asSlot } from '@/domain/graph';

/** How long a rollover survives the cursor leaving its node.
 *
 *  The card is offset from the cursor, so reaching the buy button inside it means
 *  crossing empty canvas. Clearing the hover the instant the raycast misses made
 *  the card impossible to reach: it vanished in the gap. Long enough to cross,
 *  short enough that it does not feel stuck. */
const HOVER_GRACE_MS = 200;

/** Hover picking for the graph nodes.
 *
 *  Not R3F's `onPointerMove`: that raycasts the whole scene on every native
 *  pointer event and allocates an intersections array each time. Here one canvas
 *  listener writes NDC into a ref, and the raycast runs at most every other frame,
 *  skipped entirely while the camera is being dragged. */
export function usePointPicking(points: THREE.Points | null, enabled: boolean): void {
  const { camera, gl } = useThree();
  const ndc = useRef({ x: 0, y: 0, inside: false });
  const dragging = useRef(false);
  const frame = useRef(0);

  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    // A fixed world-space threshold, derived from the edge length rather than
    // from any global cloud radius — there is no global cloud any more.
    r.params.Points = { threshold: EDGE_LEN * 0.075 };
    return r;
  }, []);

  /** Pending grace timer, so a new hit can cancel it. */
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoverOut = useCallback((): void => {
    if (clearTimer.current !== null) return;
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null;
      // `setHovered` itself refuses to clear while the pointer is inside the
      // card, so this stays correct even if the timer wins the race.
      useStore.getState().setHovered(null);
    }, HOVER_GRACE_MS);
  }, []);

  const hoverIn = useCallback((id: string | null): void => {
    if (clearTimer.current !== null) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    useStore.getState().setHovered(id);
  }, []);

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
      // Grace rather than an immediate clear: moving onto the rollover card fires
      // this very event, and clearing here is what used to make the card
      // unreachable.
      hoverOut();
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
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    };
  }, [gl, hoverOut]);

  useFrame(() => {
    if (!enabled || !points) return;
    frame.current += 1;
    if (frame.current % 2 !== 0) return;
    if (dragging.current || !ndc.current.inside) return;

    raycaster.setFromCamera(new THREE.Vector2(ndc.current.x, ndc.current.y), camera);
    const hits = raycaster.intersectObject(points, false);

    const state = useStore.getState();
    const index = hits[0]?.index;
    if (index === undefined) {
      hoverOut();
      return;
    }

    // The vertex index IS the graph slot. It is emphatically NOT a corpus index —
    // conflating the two is what made the previous version hover the wrong book
    // the moment the scene stopped showing every book in corpus order.
    const node = state.graph.nodes[asSlot(index)];
    if (node) hoverIn(node.bookId);
    else hoverOut();
  });
}

/** Click to select, and click again to grow. Shares the hover result, so a click
 *  always acts on exactly what the ring is showing. */
export function useClickToExpand(enabled: boolean): void {
  const { gl } = useThree();

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    let downAt = { x: 0, y: 0, t: 0 };

    const onDown = (e: PointerEvent): void => {
      downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const onUp = (e: PointerEvent): void => {
      // Ignore orbit gestures.
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      if (Date.now() - downAt.t > 600) return;

      const state = useStore.getState();
      const id = state.hoveredId;
      if (!id) return;

      const slot = state.graph.indexOf.get(id);
      state.select(id);
      if (slot === undefined) return;

      const node = state.graph.nodes[slot];
      if (!node) return;
      // Clicking an unopened node grows from it; clicking an opened one again
      // folds it back up, so the map can shrink as well as grow. The seed is
      // exempt — collapsing it leaves a lone point, which is what Start over is
      // for, and it would make the whole map vanish on a stray click.
      if (!node.expanded) state.expand(asSlot(slot));
      else if (node.generation > 0) state.collapse(asSlot(slot));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [enabled, gl]);
}
