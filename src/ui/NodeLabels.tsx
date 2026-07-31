import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import { MAX_NODES } from '@/domain/graph';
import { idOf } from '@/domain/nodeRef';

/** How many titles are on screen at once.
 *
 *  The brief asks for a cloud of book TITLES, and the obvious reading is "label
 *  everything". Two hundred overlapping titles is not a cloud of titles, it is a
 *  grey smear you cannot read a single word of — so labels go to the nodes
 *  nearest the camera, and the rest stay as points you fly toward. That keeps the
 *  promise (titles, not subjects) while the display remains legible. */
const MAX_LABELS = 26;
const PAD = 3;

interface LabelSlot {
  el: HTMLElement;
  index: number;
}

/** Book titles floating beside their nodes, as an HTML overlay.
 *
 *  Not drei's `<Text>`: it fetches font data from a CDN at runtime, which this
 *  app must work without. HTML labels need no network, render crisper, and cost
 *  no draw calls.
 *
 *  The elements are POOLED — `MAX_LABELS` divs are mounted once and re-targeted
 *  every frame. Rendering one div per node would put React on the hot path of a
 *  graph that changes on every click, and mount/unmount churn on every camera
 *  move. Here React renders the pool exactly once.
 *
 *  Positions come from the live position buffer rather than `node.target`, so
 *  labels travel with their nodes during the spawn animation. */
export function NodeLabels({
  cameraRef,
  pointsRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pool] = useState(() => Array.from({ length: MAX_LABELS }, (_, i) => i));

  useEffect(() => {
    let raf = 0;
    const vec = new THREE.Vector3();
    const camPos = new THREE.Vector3();

    // Reused across frames so a 60fps loop allocates nothing.
    const ranked: Array<{ index: number; dist: number }> = [];
    const boxes: Array<{
      slot: LabelSlot;
      x: number;
      y: number;
      w: number;
      h: number;
      z: number;
      dist: number;
    }> = [];
    const rects: Array<{ top: number; bottom: number; left: number; right: number }> = [];
    let canvasEl: HTMLCanvasElement | null = null;

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const container = containerRef.current;
      const camera = cameraRef.current;
      const points = pointsRef.current;
      if (!container || !camera || !points) return;

      if (!canvasEl) canvasEl = document.querySelector('canvas');
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();

      const state = useStore.getState();
      const nodes = state.graph.nodes;
      const positions = points.geometry.getAttribute('position').array as Float32Array;
      const count = Math.min(nodes.length, MAX_NODES);

      const focusId = state.hoveredRef ?? state.selectedRef;
      const focusSlot = focusId ? (state.graph.indexOf.get(focusId) ?? -1) : -1;

      camera.getWorldPosition(camPos);

      ranked.length = 0;
      for (let i = 0; i < count; i++) {
        const dx = (positions[i * 3] as number) - camPos.x;
        const dy = (positions[i * 3 + 1] as number) - camPos.y;
        const dz = (positions[i * 3 + 2] as number) - camPos.z;
        // The seed and whatever is focused always get a label: they are the two
        // nodes whose identity the reader most needs, and losing the seed's
        // title as you fly outward is genuinely disorienting.
        const priority = i === focusSlot || i === 0 ? -1 : dx * dx + dy * dy + dz * dz;
        ranked.push({ index: i, dist: priority });
      }
      ranked.sort((a, b) => a.dist - b.dist);

      const elements = container.children;
      boxes.length = 0;

      for (let k = 0; k < MAX_LABELS; k++) {
        const el = elements[k] as HTMLElement | undefined;
        if (!el) continue;
        const entry = ranked[k];
        if (!entry) {
          el.style.opacity = '0';
          continue;
        }
        const node = nodes[entry.index];
        const book = node ? state.corpusIndexOf.get(idOf(node.nodeRef)) : undefined;
        const title = book === undefined ? '' : (state.books[book]?.title ?? '');
        if (el.textContent !== title) el.textContent = title;

        vec
          .set(
            positions[entry.index * 3] as number,
            positions[entry.index * 3 + 1] as number,
            positions[entry.index * 3 + 2] as number,
          )
          .project(camera);

        if (vec.z > 1) {
          el.style.opacity = '0';
          continue;
        }

        boxes.push({
          slot: { el, index: entry.index },
          x: (vec.x * 0.5 + 0.5) * rect.width,
          // Lifted clear of the mark itself; labels are anchored bottom-centre,
          // so this is the gap between the text baseline box and the point.
          y: (-vec.y * 0.5 + 0.5) * rect.height - 14,
          w: el.offsetWidth || 90,
          h: el.offsetHeight || 16,
          z: vec.z,
          dist: entry.dist,
        });
      }

      // Nearer labels claim their spot first; farther ones step out of the way.
      // Two nodes far apart in 3D can still project to the same pixels, so this
      // has to run in SCREEN space, every frame — world-space separation cannot
      // prevent it.
      boxes.sort((a, b) => a.dist - b.dist);
      rects.length = 0;

      for (const box of boxes) {
        let y = box.y;
        let placed = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          const top = y - box.h - PAD;
          const bottom = y + PAD;
          const left = box.x - box.w / 2 - PAD;
          const right = box.x + box.w / 2 + PAD;
          const clash = rects.some(
            (r) => left < r.right && right > r.left && top < r.bottom && bottom > r.top,
          );
          if (!clash) {
            rects.push({ top, bottom, left, right });
            placed = true;
            break;
          }
          y -= box.h + PAD * 2;
        }

        // Give up rather than stack a label somewhere it no longer points at
        // its own node — a mislabelled point is worse than an unlabelled one.
        if (!placed) {
          box.slot.el.style.opacity = '0';
          continue;
        }

        const focused = box.slot.index === focusSlot;
        box.slot.el.style.transform = `translate3d(${box.x}px, ${y}px, 0) translate(-50%, -100%)`;
        box.slot.el.style.opacity = focused ? '1' : String(Math.max(0.42, 1 - Math.max(0, box.z) * 0.55));
        box.slot.el.className = focused ? 'node-label node-label--focus' : 'node-label';
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, pointsRef]);

  return (
    <div className="node-labels" ref={containerRef} aria-hidden="true">
      {pool.map((i) => (
        <span key={i} className="node-label" style={{ opacity: 0 }} />
      ))}
    </div>
  );
}
