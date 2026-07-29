import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore, bookById, slotOf } from '@/state/store';
import { formatYear } from './format';

/** Rollover card for the node under the cursor: title, byline, and the
 *  description the brief asks for.
 *
 *  An HTML overlay rather than 3D text — crisper, real CSS, real text wrapping,
 *  zero draw calls. The position is projected in a rAF loop and written straight
 *  to the DOM node via ref, so hovering never triggers a React render. drei's
 *  `<Html>` would mount a portal per instance, which is far more than one card
 *  needs.
 *
 *  This card is also load-bearing for accessibility: it is part of the relief
 *  channel that makes the sub-3:1 light-mode orange legal. */
export function BookTooltip({
  cameraRef,
  pointsRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);
  const descRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const vec = new THREE.Vector3();
    let lastId: string | null | undefined;
    let canvasEl: HTMLCanvasElement | null = null;

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const camera = cameraRef.current;
      const points = pointsRef.current;
      if (!el || !camera || !points) return;

      const state = useStore.getState();
      // Hover only. Selection has the detail panel, and pinning a card over the
      // graph after every click would sit on top of the thing just grown.
      const id = state.hoveredId;

      if (!id) {
        if (lastId !== null) {
          el.style.opacity = '0';
          lastId = null;
        }
        return;
      }

      const slot = slotOf(state, id);
      if (slot === null) {
        el.style.opacity = '0';
        return;
      }

      if (id !== lastId) {
        lastId = id;
        const book = bookById(id);
        const node = state.graph.nodes[slot];
        if (book && titleRef.current && metaRef.current && descRef.current && hintRef.current) {
          titleRef.current.textContent = book.title;
          metaRef.current.textContent = `${book.authors.join(', ')} · ${formatYear(book.year)}`;
          descRef.current.textContent = book.description;
          hintRef.current.textContent = !node
            ? ''
            : node.expanded
              ? 'Click to open details'
              : node.expandable
                ? 'Click to grow similar books'
                : 'No further similar books';
        }
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
      const x = (vec.x * 0.5 + 0.5) * rect.width;
      const y = (-vec.y * 0.5 + 0.5) * rect.height;

      // Behind the camera: hide rather than drawing at a nonsense position.
      el.style.opacity = vec.z > 1 ? '0' : '1';
      // Flip the card to whichever side has room, so it never runs off the edge.
      const flipX = x > rect.width - 280;
      const flipY = y < 190;
      el.style.transform =
        `translate3d(${x}px, ${y}px, 0) ` +
        `translate(${flipX ? '-100%' : '0'}, ${flipY ? '0' : '-100%'}) ` +
        `translate(${flipX ? '-14px' : '14px'}, ${flipY ? '14px' : '-14px'})`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, pointsRef]);

  return (
    <div className="tooltip" ref={ref} aria-hidden="true">
      <span className="tooltip__title" ref={titleRef} />
      <span className="tooltip__meta" ref={metaRef} />
      <span className="tooltip__desc" ref={descRef} />
      <span className="tooltip__hint" ref={hintRef} />
    </div>
  );
}
