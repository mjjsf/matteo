import { useEffect } from 'react';
import { useStore, bookById } from '@/state/store';
import { SOFT_CAP } from '@/domain/graph';
import { GraphOutline } from './GraphOutline';

/** The sidebar once a map exists: what you started from, how far it has grown,
 *  and the DOM mirror of the graph.
 *
 *  There is deliberately no search box here. Searching mid-exploration would
 *  mean either abandoning the map or growing a second disconnected one, and both
 *  are worse than the explicit "start over" this offers. */
export function ExplorePanel(): React.ReactElement {
  const graph = useStore((s) => s.graph);
  const notice = useStore((s) => s.notice);
  const reset = useStore((s) => s.reset);
  const dismissNotice = useStore((s) => s.dismissNotice);

  const seedId = graph.nodes[0]?.bookId;
  const seedBook = seedId ? bookById(seedId) : undefined;
  const count = graph.nodes.length;

  useEffect(() => {
    if (!notice) return;
    // Auto-dismiss: this is an explanation of a click that did nothing, not an
    // error someone has to acknowledge.
    const timer = setTimeout(dismissNotice, 6000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  return (
    <section className="panel panel--explore" aria-labelledby="explore-heading">
      <div className="panel__head">
        <h1 id="explore-heading" className="brand">
          matteo
        </h1>
        <button type="button" className="panel__reset" onClick={reset}>
          Start over
        </button>
      </div>

      {seedBook && (
        <p className="explore__seed">
          Books near <strong>{seedBook.title}</strong>
        </p>
      )}

      <p className="explore__count" aria-live="polite">
        {count} of {SOFT_CAP} · open a book to grow the map from it
      </p>

      {notice && (
        <p className="explore__notice" role="status">
          {notice}
        </p>
      )}

      <GraphOutline />
    </section>
  );
}
