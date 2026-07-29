import { useStore } from '@/state/store';
import { Landing } from './Landing';
import { ExplorePanel } from './ExplorePanel';
import { DetailPanel } from './DetailPanel';
import { Footer } from './Footer';

/** Fallback when WebGL2 is unavailable.
 *
 *  Not a stub, and not a different app: the landing input, the graph outline and
 *  the detail panel are all independent of the canvas and drive the same store,
 *  so this is the same exploration at full width with the map left out. Growing
 *  the graph, opening books and buying them all still work. */
export function ListOnlyApp(): React.ReactElement {
  const phase = useStore((s) => s.phase);

  if (phase === 'empty') {
    return (
      <div className="app app--list-only">
        <p className="notice">
          Your browser does not support WebGL2, so the 3D map is unavailable. Everything else works
          — you can still explore books by similarity as a list.
        </p>
        <Landing />
        <Footer />
      </div>
    );
  }

  return (
    <div className="app app--list-only">
      <p className="notice">
        Your browser does not support WebGL2, so the 3D map is unavailable. The list below is the
        same set of books, in the same order.
      </p>
      <div className="list-only__body">
        <ExplorePanel />
        <DetailPanel />
      </div>
      <Footer />
    </div>
  );
}
