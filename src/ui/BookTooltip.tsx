import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore, positionOf } from '@/state/store';
import { formatYear } from './ResultList';

/** Label for the hovered point, as an HTML overlay rather than 3D text.
 *
 *  Crisper text, real CSS, real text selection, and zero draw calls. The
 *  position is projected in a rAF loop and written straight to the DOM node via
 *  ref, so hovering never triggers a React render. drei's <Html> would mount a
 *  portal per instance, which is far more than one tooltip needs.
 *
 *  This label is also load-bearing for accessibility: it is part of the relief
 *  channel that makes the sub-3:1 light-mode orange legal. */
export function BookTooltip({
  cameraRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const vec = new THREE.Vector3();
    let lastId: string | null | undefined;

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const camera = cameraRef.current;
      if (!el || !camera) return;

      const state = useStore.getState();
      const id = state.hoveredId ?? state.selectedId;

      if (!id) {
        if (lastId !== null) {
          el.style.opacity = '0';
          lastId = null;
        }
        return;
      }

      if (id !== lastId) {
        lastId = id;
        const idx = state.byId.get(id);
        const book = idx !== undefined ? state.books[idx] : undefined;
        if (book && titleRef.current && metaRef.current) {
          titleRef.current.textContent = book.title;
          metaRef.current.textContent = `${book.authors.join(', ')} · ${formatYear(book.year)}`;
        }
        el.style.opacity = '1';
      }

      const p = positionOf(state, id);
      if (!p) return;
      vec.set(p[0], p[1], p[2]).project(camera);
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (vec.x * 0.5 + 0.5) * rect.width;
      const y = (-vec.y * 0.5 + 0.5) * rect.height;
      // Behind the camera: hide rather than drawing at a nonsense position.
      el.style.opacity = vec.z > 1 ? '0' : '1';
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef]);

  return (
    <div className="tooltip" ref={ref} aria-hidden="true">
      <span className="tooltip__title" ref={titleRef} />
      <span className="tooltip__meta" ref={metaRef} />
    </div>
  );
}
