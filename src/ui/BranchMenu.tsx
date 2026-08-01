import { useStore } from '@/state/store';
import { asSlot, type Slot } from '@/domain/graph';

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
      {axes.map((axis) => (
        <button
          key={axis.id}
          type="button"
          // No item is pre-highlighted. The first one used to be painted solid
          // blue because a plain click on a node grew it along that axis, so the
          // colour named the branch the fast path would take. A click opens this
          // menu now and grows nothing until something here is pressed, so the
          // blue was marking a primacy that no longer exists.
          className="branch__axis"
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
