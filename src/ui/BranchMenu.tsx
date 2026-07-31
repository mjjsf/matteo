import { useStore } from '@/state/store';
import { asSlot, type Slot } from '@/domain/graph';
import { DEFAULT_AXIS } from '@/domain/branch';

/** The axes a node can be branched along, as buttons.
 *
 *  One component for both the rollover card and the outline, because they must
 *  offer the same thing — the outline is how keyboard and screen-reader users
 *  explore, not a courtesy copy, and a map they can grow but not steer would be
 *  a reduced version.
 *
 *  Axes with nothing behind them never arrive here: `axesFor` drops them. An
 *  option that resolves to an empty branch reads as a promise. */
export function BranchMenu({
  slot,
  onPick,
  compact,
}: {
  slot: Slot;
  onPick?: () => void;
  /** The rollover card is small and already carries a description. */
  compact?: boolean;
}): React.ReactElement | null {
  const revision = useStore((s) => s.revision);
  const axesFor = useStore((s) => s.axesFor);
  const expand = useStore((s) => s.expand);
  void revision;

  const axes = axesFor(slot);
  if (axes.length === 0) return null;

  return (
    <div className={compact ? 'branch branch--compact' : 'branch'}>
      {axes.map((axis, i) => (
        <button
          key={axis.id}
          type="button"
          // The first axis is the default one Enter takes, so it reads as the
          // primary action rather than as one of several equals. Keeping one
          // gesture fast is what stops the chooser taxing every expansion.
          className={
            i === 0 || axis.id === DEFAULT_AXIS ? 'branch__axis branch__axis--primary' : 'branch__axis'
          }
          onClick={() => {
            expand(asSlot(slot), axis.id);
            onPick?.();
          }}
        >
          <span className="branch__label">{axis.label}</span>
          <span className="branch__count">{axis.count}</span>
        </button>
      ))}
    </div>
  );
}
