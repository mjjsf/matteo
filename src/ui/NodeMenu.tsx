import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore, slotOf } from '@/state/store';
import { asSlot } from '@/domain/graph';
import { BranchMenu } from './BranchMenu';
import { placeHover } from './hoverPlacement';

/** The ways to grow the node you clicked, as one rectangular menu beside it.
 *
 *  This replaces an arc of pooled buttons that appeared on HOVER. All of that
 *  machinery — three DOM nodes rendered once and re-targeted every frame, labels
 *  written imperatively, angles computed on a circle — existed for one reason:
 *  to keep React off the hover path, which is the invariant the whole overlay
 *  layer is built on.
 *
 *  On click that constraint is simply gone. A click is a discrete event, so the
 *  menu can be an ordinary component that renders once when it opens. Which
 *  means it can be `BranchMenu` — the same component the outline and the detail
 *  panel already use, rather than a third rendering of the same list that has to
 *  be kept in step with the other two by hand.
 *
 *  What stays imperative is POSITION only: a rAF loop writes `transform` so the
 *  menu tracks its node while the camera moves. Rendering that through React
 *  would put the reconciler back on the frame loop for no benefit. */
export function NodeMenu({
  cameraRef,
  pointsRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useStore((s) => s.menuRef);
  const openMenu = useStore((s) => s.openMenu);
  // Subscribed rather than read once: `collapseNode` compacts the node array, so
  // the slot a ref resolves to changes under it whenever the graph does.
  const slot = useStore((s) => (s.menuRef ? slotOf(s, s.menuRef) : null));

  useEffect(() => {
    if (!menuRef) return;
    let raf = 0;
    const vec = new THREE.Vector3();
    let canvasEl: HTMLCanvasElement | null = null;

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = containerRef.current;
      const camera = cameraRef.current;
      const points = pointsRef.current;
      if (!el || !camera || !points) return;

      const state = useStore.getState();
      const slot = slotOf(state, menuRef);
      if (slot === null) return;

      const positions = points.geometry.getAttribute('position').array as Float32Array;
      vec
        .set(
          positions[slot * 3] as number,
          positions[slot * 3 + 1] as number,
          positions[slot * 3 + 2] as number,
        )
        .project(camera);

      if (!canvasEl) canvasEl = document.querySelector('canvas');
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();

      // Behind the camera: the projection wraps around and the menu would draw on
      // the opposite side of the screen from the node it belongs to.
      if (vec.z > 1) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';

      const x = (vec.x * 0.5 + 0.5) * rect.width;
      const y = (-vec.y * 0.5 + 0.5) * rect.height;
      const { menuLeft, menuAbove, menuOffsetX, menuOffsetY } = placeHover({
        x,
        y,
        width: rect.width,
        height: rect.height,
        hasMenu: true,
      });
      el.style.transform =
        `translate3d(${x}px, ${y}px, 0) ` +
        `translate(${menuLeft ? '-100%' : '0'}, ${menuAbove ? '-100%' : '0'}) ` +
        `translate(${menuLeft ? -menuOffsetX : menuOffsetX}px, ` +
        `${menuAbove ? -menuOffsetY : menuOffsetY}px)`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [menuRef, cameraRef, pointsRef]);

  if (!menuRef || slot === null) return null;

  return (
    // Not `aria-hidden`, unlike the rollover card. That card is pointer-only
    // decoration over a `role="img"` canvas; this is a menu a person opened with
    // a deliberate click, so it is real, focusable DOM and announces itself.
    <div className="node-menu" ref={containerRef} role="group" aria-label="Ways to grow this">
      <BranchMenu slot={asSlot(slot)} onPick={() => openMenu(null)} />
    </div>
  );
}
