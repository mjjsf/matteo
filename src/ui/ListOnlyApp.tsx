import { useStore } from '@/state/store';
import { SearchPanel } from './SearchPanel';
import { DetailPanel } from './DetailPanel';
import { Footer } from './Footer';
import { formatYear } from './ResultList';

/** Fallback when WebGL2 is unavailable.
 *
 *  Not a stub: the search, tree, and detail panels are already independent of the
 *  canvas, so this is the same application at full width, plus a browsable list
 *  of the whole corpus in place of the map. */
export function ListOnlyApp(): React.ReactElement {
  const books = useStore((s) => s.books);
  const query = useStore((s) => s.query);
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);

  return (
    <div className="app app--list-only">
      <p className="notice">
        Your browser does not support WebGL2, so the 3D map is unavailable. Everything else works —
        search, subject filtering, and book details.
      </p>
      <div className="list-only__body">
        <SearchPanel />
        {query.trim().length < 2 && (
          <section className="panel" aria-label="All books">
            <h2 className="panel__heading">All books</h2>
            <ul className="results">
              {books.map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    className={book.id === selectedId ? 'result result--selected' : 'result'}
                    onClick={() => select(book.id)}
                  >
                    <span className="result__title">{book.title}</span>
                    <span className="result__meta">
                      {book.authors.join(', ')} · {formatYear(book.year)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <DetailPanel />
      </div>
      <Footer />
    </div>
  );
}
