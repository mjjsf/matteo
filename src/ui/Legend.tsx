import { RELATION_LEGEND, RELATION, type ThemeColors } from '@/domain/palette';
import { useStore } from '@/state/store';

/** Legend for the rollover colours.
 *
 *  Always present, because identity must never rest on colour alone — and here
 *  it is doubly required: the light-mode orange sits below 3:1 against white, a
 *  RELIEF result whose mitigation is exactly this kind of visible labelling plus
 *  the DOM result list. */
export function Legend({ theme }: { theme: ThemeColors }): React.ReactElement {
  const hoveredId = useStore((s) => s.hoveredId);

  return (
    <div className={hoveredId ? 'legend legend--active' : 'legend'}>
      <p className="legend__title">
        {hoveredId ? 'Related to the point under your cursor' : 'Hover a point to see its relatives'}
      </p>
      <ul>
        {RELATION_LEGEND.map(({ kind, label }) => (
          <li key={kind}>
            <span
              className={kind === RELATION.sharedTag ? 'swatch swatch--size' : 'swatch'}
              style={{
                background:
                  kind === RELATION.sameAuthor
                    ? theme.sameAuthor
                    : kind === RELATION.sameSubject
                      ? theme.sameSubject
                      : theme.pointResting,
              }}
              aria-hidden="true"
            />
            {label}
            {kind === RELATION.sharedTag && <em> (larger, no colour)</em>}
          </li>
        ))}
      </ul>
    </div>
  );
}
