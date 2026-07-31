import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useStore, bookForRef, describeRef, slotOf } from '@/state/store';
import { bookshopLinkForBook, configuredAffiliateId } from '@/domain/bookshop';
import { placeHover } from './hoverPlacement';

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
  const buyRef = useRef<HTMLAnchorElement>(null);
  const lockHover = useStore((s) => s.lockHover);

  useEffect(() => {
    let raf = 0;
    const vec = new THREE.Vector3();
    let lastRef: string | null | undefined;
    let canvasEl: HTMLCanvasElement | null = null;
    /** Whether the branch menu is open on the node under the cursor, so the card
     *  knows to stand clear of it. Usually false: the menu follows a click and
     *  the card follows the pointer, so they are normally on different nodes. */
    let menuHere = false;

    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = ref.current;
      const camera = cameraRef.current;
      const points = pointsRef.current;
      if (!el || !camera || !points) return;

      const state = useStore.getState();
      // Hover only. Selection has the detail panel, and pinning a card over the
      // graph after every click would sit on top of the thing just grown.
      const hovered = state.hoveredRef;

      if (!hovered) {
        if (lastRef !== null) {
          el.style.opacity = '0';
          lastRef = null;
        }
        return;
      }

      const slot = slotOf(state, hovered);
      if (slot === null) {
        el.style.opacity = '0';
        return;
      }

      if (hovered !== lastRef) {
        lastRef = hovered;
        const about = describeRef(hovered);
        const book = bookForRef(hovered);
        const node = state.graph.nodes[slot];
        if (about && titleRef.current && metaRef.current && descRef.current && hintRef.current) {
          titleRef.current.textContent = about.label;
          metaRef.current.textContent = about.detail;
          // A subject or an author has no description in this corpus, and
          // inventing one would be the error the descriptions rule forbids.
          descRef.current.textContent = book?.description ?? '';
          hintRef.current.textContent = !node
            ? ''
            : node.expanded
              ? // Expanded nodes now fold back up, so say so — this used to read
                // "Click to open details", which is no longer what a click does.
                node.generation > 0
                ? 'Click to hide what grew from this'
                : 'Your starting point'
              : node.expandable
                ? // A click no longer grows anything by itself — it opens the
                  // menu and waits. Saying "click to grow" would promise a
                  // result the click does not produce.
                  'Click for ways to grow this'
                : 'Nothing further to grow';
          // Written imperatively, like everything else on this card: rendering it
          // through React would put the reconciler back in the hover path.
          if (buyRef.current) {
            buyRef.current.style.display = book ? '' : 'none';
            if (book) {
              const link = bookshopLinkForBook(book, configuredAffiliateId());
              buyRef.current.href = link.href;
              buyRef.current.textContent = link.label;
              buyRef.current.rel = link.sponsored
                ? 'noopener noreferrer sponsored'
                : 'noopener noreferrer';
            }
          }
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
      // Shared with `NodeMenu`, which anchors to this same point whenever the
      // open menu belongs to the node being hovered. The card has to stand clear
      // of it, and only one of the two can be the place that knows how far.
      menuHere = state.menuRef === hovered;
      const { cardLeft, cardBelow, cardOffsetX, cardOffsetY } = placeHover({
        x,
        y,
        width: rect.width,
        height: rect.height,
        hasMenu: menuHere,
      });
      el.style.transform =
        `translate3d(${x}px, ${y}px, 0) ` +
        `translate(${cardLeft ? '-100%' : '0'}, ${cardBelow ? '0' : '-100%'}) ` +
        `translate(${cardLeft ? -cardOffsetX : cardOffsetX}px, ` +
        `${cardBelow ? cardOffsetY : -cardOffsetY}px)`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, pointsRef]);

  return (
    // Still `aria-hidden`, and the link inside is deliberately not tabbable. The
    // card is reachable only by pointer, and an aria-hidden subtree must not
    // contain anything focusable. Nothing is lost by it: DetailPanel carries the
    // same book's buy link as real, focusable DOM, so keyboard and screen-reader
    // users reach Bookshop by that route rather than this one.
    <div
      className="tooltip"
      ref={ref}
      aria-hidden="true"
      onPointerEnter={() => lockHover(true)}
      onPointerLeave={() => {
        lockHover(false);
        useStore.getState().setHovered(null);
      }}
    >
      <span className="tooltip__title" ref={titleRef} />
      <span className="tooltip__meta" ref={metaRef} />
      <span className="tooltip__desc" ref={descRef} />
      <span className="tooltip__hint" ref={hintRef} />
      <a
        className="tooltip__buy"
        ref={buyRef}
        href="#"
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
      >
        {/* Label and rel are both written in the frame loop above, from the same
            link the detail panel builds. Left empty here rather than hardcoded,
            so the two can never disagree about which shop this points at. */}
      </a>
    </div>
  );
}
