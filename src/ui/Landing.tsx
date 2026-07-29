import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/state/store';
import { MIN_QUERY_LENGTH } from '@/domain/search';
import { formatYear } from './format';

/** The zero state: one centred question, nothing else.
 *
 *  The app opens with no map at all. There is nothing useful to show before we
 *  know where someone wants to start, and a pre-populated cloud would have to be
 *  arbitrary — so the first screen asks, and the map is grown from the answer.
 *
 *  Suggestions appear as you type and are keyboard-navigable, because "whatever
 *  book most closely matches" is a guess, and the user needs to see and override
 *  it rather than discover after the fact that we picked the wrong book. */
export function Landing(): React.ReactElement {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const suggestions = useStore((s) => s.suggestions);
  const seed = useStore((s) => s.seed);
  const bookCount = useStore((s) => s.books.length);

  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A stale highlight index would seed the wrong book after the list shifts
  // under it — reset whenever the list changes.
  useEffect(() => {
    setActive(0);
  }, [suggestions]);

  const typing = query.trim().length >= MIN_QUERY_LENGTH;
  const chosen = suggestions[active];

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    }
  };

  return (
    <main className="landing">
      <div className="landing__inner">
        <h1 className="landing__brand">
          matteo
          <span className="landing__sub">Name a book. Get the ones near it.</span>
        </h1>

        <form
          className="landing__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) seed(chosen.book.id);
          }}
        >
          <label className="visually-hidden" htmlFor="book-search">
            Name a book to start from
          </label>
          <input
            id="book-search"
            ref={inputRef}
            type="search"
            value={query}
            // Every example is a book that is actually in the collection.
            // Offering a title we do not have makes the first thing someone
            // types the one thing guaranteed to fail.
            placeholder="Neuromancer, Beloved, Dune…"
            autoComplete="off"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="seed-suggestions"
            aria-activedescendant={chosen ? `seed-option-${active}` : undefined}
            onKeyDown={onKeyDown}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={!chosen}>
            Start
          </button>
        </form>

        {typing && suggestions.length === 0 && (
          <p className="landing__hint" role="status">
            No book in the collection matches that. Try an author, or a different title.
          </p>
        )}

        {suggestions.length > 0 && (
          <ul className="landing__suggestions" id="seed-suggestions" role="listbox">
            {suggestions.map((hit, i) => (
              <li key={hit.book.id} role="none">
                <button
                  type="button"
                  id={`seed-option-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'suggestion suggestion--active' : 'suggestion'}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => seed(hit.book.id)}
                >
                  <span className="suggestion__title">{hit.book.title}</span>
                  <span className="suggestion__meta">
                    {hit.book.authors.join(', ')} · {formatYear(hit.book.year)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!typing && (
          <p className="landing__hint">
            {bookCount} books, mapped by shared subjects and authors.
          </p>
        )}
      </div>
    </main>
  );
}
