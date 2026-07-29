import { describe, expect, it } from 'vitest';
import { FIELD, VALIDATED_HEXES, hexToRgbTriple } from './palette';

/** Relative luminance and WCAG contrast, so the palette's claimed measurements
 *  are checked rather than trusted. A comment saying "3.33:1" rots the moment
 *  someone nudges a hex; this does not. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number): number => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** These assertions exist so that editing a colour breaks CI rather than
 *  silently breaking the colourblind-safety gates. The hexes were chosen by
 *  running the dataviz validator with `--pairs all`; see palette.ts for the
 *  measured numbers and the exact command. */
describe('validated palette', () => {
  it('uses the exact measured surface and hue steps', () => {
    expect(VALIDATED_HEXES.surface).toBe('#F2F0EB');
    expect(VALIDATED_HEXES.hues).toEqual(['#2A7BF6', '#d16400']);
  });

  it('wires those hexes into the theme', () => {
    expect(FIELD.surface).toBe(VALIDATED_HEXES.surface);
    expect([FIELD.expandable, FIELD.expanded]).toEqual([...VALIDATED_HEXES.hues]);
  });

  it('puts the field on a light greige, never a dark surface', () => {
    // The brief was a white field of books. Following prefers-color-scheme gave
    // anyone with a dark desktop a near-black canvas, which is the opposite.
    // There is one theme on purpose; this test is what stops a dark one
    // reappearing by accident.
    expect(luminance(FIELD.surface)).toBeGreaterThan(0.75);
  });

  it('clears the 3:1 contrast floor for every mark on that surface', () => {
    // This is the win the greige bought. On pure white the only orange inside
    // the CVD lightness band measures 2.57:1 — legal only under a relief
    // exemption. Dropping the surface left room to step the orange down.
    for (const mark of [FIELD.expandable, FIELD.expanded, FIELD.pointResting, FIELD.focus]) {
      expect(contrast(mark, FIELD.surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps macOS blue authentic', () => {
    expect(FIELD.expandable).toBe('#2A7BF6');
  });

  it('does not use the too-faint #c3c2b7 for resting points', () => {
    // 1.5:1 on this surface — invisible as a small mark.
    expect(FIELD.pointResting).not.toBe('#c3c2b7');
    expect(contrast('#c3c2b7', FIELD.surface)).toBeLessThan(3);
  });

  it('uses ink, not a hue, for the focused node', () => {
    expect(FIELD.focus).toBe('#0b0b0b');
  });

  it('keeps body text well clear of the AA floor', () => {
    expect(contrast(FIELD.textPrimary, FIELD.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(FIELD.textSecondary, FIELD.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(FIELD.textMuted, FIELD.surface)).toBeGreaterThanOrEqual(4.5);
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
