import { useEffect, useRef } from 'react';
import { MAX_LISTED_RESULTS, useStore } from '@/state/store';
import { MIN_QUERY_LENGTH } from '@/domain/search';

/** Results as a real list of buttons. Activating one drives the scene, so the
 *  keyboard path and the click path go through identical code. */
export function ResultList(): React.ReactElement | null {
  const query = useStore((s) => s.query);
  const results = useStore((s) => s.results);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const setHovered = useStore((s) => s.setHovered);
  const focusedIndex = useStore((s) => s.focusedResultIndex);
  const setFocusedResultIndex = useStore((s) => s.setFocusedResultIndex);
  const listRef = useRef<HTMLUListElement>(null);

  const visible = results.slice(0, MAX_LISTED_RESULTS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (visible.length === 0) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;

      const target = e.target as HTMLElement | null;
      const inSearchUi = target?.closest('.panel--search') !== null;
      if (!inSearchUi) return;

      if (e.key === 'Enter') {
        const hit = visible[focusedIndex];
        if (hit) {
          e.preventDefault();
          select(hit.book.id, { fly: true });
        }
        return;
      }

      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(
        visible.length - 1,
        Math.max(0, (focusedIndex < 0 ? -1 : focusedIndex) + delta),
      );
      setFocusedResultIndex(next);
      const id = visible[next]?.book.id ?? null;
      setHovered(id);
      listRef.current
        ?.querySelectorAll('button')
        ?.[next]?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, focusedIndex, select, setHovered, setFocusedResultIndex]);

  if (query.trim().length < MIN_QUERY_LENGTH) return null;

  if (results.length === 0) {
    return (
      <p className="results__empty" role="status">
        No books match “{query.trim()}”.
      </p>
    );
  }

  return (
    <>
      <ul className="results" ref={listRef} aria-label="Search results">
        {visible.map((hit, i) => (
          <li key={hit.book.id}>
            <button
              type="button"
              className={
                hit.book.id === selectedId
                  ? 'result result--selected'
                  : i === focusedIndex
                    ? 'result result--focused'
                    : 'result'
              }
              onClick={() => select(hit.book.id, { fly: true })}
              onMouseEnter={() => setHovered(hit.book.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => {
                setFocusedResultIndex(i);
                setHovered(hit.book.id);
              }}
            >
              <span className="result__title">{hit.book.title}</span>
              <span className="result__meta">
                {hit.book.authors.join(', ')} · {formatYear(hit.book.year)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {results.length > visible.length && (
        <p className="results__more">
          Showing {visible.length} of {results.length}. Narrow the search to see the rest —
          all {results.length} are highlighted in the map.
        </p>
      )}
    </>
  );
}

export function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BC` : String(year);
}
