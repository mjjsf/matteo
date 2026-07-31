import { useEffect, useRef } from 'react';
import { useStore, bookForRef, describeRef } from '@/state/store';
import { amazonLinkForBook, configuredAssociateTag } from '@/domain/amazon';
import { asSlot } from '@/domain/graph';
import { tagRef } from '@/domain/nodeRef';
import { BranchMenu } from './BranchMenu';

/** Detail panel for whatever is selected.
 *
 *  Switches on grain. A book has a description and a buy link; a subject or an
 *  author has neither, because this corpus carries neither — there is no author
 *  biography and no subject blurb anywhere in the data. Writing one would be the
 *  same error the descriptions rule already forbids: plausible text that stays
 *  invisible as fiction until a reader trusts it. What they do have is what they
 *  contain, and that is what the branch menu shows. */
export function DetailPanel(): React.ReactElement | null {
  const selectedRef = useStore((s) => s.selectedRef);
  const graph = useStore((s) => s.graph);
  const revision = useStore((s) => s.revision);
  const expand = useStore((s) => s.expand);
  const select = useStore((s) => s.select);
  const reseedFrom = useStore((s) => s.reseedFrom);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const about = selectedRef ? describeRef(selectedRef) : null;
  const book = selectedRef ? bookForRef(selectedRef) : undefined;

  useEffect(() => {
    if (about) headingRef.current?.focus();
  }, [about]);

  if (!selectedRef || !about) return null;

  // `revision` is read only to re-render when `expand` flips a node's flags in
  // place — the graph object alone does not always change identity for those.
  void revision;
  const slot = graph.indexOf.get(selectedRef);
  const node = slot === undefined ? undefined : graph.nodes[slot];
  const canGrow = node !== undefined && !node.expanded && node.expandable;
  const link = book ? amazonLinkForBook(book, configuredAssociateTag()) : null;

  return (
    <aside className="panel panel--detail" aria-live="polite" aria-label="Selected">
      <button
        type="button"
        className="panel__close"
        onClick={() => select(null)}
        aria-label="Close details"
      >
        ×
      </button>

      <h2 className="detail__title" ref={headingRef} tabIndex={-1}>
        {about.label}
      </h2>
      <p className="detail__byline">{about.detail}</p>

      {book && <p className="detail__description">{book.description}</p>}

      {book && book.subjects.length > 0 && (
        <>
          <h3 className="detail__heading">Subjects</h3>
          <ul className="chips">
            {book.subjects.map((tag) => (
              <li key={tag}>
                {/* The pills are branch buttons now. A subject on a book is the
                    most direct handle the reader has for "show me more of this
                    kind of thing", and it used to be inert text. */}
                <button
                  type="button"
                  className="chip chip--action"
                  onClick={() => {
                    if (slot !== undefined) expand(asSlot(slot), tagRef(tag));
                  }}
                  disabled={slot === undefined || node?.expanded === true}
                  title={`Grow the map along ${tag.replace(/-/g, ' ')}`}
                >
                  {tag.replace(/-/g, ' ')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {book?.isbn13 && (
        <p className="detail__isbn">
          ISBN <span>{book.isbn13}</span>
        </p>
      )}

      {canGrow && slot !== undefined && (
        <>
          <h3 className="detail__heading">Grow from here</h3>
          <BranchMenu slot={asSlot(slot)} />
        </>
      )}

      <div className="detail__actions">
        {node !== undefined && node.generation > 0 && (
          <button type="button" className="detail__reseed" onClick={() => reseedFrom(selectedRef)}>
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
      {link && (
        <a className="buy" href={link.href} target="_blank" rel="noopener noreferrer sponsored">
          {link.label}
        </a>
      )}
    </aside>
  );
}
