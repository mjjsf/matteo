import { useEffect } from 'react';
import { useStore, describeRef } from '@/state/store';
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
  const fitAll = useStore((s) => s.fitAll);
  const dismissNotice = useStore((s) => s.dismissNotice);

  const seedRef = graph.nodes[0]?.nodeRef;
  const seedAbout = seedRef ? describeRef(seedRef) : null;
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
        {/* The wordmark is on the landing screen; repeating it here spent the top
            of the panel on something the reader already knows. The seed line
            below carries `explore-heading` instead — both this panel's
            `aria-labelledby` and the skip-link in App.tsx target that id, and it
            is a better label for the panel than the app's own name was. */}
        <h1 id="explore-heading" className="explore__seed">
          {seedAbout ? (
            <>
              Books near <strong>{seedAbout.label}</strong>
            </>
          ) : (
            'Books on the map'
          )}
        </h1>
        <div className="panel__actions">
          <button type="button" className="panel__link panel__link--solid" onClick={fitAll}>
            Fit map
          </button>
          <button type="button" className="panel__link panel__link--solid" onClick={reset}>
            Start over
          </button>
        </div>
      </div>

      {/* The count line is gone from the page, but not from the announcement:
          growing the map is the main thing that happens here, and a screen
          reader needs to hear that it changed. Capacity is still explained by
          `notice` when it is actually reached. */}
      <p className="visually-hidden" aria-live="polite">
        {count} of {SOFT_CAP} books on the map
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
