import { useEffect, useRef } from 'react';
import { useStore, bookForRef } from '@/state/store';
import { amazonLinkForBook, configuredAssociateTag } from '@/domain/amazon';
import { asSlot } from '@/domain/graph';
import { formatYear } from './format';
import { bookRef } from '@/domain/nodeRef';

/** Detail panel for the selected book, with the buy link. */
export function DetailPanel(): React.ReactElement | null {
  const selectedRef = useStore((s) => s.selectedRef);
  const graph = useStore((s) => s.graph);
  const revision = useStore((s) => s.revision);
  const expand = useStore((s) => s.expand);
  const select = useStore((s) => s.select);
  const reseedFrom = useStore((s) => s.reseedFrom);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const book = selectedRef ? bookForRef(selectedRef) : undefined;

  useEffect(() => {
    if (book) headingRef.current?.focus();
  }, [book]);

  if (!book) return null;

  const link = amazonLinkForBook(book, configuredAssociateTag());
  // `revision` is read only to re-render when `expand` flips a node's flags in
  // place — the graph object alone does not always change identity for those.
  void revision;
  const slot = graph.indexOf.get(bookRef(book.id));
  const node = slot === undefined ? undefined : graph.nodes[slot];
  const canGrow = node !== undefined && !node.expanded && node.expandable;

  return (
    <aside className="panel panel--detail" aria-live="polite" aria-label="Selected book">
      <button
        type="button"
        className="panel__close"
        onClick={() => select(null)}
        aria-label="Close details"
      >
        ×
      </button>

      <h2 className="detail__title" ref={headingRef} tabIndex={-1}>
        {book.title}
      </h2>
      <p className="detail__byline">
        {book.authors.join(', ')} · {formatYear(book.year)}
      </p>

      <p className="detail__description">{book.description}</p>

      <h3 className="detail__heading">Subjects</h3>
      <ul className="chips">
        {book.subjects.map((tag) => (
          <li key={tag} className="chip">
            {tag.replace(/-/g, ' ')}
          </li>
        ))}
      </ul>

      {book.isbn13 && (
        <p className="detail__isbn">
          ISBN <span>{book.isbn13}</span>
        </p>
      )}

      <div className="detail__actions">
        {canGrow && slot !== undefined && (
          <button type="button" className="detail__grow" onClick={() => expand(asSlot(slot))}>
            Show similar books
          </button>
        )}
        {node !== undefined && node.generation > 0 && (
          <button type="button" className="detail__reseed" onClick={() => reseedFrom(bookRef(book.id))}>
            Start a new map here
          </button>
        )}
      </div>

      {/* No Prime badge of our own: eligibility can only be verified through
          Amazon's PA-API, so the search link asks Amazon to filter and its page
          reports the result. Claiming it here would be inventing facts about a
          real product — which is why `link.hint` no longer being rendered does
          not change what this link claims. It never claimed anything.

          The Associates disclosure is not repeated here either: `Footer` renders
          it on every screen including this one, so this was a duplicate. */}
      <a className="buy" href={link.href} target="_blank" rel="noopener noreferrer sponsored">
        {link.label}
      </a>
    </aside>
  );
}
