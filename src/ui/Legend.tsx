import { TIER, type Tier } from '@/domain/graph';
import type { ThemeColors } from '@/domain/palette';

/** What the node colours mean.
 *
 *  Always present, because identity must never rest on colour alone — and here
 *  it is doubly required: the light-mode orange sits below 3:1 against white, a
 *  RELIEF result whose mitigation is exactly this kind of visible labelling plus
 *  the DOM outline beside the map.
 *
 *  The distinction that earns the colour budget is "can this be opened?" — a
 *  graph you grow yourself has no need for the dim/emphasise vocabulary the old
 *  whole-corpus view used, because everything on screen is there because you
 *  asked for it. */
const ENTRIES: Array<{ tier: Tier; label: string; note?: string }> = [
  { tier: TIER.seed, label: 'Where you started' },
  { tier: TIER.expandable, label: 'Click to grow', note: 'bright centre' },
  { tier: TIER.expanded, label: 'Already grown' },
  { tier: TIER.exhausted, label: 'No further matches', note: 'faded' },
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
        {ENTRIES.map(({ tier, label, note }) => (
          <li key={tier}>
            <span
              className="swatch"
              style={{ background: colorFor(tier, theme) }}
              aria-hidden="true"
            />
            {label}
            {note && <em> ({note})</em>}
          </li>
        ))}
      </ul>
    </div>
  );
}
