import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore, slotOf } from '@/state/store';
import { MAX_AXES, type BranchAxis } from '@/domain/branch';
import { asSlot, type Slot } from '@/domain/graph';
import { ARC_RADIUS, placeHover } from './hoverPlacement';

/** The ways to grow the hovered node, as a band of buttons around it.
 *
 *  Clicking a node used to grow it along whichever axis happened to come first.
 *  The choice was real — a book can open onto similar titles, its author, or its
 *  subjects — but it was made silently and invisibly, and the reader had no way
 *  to know another answer existed. The chooser has always been in the outline
 *  panel; this puts it on the surface people actually use.
 *
 *  POOLED, like `NodeLabels`. React renders `MAX_AXES` buttons exactly once and
 *  a rAF loop re-targets them: label, position, visibility and the pending
 *  expansion are all written imperatively. Rendering a button per hovered node
 *  would put the reconciler back on the hover path, which is the one thing this
 *  overlay layer is built to avoid.
 *
 *  `axesFor` never returns an axis with nothing behind it, and never returns
 *  more than `MAX_AXES`, so the pool is exact: the band shows one, two or three
 *  segments and every one of them leads somewhere. Over half the books have no
 *  author with other work in this corpus, so two is the common case rather than
 *  the exception. */
/** Opacity alone would leave the segments clickable while invisible, sitting in
 *  front of the nodes they were last drawn around. */
function hide(container: HTMLElement): void {
  container.style.opacity = '0';
  container.style.visibility = 'hidden';
}

export function NodeArc({
  cameraRef,
  pointsRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pool] = useState(() => Array.from({ length: MAX_AXES }, (_, i) => i));

  /** What each button will do if pressed. Read by the click handler, written by
   *  the frame loop, so the two never disagree about which node is under the
   *  cursor. */
  const pending = useRef<Array<{ slot: Slot; axis: string } | null>>(
    Array.from({ length: MAX_AXES }, () => null),
  );

  useEffect(() => {
    let raf = 0;
    const vec = new THREE.Vector3();
    let lastKey = '';
    let axes: BranchAxis[] = [];
    /** Set for the one frame after the hovered node changes: the frame that has
     *  to rewrite text and reveal the band, rather than only move it. */
    let relabel = false;
    let shown = false;
    let canvasEl: HTMLCanvasElement | null = null;

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const container = containerRef.current;
      const camera = cameraRef.current;
      const points = pointsRef.current;
      if (!container || !camera || !points) return;

      const state = useStore.getState();
      const hovered = state.hoveredRef;
      const slot = hovered ? slotOf(state, hovered) : null;
      const node = slot === null ? undefined : state.graph.nodes[slot];

      // Recomputed only when the node under the cursor changes, or the graph
      // does. `axesFor` walks the graph index and allocates, and this loop runs
      // every frame of every orbit — asking it 60 times a second for an answer
      // that changes on a click is the kind of waste that only shows up on a
      // slower machine than this one.
      const key = `${hovered ?? ''}:${state.revision}`;
      if (key !== lastKey) {
        lastKey = key;
        // An expanded node has already made this choice; clicking it folds it
        // back up, and offering a chooser over the top of that would describe an
        // action the click no longer performs.
        axes = node && !node.expanded && slot !== null ? state.axesFor(slot) : [];
        relabel = true;
      }

      if (axes.length === 0 || slot === null) {
        if (shown) {
          shown = false;
          hide(container);
          pending.current.fill(null);
        }
        return;
      }

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

      // Behind the camera: the projection wraps around and the band would draw
      // on the opposite side of the screen from the node it belongs to.
      if (vec.z > 1) {
        if (shown) {
          shown = false;
          hide(container);
        }
        return;
      }

      const x = (vec.x * 0.5 + 0.5) * rect.width;
      const y = (-vec.y * 0.5 + 0.5) * rect.height;
      const { arcAngles } = placeHover({
        x,
        y,
        width: rect.width,
        height: rect.height,
        segments: axes.length,
      });

      // Text is written only on the frame the node changed. Assigning
      // `textContent` every frame would force a style recalculation through an
      // entire orbit for a string that has not changed.
      if (relabel || !shown) {
        shown = true;
        container.style.opacity = '1';
        container.style.visibility = 'visible';
      }

      const elements = container.children;
      for (let i = 0; i < MAX_AXES; i++) {
        const el = elements[i] as HTMLElement | undefined;
        if (!el) continue;
        const axis = axes[i];
        if (!axis) {
          el.style.display = 'none';
          pending.current[i] = null;
          continue;
        }
        if (relabel) {
          el.style.display = '';
          el.textContent = axis.count > 1 ? `${axis.label} · ${axis.count}` : axis.label;
          pending.current[i] = { slot: asSlot(slot), axis: axis.id };
        }
        const angle = arcAngles[i] as number;
        el.style.transform =
          `translate3d(${x + ARC_RADIUS * Math.cos(angle)}px, ` +
          `${y - ARC_RADIUS * Math.sin(angle)}px, 0) translate(-50%, -50%)`;
      }
      relabel = false;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, pointsRef]);

  return (
    // `aria-hidden` with unfocusable buttons, matching the rollover card. The
    // canvas is `role="img"` and the outline panel is the real interface: it
    // renders the SAME axes through `BranchMenu` as focusable DOM, so nothing
    // here is the only route to anything. An aria-hidden subtree must not
    // contain focusable nodes, which is why these are not tabbable.
    <div className="node-arc" ref={containerRef} aria-hidden="true">
      {pool.map((i) => (
        <button
          key={i}
          type="button"
          className="node-arc__seg"
          tabIndex={-1}
          style={{ display: 'none' }}
          // On the buttons rather than on the container: the container spans the
          // whole stage and must stay `pointer-events: none`, so it never
          // becomes an event target. Reaching a segment means crossing empty
          // canvas, where the raycast misses and the hover would otherwise clear
          // out from under the cursor — the same lock the rollover card uses.
          onPointerEnter={() => useStore.getState().lockHover(true)}
          onPointerLeave={() => useStore.getState().lockHover(false)}
          onClick={() => {
            const next = pending.current[i];
            if (!next) return;
            const store = useStore.getState();
            // Released before expanding: the band is about to be replaced by the
            // branch it grew, and a lock left on would pin the hover to a node
            // that has just stopped offering anything.
            store.lockHover(false);
            store.expand(next.slot, next.axis);
          }}
        />
      ))}
    </div>
  );
}
