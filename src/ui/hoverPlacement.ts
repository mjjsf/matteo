/** Where the two hover overlays go.
 *
 *  The description card and the branch arc both anchor to the same projected
 *  point, and both are large — the card up to 260px wide, the arc a ring of
 *  labelled buttons around the node. Left to compute their own positions they
 *  would sit on top of each other, and each would be reasoning about the other's
 *  size from its own copy of the constants.
 *
 *  So one function decides both, from the same inputs, and each overlay reads
 *  the part it needs. Pure and tested, because the failures it prevents — two
 *  absolutely-positioned layers overlapping, or three buttons overlapping each
 *  other — only appear at some screen positions and some segment counts, which
 *  is exactly what a screenshot at one camera angle will not show. */

/** Distance from the node to the centre of a segment. Large enough that the
 *  outermost two clear each other at `ARC_SEG_MAX_WIDTH`; no larger, because the
 *  ring covers whatever nodes it passes over. */
export const ARC_RADIUS = 86;

/** How much of a circle the segments span. "More or less a semicircle": wide
 *  enough to read as a band, narrow enough that two segments arc OVER the node
 *  rather than sitting level with it on either side. */
export const ARC_SWEEP = (140 * Math.PI) / 180;

/** The widest a segment may draw. Must match `max-width` on `.node-arc__seg` —
 *  which is why that is a fixed number rather than content-driven. Both the
 *  separation between segments and the card's standoff are derived from it, so a
 *  segment allowed to grow past its allowance would slide under its neighbour. */
export const ARC_SEG_MAX_WIDTH = 140;

/** Gap between the node and the card in the ordinary case. */
export const CARD_GAP = 14;

/** Horizontal gap for the one case where the card cannot go on the opposite side
 *  of the node from the arc: it has to clear the whole ring sideways instead.
 *  Derived rather than guessed, so changing the arc moves the card. */
export const CARD_ARC_GAP = Math.round(
  ARC_RADIUS * Math.sin(ARC_SWEEP / 2) + ARC_SEG_MAX_WIDTH / 2 + 12,
);

/** Roughly what the card occupies. Only used to ask "does it fit on this side",
 *  so it is the generous end of the range rather than a measurement. */
const CARD_WIDTH = 280;
const CARD_HEIGHT = 190;

/** Below this many pixels from the top there is no room to draw the arc above
 *  the node, so it goes underneath instead. */
const ARC_HEADROOM = ARC_RADIUS + 30;

export interface HoverPlacement {
  /** Card sits to the left of the node rather than the right. */
  cardLeft: boolean;
  /** Card hangs below the node rather than above it. */
  cardBelow: boolean;
  cardOffsetX: number;
  cardOffsetY: number;
  /** True when the arc is above the node. */
  arcAbove: boolean;
  /** One angle per segment, left to right.
   *
   *  Screen space, measured from the +x axis, counter-clockwise as drawn — so
   *  `Math.PI / 2` is directly ABOVE the node even though screen y grows
   *  downward. Convert with `x + r*cos(a)`, `y - r*sin(a)`. */
  arcAngles: number[];
}

export function placeHover(input: {
  /** Node position within the canvas, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How many branch segments to lay out. Zero for a node with nothing to
   *  choose — an expanded one, or a leaf. */
  segments: number;
}): HoverPlacement {
  const { x, y, width, height, segments } = input;
  const hasArc = segments > 0;

  const arcAbove = y >= ARC_HEADROOM;
  const centre = arcAbove ? Math.PI / 2 : -Math.PI / 2;

  const arcAngles: number[] = [];
  if (segments === 1) {
    arcAngles.push(centre);
  } else if (segments > 1) {
    // Descending, so index 0 is the leftmost segment and the labels read in the
    // order `axesFor` returned them.
    for (let i = 0; i < segments; i++) {
      arcAngles.push(centre + ARC_SWEEP / 2 - (i * ARC_SWEEP) / (segments - 1));
    }
  }

  // The card goes on the opposite side of the node from the arc, which separates
  // them for free and keeps the card near the thing it describes. Only when that
  // side has no room does it fall back to standing off sideways.
  let cardBelow: boolean;
  if (!hasArc) {
    cardBelow = y < CARD_HEIGHT;
  } else if (arcAbove) {
    cardBelow = y + CARD_HEIGHT + CARD_GAP <= height;
  } else {
    cardBelow = y < CARD_HEIGHT;
  }

  const sameSide = hasArc && arcAbove === !cardBelow;
  const cardOffsetX = sameSide ? CARD_ARC_GAP : CARD_GAP;

  return {
    cardLeft: x > width - (CARD_WIDTH + cardOffsetX - CARD_GAP),
    cardBelow,
    cardOffsetX,
    cardOffsetY: CARD_GAP,
    arcAbove,
    arcAngles,
  };
}
