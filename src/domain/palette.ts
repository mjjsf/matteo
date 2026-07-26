/** Colour tokens for the scene and UI.
 *
 *  These hexes are NOT free to edit. They were selected by running the dataviz
 *  skill's `validate_palette.js` over candidate sets with `--pairs all` (a 3D
 *  point cloud is a scatter: any two marks can end up adjacent, so the
 *  all-pairs gate applies, not the easier adjacent-pairs one).
 *
 *  What the measurements established:
 *   - The documented 8-hue palette FAILS all-pairs (CVD ΔE 3.2).
 *   - The largest all-pairs-passing set in both light and dark is 4 hues, and
 *     both such sets rely on ~2.2:1 colours that vanish as small points on white.
 *   - No three untouched macOS Finder label colours can coexist: red↔green is
 *     ΔE 1.9 under deuteranopia, orange↔green 5.0, blue↔purple 4.4. macOS
 *     labels are chips beside text, never marks distinguished by colour alone.
 *   - macOS blue + orange is the one near-authentic pair that passes, and it
 *     passes with a very large margin.
 *
 *  Hence: colour is spent on ROLLOVER (the handful of points related to what is
 *  under the cursor), never painted across the whole corpus at rest.
 *
 *  Verification (both must pass before changing anything here):
 *    node scripts/validate_palette.js "#2A7BF6,#F7821B" --mode light --surface "#ffffff" --pairs all
 *    node scripts/validate_palette.js "#2A7BF6,#e26f00" --mode dark  --surface "#1a1a19" --pairs all
 *
 *  Measured: CVD ΔE 32.0 light / 31.0 dark; normal-vision 38.5 / 36.8
 *  (gates are ≥8 and ≥15). Light-mode orange is 2.57:1 against white — a
 *  RELIEF result, legal only because the app ships the required relief
 *  channel: the DOM result list (a table view) plus an always-visible label on
 *  the hovered point. Those are load-bearing, not decoration.
 */

export const RELATION = {
  /** No relation to the hovered book — the resting state. */
  none: 0,
  /** Shares an author with the hovered book. */
  sameAuthor: 1,
  /** Shares the hovered book's taxonomy leaf. */
  sameSubject: 2,
  /** Shares at least one raw tag. Encoded by ring + radius, NEVER a third hue —
   *  no safe third macOS hue exists, as measured above. */
  sharedTag: 3,
} as const;

export type RelationKind = (typeof RELATION)[keyof typeof RELATION];

export interface ThemeColors {
  /** Page and canvas background. The "white field". */
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  hairline: string;
  /** Point colour at rest. #898781 measures 3.59:1 on white, 4.85:1 on dark.
   *  Do NOT substitute #c3c2b7 — it is 1.79:1 on white and disappears. */
  pointResting: string;
  /** De-emphasised points. Dims to GRAY, never toward the background: fading
   *  toward white would delete the surrounding cloud and destroy the
   *  single-cluster reading the whole design depends on. */
  pointDim: string;
  pointDimAlpha: number;
  /** The hovered/selected point itself. Ink, not a hue — it is the focus, not
   *  a category. */
  focus: string;
  /** macOS Finder blue. Untouched in both modes (L 0.604 sits inside the dark
   *  band, so no restep was needed). */
  sameAuthor: string;
  /** macOS Finder orange. The dark step is L 0.665 — the authentic #F7821B is
   *  L 0.725, outside the dark band's 0.48–0.67. */
  sameSubject: string;
  /** Taxonomy tree nodes and their edges. */
  treeNode: string;
  treeEdge: string;
}

export const LIGHT: ThemeColors = {
  surface: '#ffffff',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  hairline: 'rgba(11,11,11,0.10)',
  pointResting: '#898781',
  pointDim: '#c9ced8',
  pointDimAlpha: 0.4,
  focus: '#0b0b0b',
  sameAuthor: '#2A7BF6',
  sameSubject: '#F7821B',
  treeNode: '#52514e',
  treeEdge: 'rgba(11,11,11,0.22)',
};

export const DARK: ThemeColors = {
  surface: '#1a1a19',
  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',
  hairline: 'rgba(255,255,255,0.10)',
  pointResting: '#898781',
  pointDim: '#3a3a38',
  pointDimAlpha: 0.5,
  focus: '#ffffff',
  sameAuthor: '#2A7BF6',
  sameSubject: '#e26f00',
  treeNode: '#c3c2b7',
  treeEdge: 'rgba(255,255,255,0.22)',
};

/** The exact strings the palette test asserts against, so an edit that breaks
 *  the CVD gates fails CI instead of shipping. */
export const VALIDATED_RELATION_HEXES = {
  light: ['#2A7BF6', '#F7821B'],
  dark: ['#2A7BF6', '#e26f00'],
} as const;

export function colorForRelation(kind: RelationKind, theme: ThemeColors): string {
  switch (kind) {
    case RELATION.sameAuthor:
      return theme.sameAuthor;
    case RELATION.sameSubject:
      return theme.sameSubject;
    // sharedTag intentionally has no hue of its own — see RELATION.sharedTag.
    case RELATION.sharedTag:
    case RELATION.none:
    default:
      return theme.pointResting;
  }
}

/** Point radius multiplier per relation. This is the secondary encoding that
 *  makes the palette legal and gives `sharedTag` a channel of its own. */
export function sizeScaleForRelation(kind: RelationKind): number {
  switch (kind) {
    case RELATION.sameAuthor:
    case RELATION.sameSubject:
      return 1.55;
    case RELATION.sharedTag:
      return 1.25;
    default:
      return 1;
  }
}

export const RELATION_LEGEND: Array<{ kind: RelationKind; label: string }> = [
  { kind: RELATION.sameAuthor, label: 'Same author' },
  { kind: RELATION.sameSubject, label: 'Same subject' },
  { kind: RELATION.sharedTag, label: 'Shares a tag' },
];

/** Convert '#rrggbb' to the 0..1 triple a BufferAttribute wants. */
export function hexToRgbTriple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
