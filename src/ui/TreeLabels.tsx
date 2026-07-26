import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '@/state/store';
import { useTreeLayout } from '@/scene/useTreeLayout';

/** Labels for the 3D tag-tree nodes, as an HTML overlay.
 *
 *  Replaces drei's <Text>, which pulls font data from a CDN at runtime. HTML
 *  labels need no network access, render crisper, and cost no draw calls. Each
 *  label is also a real button, so the tree nodes are clickable without relying
 *  on raycasting a sphere. */
export function TreeLabels({
  cameraRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}): React.ReactElement | null {
  const placed = useTreeLayout();
  const activeBranchId = useStore((s) => s.activeBranchId);
  const setActiveBranch = useStore((s) => s.setActiveBranch);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (placed.length === 0) return;
    let raf = 0;
    const vec = new THREE.Vector3();

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return;
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();

      // Project first, then resolve collisions in SCREEN space. The world-space
      // relaxation in searchTreeLayout separates the nodes themselves, but two
      // nodes far apart in 3D can still project to the same pixels from a given
      // camera angle — so labels have to be de-collided here, every frame.
      const boxes: Array<{
        el: HTMLElement;
        x: number;
        y: number;
        w: number;
        h: number;
        depth: number;
        z: number;
      }> = [];

      const children = container.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const node = placed[i];
        if (!node) continue;
        vec.set(node.position[0], node.position[1], node.position[2]).project(camera);
        if (vec.z > 1) {
          el.style.opacity = '0';
          continue;
        }
        boxes.push({
          el,
          x: (vec.x * 0.5 + 0.5) * rect.width,
          y: (-vec.y * 0.5 + 0.5) * rect.height,
          w: el.offsetWidth || 80,
          h: el.offsetHeight || 20,
          depth: node.depth,
          z: vec.z,
        });
      }

      // Shallower nodes claim their position first — a root label matters more
      // than a leaf — and nearer nodes win over farther ones.
      boxes.sort((a, b) => a.depth - b.depth || a.z - b.z);

      const placedRects: Array<{ top: number; bottom: number; left: number; right: number }> = [];
      const PAD = 3;

      for (const box of boxes) {
        let y = box.y;
        // Nudge downward until this label clears everything already placed.
        // Bounded so a pathological case cannot loop long or run off-screen.
        for (let attempt = 0; attempt < 24; attempt++) {
          const top = y - box.h - PAD;
          const bottom = y + PAD;
          const left = box.x - box.w / 2 - PAD;
          const right = box.x + box.w / 2 + PAD;
          const clash = placedRects.some(
            (r) => left < r.right && right > r.left && top < r.bottom && bottom > r.top,
          );
          if (!clash) {
            placedRects.push({ top, bottom, left, right });
            break;
          }
          y += box.h + PAD * 2;
        }

        box.el.style.transform = `translate3d(${box.x}px, ${y}px, 0) translate(-50%, -100%)`;
        box.el.style.opacity = String(Math.max(0.3, 1 - Math.max(0, box.z) * 0.5));
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [placed, cameraRef]);

  if (placed.length === 0) return null;

  return (
    <div className="tree-labels" ref={containerRef}>
      {placed.map((node) => {
        const isActive = activeBranchId === node.id;
        return (
          <button
            key={node.id}
            type="button"
            className={
              isActive
                ? 'tree-label tree-label--active'
                : node.depth === 0
                  ? 'tree-label tree-label--root'
                  : 'tree-label'
            }
            // Reachable via the DOM outline in the search panel, so these
            // in-scene duplicates stay out of the tab order.
            tabIndex={-1}
            onClick={() => setActiveBranch(isActive ? null : node.id, { fly: !isActive })}
          >
            {node.label}
            <span className="tree-label__count">{node.matchCount}</span>
          </button>
        );
      })}
    </div>
  );
}
