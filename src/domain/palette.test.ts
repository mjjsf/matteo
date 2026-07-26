import { describe, expect, it } from 'vitest';
import {
  DARK,
  LIGHT,
  RELATION,
  VALIDATED_RELATION_HEXES,
  colorForRelation,
  hexToRgbTriple,
  sizeScaleForRelation,
} from './palette';

/** These assertions exist so that editing a colour breaks CI rather than
 *  silently breaking the colourblind-safety gates. The hexes were chosen by
 *  running the dataviz validator with `--pairs all` in both modes; see the
 *  comment block in palette.ts for the measured numbers and the commands. */
describe('validated relation palette', () => {
  it('uses the exact measured macOS blue and orange steps', () => {
    expect(VALIDATED_RELATION_HEXES.light).toEqual(['#2A7BF6', '#F7821B']);
    expect(VALIDATED_RELATION_HEXES.dark).toEqual(['#2A7BF6', '#e26f00']);
  });

  it('wires those hexes into the theme objects', () => {
    expect([LIGHT.sameAuthor, LIGHT.sameSubject]).toEqual([
      ...VALIDATED_RELATION_HEXES.light,
    ]);
    expect([DARK.sameAuthor, DARK.sameSubject]).toEqual([
      ...VALIDATED_RELATION_HEXES.dark,
    ]);
  });

  it('keeps macOS blue untouched across modes', () => {
    // Its lightness sits inside both the light and dark bands, so no restep was
    // needed and the authentic Finder blue survives in both themes.
    expect(LIGHT.sameAuthor).toBe(DARK.sameAuthor);
  });

  it('never assigns a third hue to the sharedTag relation', () => {
    // No safe third macOS hue exists (measured: red<->green 1.9 deuteran,
    // blue<->purple 4.4 protan). sharedTag is encoded by size instead.
    expect(colorForRelation(RELATION.sharedTag, LIGHT)).toBe(LIGHT.pointResting);
    expect(colorForRelation(RELATION.sharedTag, DARK)).toBe(DARK.pointResting);
    expect(sizeScaleForRelation(RELATION.sharedTag)).toBeGreaterThan(
      sizeScaleForRelation(RELATION.none),
    );
  });

  it('gives the two hued relations a size difference too (secondary encoding)', () => {
    // Light-mode orange sits at 2.57:1, a RELIEF result. Size plus labels plus
    // the result list are what make that legal; they must not be dropped.
    expect(sizeScaleForRelation(RELATION.sameAuthor)).toBeGreaterThan(1);
    expect(sizeScaleForRelation(RELATION.sameSubject)).toBeGreaterThan(1);
  });

  it('does not use the too-faint #c3c2b7 for resting points', () => {
    // 1.79:1 on white — invisible as a small mark.
    expect(LIGHT.pointResting).not.toBe('#c3c2b7');
    expect(LIGHT.pointResting).toBe('#898781');
  });

  it('dims to gray rather than toward the background', () => {
    // Fading toward white would delete the surrounding cloud and destroy the
    // single-cluster reading the design depends on.
    expect(LIGHT.pointDim).not.toBe(LIGHT.surface);
    expect(DARK.pointDim).not.toBe(DARK.surface);
  });

  it('uses ink, not a hue, for the focused point', () => {
    expect(LIGHT.focus).toBe('#0b0b0b');
    expect(DARK.focus).toBe('#ffffff');
  });
});

describe('hexToRgbTriple', () => {
  it('converts to 0..1 components', () => {
    expect(hexToRgbTriple('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgbTriple('#ffffff')).toEqual([1, 1, 1]);
    const [r, g, b] = hexToRgbTriple('#2A7BF6');
    expect(r).toBeCloseTo(42 / 255, 5);
    expect(g).toBeCloseTo(123 / 255, 5);
    expect(b).toBeCloseTo(246 / 255, 5);
  });
});
