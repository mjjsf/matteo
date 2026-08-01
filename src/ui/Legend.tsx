import { TIER, type Tier } from '@/domain/graph';
import type { ThemeColors } from '@/domain/palette';

/** What the marks on the map mean.
 *
 *  Always present, because identity must never rest on colour alone — and here
 *  it is doubly required: the light-mode orange sits below 3:1 against white, a
 *  RELIEF result whose mitigation is exactly this kind of visible labelling plus
 *  the DOM outline beside the map.
 *
 *  Two axes now, and they are independent. COLOUR says whether a node can still
 *  be opened. SHAPE says what it is. Three kinds carried by colour as well would
 *  have needed three greys and two hues competing on one field; a disc, a ring
 *  and a diamond stay distinguishable in a greyscale screenshot. */
const TIERS: Array<{ tier: Tier; label: string; note?: string }> = [
  { tier: TIER.seed, label: 'Where you started' },
  { tier: TIER.expandable, label: 'Click to grow', note: 'bright centre' },
  { tier: TIER.expanded, label: 'Grown', note: 'click to fold back up' },
  { tier: TIER.exhausted, label: 'No further matches', note: 'faded' },
];

type Shape = 'disc' | 'ring' | 'diamond';

const SHAPES: Array<{ shape: Shape; label: string }> = [
  { shape: 'disc', label: 'Book' },
  { shape: 'ring', label: 'Subject' },
  { shape: 'diamond', label: 'Author' },
];

function colorFor(tier: Tier, theme: ThemeColors): string {
  switch (tier) {
    case TIER.seed:
      return theme.focus;
    case TIER.expandable:
      return theme.expandable;
    case TIER.expanded:
      return theme.expanded;
    default:
      return theme.pointResting;
  }
}

export function Legend({ theme }: { theme: ThemeColors }): React.ReactElement {
  return (
    <div className="legend">
      <ul>
        {TIERS.map(({ tier, label, note }) => (
          <li key={tier}>
            <span
              className="swatch"
              style={{ background: colorFor(tier, theme) }}
              aria-hidden="true"
            />
            <span className="legend__label">{label}</span>
            {note && <em>({note})</em>}
          </li>
        ))}
      </ul>
      <ul className="legend__shapes">
        {SHAPES.map(({ shape, label }) => (
          <li key={shape}>
            <span
              className={`swatch swatch--${shape}`}
              style={
                shape === 'disc'
                  ? { background: theme.pointResting }
                  : shape === 'ring'
                    ? { borderColor: theme.subject }
                    : { background: theme.subject }
              }
              aria-hidden="true"
            />
            <span className="legend__label">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
