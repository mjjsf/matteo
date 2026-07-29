import { useMemo } from 'react';
import { useStore, bookById } from '@/state/store';
import { asSlot, outline, tierOf, TIER } from '@/domain/graph';
import { formatYear } from './format';

/** Deepest level that still gets its own indent step. */
const MAX_INDENT_LEVELS = 6;

const TIER_NOTE: Record<number, string> = {
  [TIER.seed]: 'starting book',
  [TIER.expandable]: 'can grow',
  [TIER.expanded]: 'grown',
  [TIER.exhausted]: 'no further matches',
};

/** The graph as real, focusable DOM.
 *
 *  Not a consolation prize for the canvas — it is the same graph, driven by the
 *  same store actions, so a keyboard or screen-reader user walks the identical
 *  exploration rather than a reduced version of it. Every row is a button that
 *  expands exactly as clicking the node does.
 *
 *  It is also the "table view" relief channel the palette result requires: the
 *  light-mode orange sits below 3:1 on white, which is legal only because
 *  nothing here depends on distinguishing marks by colour. */
export function GraphOutline(): React.ReactElement | null {
  const graph = useStore((s) => s.graph);
  const revision = useStore((s) => s.revision);
  const selectedId = useStore((s) => s.selectedId);
  const expand = useStore((s) => s.expand);
  const select = useStore((s) => s.select);
  const setHovered = useStore((s) => s.setHovered);

  // Keyed on `revision` because `expand` mutates node flags in place for the
  // no-op cases, so the node array alone is not a reliable change signal.
  const rows = useMemo(() => outline(graph), [graph, revision]);

  if (rows.length === 0) return null;

  return (
    <nav className="outline" aria-label="Books on the map">
      {/* Deliberately a plain list, not role="tree". A tree item may not contain
          its own interactive controls, and each row here needs two buttons —
          open, and grow. Depth is carried as text instead, which every screen
          reader announces correctly with no custom keyboard model to learn. */}
      <ul>
        {rows.map((row) => {
          const book = bookById(row.bookId);
          const node = graph.nodes[row.slot];
          if (!book || !node) return null;
          const tier = tierOf(node);
          const canGrow = !node.expanded && node.expandable;

          return (
            <li key={`${row.slot}-${row.bookId}`}>
              <div
                className="outline__row"
                // Indentation stops growing after a few levels. Unbounded, a
                // long chain pushed the title clean out of a 330px panel and
                // left a column of bare `+` buttons with no way to tell what
                // any of them were. Depth past the cap is still announced in
                // the visually-hidden text, so nothing is lost to a screen
                // reader — only the pixels are rationed.
                style={{ paddingLeft: `${Math.min(row.depth, MAX_INDENT_LEVELS) * 0.7}rem` }}
              >
                <button
                  type="button"
                  className={
                    book.id === selectedId ? 'outline__book outline__book--selected' : 'outline__book'
                  }
                  aria-current={book.id === selectedId ? 'true' : undefined}
                  onFocus={() => setHovered(book.id)}
                  onBlur={() => setHovered(null)}
                  onMouseEnter={() => setHovered(book.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => select(book.id, { fly: true })}
                >
                  <span className="outline__title">{book.title}</span>
                  <span className="outline__meta">
                    {book.authors.join(', ')} · {formatYear(book.year)}
                  </span>
                  <span className="visually-hidden">
                    {row.depth === 0 ? 'starting book' : `${row.depth} steps out`}, {TIER_NOTE[tier]}
                  </span>
                </button>

                {canGrow && (
                  <button
                    type="button"
                    className="outline__grow"
                    // Named for the book rather than "expand", so a screen
                    // reader announces which of thirty rows this button acts on.
                    aria-label={`Show books similar to ${book.title}`}
                    onClick={() => expand(asSlot(row.slot))}
                  >
                    +
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
