import { useEffect, useRef } from 'react';
import { useStore } from '@/state/store';
import { AFFILIATE_DISCLOSURE, amazonLinkForBook, configuredAssociateTag } from '@/domain/amazon';
import { formatYear } from './ResultList';

/** Detail panel for the selected book. */
export function DetailPanel(): React.ReactElement | null {
  const selectedId = useStore((s) => s.selectedId);
  const books = useStore((s) => s.books);
  const byId = useStore((s) => s.byId);
  const tagMap = useStore((s) => s.tagMap);
  const taxonomy = useStore((s) => s.taxonomy);
  const setActiveBranch = useStore((s) => s.setActiveBranch);
  const select = useStore((s) => s.select);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const index = selectedId ? byId.get(selectedId) : undefined;
  const book = index !== undefined ? books[index] : undefined;

  useEffect(() => {
    if (book) headingRef.current?.focus();
  }, [book]);

  if (!book) return null;

  const link = amazonLinkForBook(book, configuredAssociateTag());

  return (
    <aside className="panel panel--detail" aria-live="polite" aria-label="Selected book">
      <button type="button" className="panel__close" onClick={() => select(null)} aria-label="Close details">
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
        {book.subjects.map((tag) => {
          const nodeId = tagMap[tag]?.[0];
          const label = nodeId ? (taxonomy.byId.get(nodeId)?.label ?? tag) : tag;
          return (
            <li key={tag}>
              <button
                type="button"
                className="chip"
                title={`Show everything in ${label}`}
                onClick={() => nodeId && setActiveBranch(nodeId, { fly: true })}
              >
                {tag.replace(/-/g, ' ')}
              </button>
            </li>
          );
        })}
      </ul>

      {book.isbn13 && (
        <p className="detail__isbn">
          ISBN <span>{book.isbn13}</span>
        </p>
      )}

      <a className="buy" href={link.href} target="_blank" rel="noopener noreferrer sponsored">
        {link.label}
        <span className="buy__hint">
          {link.kind === 'dp' ? 'opens the product page' : 'opens a search — no ISBN on file'}
        </span>
      </a>

      {/* Deliberately no Prime badge or shipping claim: verifying eligibility
          needs Amazon's PA-API, and asserting it without that would be making
          up facts about a real product. */}
      <p className="detail__disclosure">{AFFILIATE_DISCLOSURE}</p>
    </aside>
  );
}
