import { useEffect, useRef } from 'react';
import { useStore, bookForRef, describeRef } from '@/state/store';
import { bookshopLinkForBook, configuredAffiliateId } from '@/domain/bookshop';
import { asSlot } from '@/domain/graph';
import { BranchMenu } from './BranchMenu';

/** Detail panel for whatever is selected.
 *
 *  NO LONGER MOUNTED OVER THE MAP. It used to float in the right column there,
 *  duplicating a rollover card that already carries the same title, byline and
 *  description for whatever the pointer is on.
 *
 *  It stays in `ListOnlyApp`, and that is not a leftover. That view has no
 *  canvas — so no rollover card and no node menu — and this is the only place a
 *  description, a buy link or `Start a new map here` can be reached there at
 *  all. Deleting the component to tidy the map would have gutted the fallback.
 *
 *  Switches on grain. A book has a description and a buy link; a subject or an
 *  author has neither, because this corpus carries neither — there is no author
 *  biography and no subject blurb anywhere in the data. Writing one would be the
 *  same error the descriptions rule already forbids: plausible text that stays
 *  invisible as fiction until a reader trusts it. What they do have is what they
 *  contain, and that is what the branch menu shows.
 *
 *  The book's subjects used to be listed here as clickable pills that branched
 *  the map. They are gone: `Related Subjects` in the branch menu grows exactly
 *  the same set from the same book, so the pills were a second route to one
 *  destination and the panel is quieter without them. */
export function DetailPanel(): React.ReactElement | null {
  const selectedRef = useStore((s) => s.selectedRef);
  const graph = useStore((s) => s.graph);
  const revision = useStore((s) => s.revision);
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
  const link = book ? bookshopLinkForBook(book, configuredAffiliateId()) : null;

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

      {/* Nothing here claims price, stock or availability: this side knows none
          of those, so the link opens Bookshop's page and their page reports what
          they have. That is why `link.hint` not being rendered changes nothing
          about what the link claims — it never claimed anything.

          `sponsored` is conditional rather than always-on. It belongs on a link
          that can earn a commission, and a Bookshop SEARCH cannot: attribution
          rides on the `/a/{id}` path segment, which a search URL has nowhere to
          put. Every link in the corpus is a search today.

          The affiliate disclosure is not repeated here: `Footer` renders it on
          every screen including this one. */}
      {link && (
        <a
          className="buy"
          href={link.href}
          target="_blank"
          rel={link.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'}
        >
          {link.label}
        </a>
      )}
    </aside>
  );
}
