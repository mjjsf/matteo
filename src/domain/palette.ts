/** Colour tokens for the scene and UI.
 *
 *  These hexes are NOT free to edit. They were selected by running the dataviz
 *  skill's `validate_palette.js` with `--pairs all` (a 3D point field is a
 *  scatter: any two marks can end up adjacent, so the strict all-pairs
 *  colourblind gate applies, not the easier adjacent-pairs one).
 *
 *  What the measurements established:
 *   - The documented 8-hue palette FAILS all-pairs (CVD ΔE 3.2).
 *   - The largest all-pairs-passing set is 4 hues, and those sets rely on
 *     ~2.2:1 colours that vanish as small points.
 *   - **No three untouched macOS Finder label colours can coexist**: red↔green
 *     is ΔE 1.9 under deuteranopia, orange↔green 5.0, blue↔purple 4.4. macOS
 *     labels are chips beside text, never marks distinguished by colour alone.
 *   - macOS blue + orange is the one near-authentic pair that passes, by a very
 *     large margin.
 *
 *  ## One theme, on a light field
 *
 *  There is deliberately no dark mode. The brief was a *white field* of books,
 *  and a near-black canvas is not that — following `prefers-color-scheme` meant
 *  anyone with a dark desktop got the opposite of the thing being asked for. So
 *  the field is a warm greige in every environment.
 *
 *  Greige rather than pure white buys a real accessibility win, not just a
 *  softer look. On #ffffff the only orange that stays inside the CVD lightness
 *  band measures 2.57:1 — a RELIEF result, legal only because the app ships
 *  labels and a DOM list. Dropping the surface to #F2F0EB left room to step the
 *  orange down to #d16400, which measures 3.33:1 and clears the 3:1 floor
 *  outright. The relief channels are still there, but the palette no longer
 *  depends on them.
 *
 *  Verification (must pass before changing anything here):
 *    node validate_palette.js "#2A7BF6,#d16400" --mode light --surface "#F2F0EB" --pairs all
 *
 *  Measured on that surface: CVD ΔE 31.0 protan / 29.9 tritan, normal-vision
 *  35.2 (gates are ≥8 and ≥15), and **all contrast checks pass** — blue 3.50:1,
 *  orange 3.33:1, resting points 3.15:1, ink 17.28:1.
 */

export interface ThemeColors {
  /** Page and canvas background. The field the books sit on. */
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  hairline: string;
  /** Node colour at rest — a book with no similar books left to show.
   *  #898781 measures 3.15:1 on the greige surface. Do NOT substitute a paler
   *  grey: #c3c2b7 is 1.5:1 here and disappears as a small mark. */
  pointResting: string;
  /** The seed, and whatever is hovered or selected. Ink, not a hue: it is the
   *  focus, not a category. */
  focus: string;
  /** A node that can still be grown. macOS Finder blue, untouched. */
  expandable: string;
  /** A node already grown. macOS Finder orange, stepped down for contrast. */
  expanded: string;
  /** Edges between a book and the books grown from it. */
  edge: string;
}

/** The single theme. Exported as `FIELD` rather than `LIGHT` because there is no
 *  counterpart to contrast it with — naming it `LIGHT` would imply a `DARK`
 *  that intentionally does not exist. */
export const FIELD: ThemeColors = {
  surface: '#F2F0EB',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#6b6963',
  hairline: 'rgba(11,11,11,0.12)',
  pointResting: '#898781',
  focus: '#0b0b0b',
  expandable: '#2A7BF6',
  expanded: '#d16400',
  edge: 'rgba(11,11,11,0.24)',
};

/** The exact strings the palette test asserts against, so an edit that breaks
 *  the measured gates fails CI instead of shipping. */
export const VALIDATED_HEXES = {
  surface: '#F2F0EB',
  hues: ['#2A7BF6', '#d16400'],
} as const;

/** Convert '#rrggbb' to the 0..1 triple a BufferAttribute wants. */
export function hexToRgbTriple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
