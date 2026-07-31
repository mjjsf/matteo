import { describe, expect, it } from 'vitest';
import {
  ARC_RADIUS,
  ARC_SEG_MAX_WIDTH,
  CARD_ARC_GAP,
  CARD_GAP,
  placeHover,
} from './hoverPlacement';

const canvas = { width: 1440, height: 900 };
const at = (x: number, y: number, segments: number, size = canvas) =>
  placeHover({ x, y, ...size, segments });

/** Where a segment draws at its widest, given the angle convention. */
const segmentBox = (x: number, y: number, angle: number) => {
  const cx = x + ARC_RADIUS * Math.cos(angle);
  const cy = y - ARC_RADIUS * Math.sin(angle);
  return {
    left: cx - ARC_SEG_MAX_WIDTH / 2,
    right: cx + ARC_SEG_MAX_WIDTH / 2,
    // Generous: 0.7rem text with 5px padding measures nearer 24.
    top: cy - 15,
    bottom: cy + 15,
    cx,
    cy,
  };
};

const overlaps = (
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('the arc', () => {
  it('puts a single segment straight above the node', () => {
    const { arcAngles } = at(700, 450, 1);
    expect(arcAngles).toHaveLength(1);
    expect(segmentBox(700, 450, arcAngles[0] as number).cy).toBeCloseTo(450 - ARC_RADIUS);
  });

  it('spreads segments left to right in the order they were given', () => {
    const xs = at(700, 450, 3).arcAngles.map((a) => 700 + ARC_RADIUS * Math.cos(a));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('keeps the middle of three straight above the node', () => {
    const { arcAngles } = at(700, 450, 3);
    expect(700 + ARC_RADIUS * Math.cos(arcAngles[1] as number)).toBeCloseTo(700);
  });

  it('never lets two segments overlap, at any count', () => {
    // The geometry that actually went wrong first: at a smaller radius the three
    // buttons ran into each other around the node, which a card-versus-segment
    // check could not see because the card was nowhere near them.
    for (const segments of [1, 2, 3]) {
      const boxes = at(700, 450, segments).arcAngles.map((a) => segmentBox(700, 450, a));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i]!, boxes[j]!), `${segments} segments: ${i} hits ${j}`).toBe(false);
        }
      }
    }
  });

  it('arcs two segments OVER the node rather than flanking it', () => {
    // At a full semicircle the two outermost segments sit level with the node,
    // which reads as two labels stuck to its sides rather than as a band. Two is
    // the common case — 55% of books have no author branch — so it has to be the
    // one that looks deliberate.
    const boxes = at(700, 450, 2).arcAngles.map((a) => segmentBox(700, 450, a));
    for (const box of boxes) expect(box.cy).toBeLessThan(450 - ARC_RADIUS * 0.3);
    expect(boxes[0]!.cx).toBeLessThan(700);
    expect(boxes[1]!.cx).toBeGreaterThan(700);
  });

  it('flips underneath the node when there is no room above', () => {
    const high = at(700, 12, 3);
    expect(high.arcAbove).toBe(false);
    for (const angle of high.arcAngles) {
      expect(12 - ARC_RADIUS * Math.sin(angle)).toBeGreaterThan(12);
    }
  });

  it('lays out nothing for a node with nothing to choose', () => {
    expect(at(700, 450, 0).arcAngles).toEqual([]);
  });
});

describe('the card keeps clear of the arc', () => {
  it('takes the opposite side of the node, so it needs no sideways push', () => {
    const place = at(700, 450, 3);
    expect(place.arcAbove).toBe(true);
    expect(place.cardBelow).toBe(true);
    expect(place.cardOffsetX).toBe(CARD_GAP);
  });

  it('stands off sideways when it is stuck on the same side as the arc', () => {
    // A node low enough that the card cannot hang below it. The arc still wants
    // the space above, so the two share a side and only distance separates them.
    const place = at(700, 860, 3);
    expect(place.arcAbove).toBe(true);
    expect(place.cardBelow).toBe(false);
    expect(place.cardOffsetX).toBe(CARD_ARC_GAP);

    const rightmost = Math.max(
      ...place.arcAngles.map((a) => segmentBox(700, 860, a).right),
    );
    expect(700 + place.cardOffsetX).toBeGreaterThan(rightmost);
  });

  it('sits where it always did when no arc is showing', () => {
    // An expanded node has already chosen its axis, so the card should not drift
    // away from a control that is not there.
    expect(at(700, 450, 0).cardOffsetX).toBe(CARD_GAP);
    expect(at(700, 450, 0).cardBelow).toBe(false);
  });

  it('stands off sideways at the top edge, where neither has anywhere else to go', () => {
    // A node this high forces both downward — the arc because it will not fit
    // above, the card because there is not 190px of room above either. Nothing
    // clever is available, so distance is what separates them.
    const place = at(700, 12, 3);
    expect(place.arcAbove).toBe(false);
    expect(place.cardBelow).toBe(true);
    expect(place.cardOffsetX).toBe(CARD_ARC_GAP);
  });

  it('flips left before it would run off the right edge, arc or not', () => {
    for (const segments of [0, 3]) {
      expect(at(1439, 450, segments).cardLeft).toBe(true);
      expect(at(100, 450, segments).cardLeft).toBe(false);
    }
  });

  it('flips left sooner when the extra standoff has pushed it out', () => {
    // Otherwise the standoff walks the card off the edge at positions where it
    // used to fit.
    const x = 1440 - (280 + CARD_ARC_GAP - CARD_GAP) + 1;
    expect(at(x, 450, 0).cardLeft).toBe(false);
    expect(at(x, 860, 3).cardLeft).toBe(true);
  });
});
