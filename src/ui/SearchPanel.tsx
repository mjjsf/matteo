import { useEffect, useRef } from 'react';
import { useStore } from '@/state/store';
import { MIN_QUERY_LENGTH } from '@/domain/search';
import { ResultList } from './ResultList';
import { TreeOutline } from './TreeOutline';

/** Search plus results as real, focusable DOM.
 *
 *  This is not a consolation prize for the 3D view — it is the primary
 *  navigation path, it drives the scene (so keyboard and pointer users share one
 *  code path), and it is the "table view" relief channel that the light-mode
 *  orange contrast result requires. */
export function SearchPanel(): React.ReactElement {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const results = useStore((s) => s.results);
  const searchTree = useStore((s) => s.searchTree);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <section className="panel panel--search" aria-labelledby="search-heading">
      <h1 id="search-heading" className="brand">
        matteo
        <span className="brand__sub">a map of books</span>
      </h1>

      <div className="field">
        <label htmlFor="book-search">Search titles, authors, subjects</label>
        <input
          id="book-search"
          ref={inputRef}
          type="search"
          value={query}
          placeholder="try: cyberpunk, Le Guin, climate…"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="field__hint">
          {searching
            ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
            : 'Press / to focus. Searching grows a tag tree in the map.'}
        </p>
      </div>

      {searching && searchTree.length > 0 && <TreeOutline />}
      <ResultList />
    </section>
  );
}
