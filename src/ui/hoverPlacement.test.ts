import { describe, expect, it } from 'vitest';
import { GAP, placeHover } from './hoverPlacement';

const canvas = { width: 1440, height: 900 };
const at = (x: number, y: number, hasMenu: boolean, size = canvas) =>
  placeHover({ x, y, ...size, hasMenu });

describe('the menu', () => {
  it('sits below and LEFT of the node it was opened on', () => {
    const place = at(700, 450, true);
    expect(place.menuLeft).toBe(true);
    expect(place.menuAbove).toBe(false);
    expect(place.menuOffsetX).toBe(GAP);
    expect(place.menuOffsetY).toBe(GAP);
  });

  it('flips right at the LEFT edge rather than running off it', () => {
    // The flip direction inverted with the default. A node near the left edge
    // has nowhere to put a 230px menu, so it goes to the right instead.
    expect(at(40, 450, true).menuLeft).toBe(false);
    expect(at(1300, 450, true).menuLeft).toBe(true);
  });

  it('flips at the bottom edge rather than running off it', () => {
    expect(at(700, 895, true).menuAbove).toBe(true);
    expect(at(700, 450, true).menuAbove).toBe(false);
  });
});

describe('the card keeps clear of the menu', () => {
  it('takes the opposite vertical side, so it needs no sideways push', () => {
    // The menu hangs below; the card goes above. Separated for free, and each
    // stays near the node it describes.
    const place = at(700, 450, true);
    expect(place.menuAbove).toBe(false);
    expect(place.cardBelow).toBe(false);
    expect(place.cardOffsetX).toBe(GAP);
  });

  it('stands off sideways at the top edge, where both are forced downward', () => {
    // The menu still hangs below, and the card cannot go above because there is
    // not 190px of room. Distance is what is left.
    const place = at(700, 20, true);
    expect(place.menuAbove).toBe(false);
    expect(place.cardBelow).toBe(true);
    expect(place.cardOffsetX).toBeGreaterThan(GAP);
  });

  it('stands off sideways at the bottom edge too', () => {
    // The opposite-sides rule cannot help here and never can: the menu flips
    // above only when 130px will not fit below, and the card needs 190px, so
    // wherever the menu is forced up the card has nowhere to drop to. The two
    // reachable outcomes are opposite sides or a sideways standoff — there is no
    // third case where they simply swap.
    const place = at(700, 895, true);
    expect(place.menuAbove).toBe(true);
    expect(place.cardBelow).toBe(false);
    expect(place.cardOffsetX).toBeGreaterThan(GAP);
  });

  it('sits where it always did when no menu is open on this node', () => {
    // The normal case by a distance: the menu follows a click and the card
    // follows the pointer, so they are usually on different nodes entirely.
    const place = at(700, 450, false);
    expect(place.cardOffsetX).toBe(GAP);
    expect(place.cardBelow).toBe(false);
  });

  it('flips left before it would run off the right edge, menu or not', () => {
    for (const hasMenu of [false, true]) {
      expect(at(1439, 450, hasMenu).cardLeft).toBe(true);
      expect(at(100, 450, hasMenu).cardLeft).toBe(false);
    }
  });

  it('flips left sooner when the standoff has pushed it out', () => {
    // Otherwise the extra offset walks the card off the edge at positions where
    // it used to fit.
    const x = 1140;
    expect(at(x, 450, false).cardLeft).toBe(false);
    expect(at(x, 20, true).cardLeft).toBe(true);
  });
});

describe('counting axes still answers the same question', () => {
  it('treats a non-zero segment count as a menu being open', () => {
    // Kept so a caller holding a list of branch axes can pass its length without
    // first translating it into a boolean.
    expect(placeHover({ x: 700, y: 450, ...canvas, segments: 3 }).cardOffsetX).toBe(
      at(700, 450, true).cardOffsetX,
    );
    expect(placeHover({ x: 700, y: 20, ...canvas, segments: 0 }).cardOffsetX).toBe(GAP);
  });
});
