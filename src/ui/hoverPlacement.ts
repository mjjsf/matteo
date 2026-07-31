/** Where the two node overlays go.
 *
 *  The description card follows the pointer's node; the branch menu stays on the
 *  node that was clicked. Usually those are different nodes and nothing has to be
 *  negotiated — but hovering the node whose menu is open puts both on the same
 *  projected point, and both are large. Left to compute their own positions they
 *  would sit on top of each other, and each would be reasoning about the other's
 *  size from its own copy of the constants.
 *
 *  So one function decides both, from the same inputs, and each overlay reads the
 *  part it needs. Pure and tested, because an overlap that only appears at some
 *  screen positions is exactly what a screenshot at one camera angle will not
 *  show.
 *
 *  This used to place an ARC of buttons on a circle around the node, when the
 *  chooser appeared on hover. A click-opened menu is an ordinary rectangle, which
 *  is both easier to read and easier to place — the trigonometry, the segment
 *  spacing and the "does the outermost button clear the card" arithmetic all go
 *  away with it. */

/** Gap between the node and an overlay in the ordinary case. */
export const GAP = 14;

/** Roughly what each overlay occupies. Only used to ask "does it fit on this
 *  side", so these are the generous end of the range rather than measurements. */
const CARD_WIDTH = 280;
const CARD_HEIGHT = 190;
const MENU_WIDTH = 230;
const MENU_HEIGHT = 130;

export interface HoverPlacement {
  /** Card sits to the left of the node rather than the right. */
  cardLeft: boolean;
  /** Card hangs below the node rather than above it. */
  cardBelow: boolean;
  cardOffsetX: number;
  cardOffsetY: number;
  /** Menu sits to the left of the node rather than the right. */
  menuLeft: boolean;
  /** Menu sits above the node rather than below it. */
  menuAbove: boolean;
  menuOffsetX: number;
  menuOffsetY: number;
}

export function placeHover(input: {
  /** Node position within the canvas, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Whether a branch menu is open on THIS node. When it is, the two overlays
   *  have to be kept apart; when it is not, the card behaves as it always did. */
  hasMenu?: boolean;
  /** Retained so callers that count branch axes can pass what they have.
   *  Non-zero means the same thing as `hasMenu`. */
  segments?: number;
}): HoverPlacement {
  const { x, y, width, height } = input;
  const hasMenu = input.hasMenu ?? (input.segments ?? 0) > 0;

  // The menu goes below-right by default and flips only at an edge. It is
  // anchored to a click rather than to the pointer, so it should be where the
  // reader last put their cursor, not somewhere clever.
  const menuLeft = x > width - (MENU_WIDTH + GAP);
  const menuAbove = y > height - (MENU_HEIGHT + GAP);

  // The card takes the opposite VERTICAL side from the menu, which separates
  // them for free and keeps each near the node it describes. Only where that
  // side has no room does it fall back to standing off sideways.
  const roomAbove = y >= CARD_HEIGHT;
  const roomBelow = y + CARD_HEIGHT + GAP <= height;

  let cardBelow: boolean;
  if (!hasMenu) {
    cardBelow = !roomAbove;
  } else if (menuAbove) {
    cardBelow = roomBelow;
  } else {
    cardBelow = !roomAbove;
  }

  // Same side as the menu and nowhere else to go: distance is what is left.
  const sameSide = hasMenu && cardBelow === !menuAbove;
  const cardOffsetX = sameSide ? MENU_WIDTH + GAP * 2 : GAP;

  return {
    cardLeft: x > width - (CARD_WIDTH + cardOffsetX - GAP),
    cardBelow,
    cardOffsetX,
    cardOffsetY: GAP,
    menuLeft,
    menuAbove,
    menuOffsetX: GAP,
    menuOffsetY: GAP,
  };
}
