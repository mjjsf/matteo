import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/state/store';
import type { Book } from '@/domain/types';
import type { NeighborsFile } from '@/domain/similarity';
import type { GraphIndexFile } from '@/domain/graphIndex';
import corpusJson from '@/generated/corpus.json';
import neighborsJson from '@/generated/neighbors.json';
import graphIndexJson from '@/generated/graph-index.json';
import { Landing } from './Landing';
import { ExplorePanel } from './ExplorePanel';
import { DetailPanel } from './DetailPanel';
import { Footer } from './Footer';
import { bookRef, idOf } from '@/domain/nodeRef';

/** The 3D scene is deliberately untested — there is no WebGL in happy-dom and
 *  asserting on three.js internals is not useful signal. What matters here is
 *  that the DOM path drives the store, because that is the path keyboard and
 *  screen-reader users take, and it must grow the same graph the canvas does. */

// Explicit cleanup: Testing Library's automatic version only registers when
// vitest globals are enabled, which they are not here.
afterEach(cleanup);

// The app fetches these two artifacts at runtime; tests install the same data
// through the same `hydrate` entry point, so both paths exercise one code path
// rather than the tests running against a parallel construction.
beforeEach(() => {
  useStore
    .getState()
    .hydrate(
      corpusJson as unknown as Book[],
      neighborsJson as unknown as NeighborsFile,
      graphIndexJson as unknown as GraphIndexFile,
    );
  useStore.getState().reset();
});

describe('Landing', () => {
  it('renders a labelled input and no map', () => {
    render(<Landing />);
    expect(screen.getByLabelText(/name a book, author or subject/i)).toBeTruthy();
    expect(useStore.getState().phase).toBe('empty');
    expect(useStore.getState().graph.nodes).toHaveLength(0);
  });

  it('typing offers suggestions', () => {
    render(<Landing />);
    fireEvent.change(screen.getByLabelText(/name a book, author or subject/i), {
      target: { value: 'neuromancer' },
    });
    expect(useStore.getState().suggestions[0]?.label).toBe('Neuromancer');
    expect(screen.getByText('Neuromancer')).toBeTruthy();
  });

  it('choosing a suggestion seeds a graph that is already branched', () => {
    render(<Landing />);
    fireEvent.change(screen.getByLabelText(/name a book, author or subject/i), {
      target: { value: 'neuromancer' },
    });
    fireEvent.click(screen.getByText('Neuromancer'));

    const state = useStore.getState();
    expect(state.phase).toBe('active');
    expect(state.graph.nodes[0]?.nodeRef).toBe(bookRef('neuromancer'));
    // A lone point is not a map: seeding must expand once immediately.
    expect(state.graph.nodes.length).toBeGreaterThan(1);
    expect(state.selectedRef).toBe(bookRef('neuromancer'));
  });

  it('says so when nothing matches instead of seeding something arbitrary', () => {
    render(<Landing />);
    fireEvent.change(screen.getByLabelText(/name a book, author or subject/i), {
      target: { value: 'qqqqzzzz' },
    });
    expect(screen.getByRole('status').textContent).toMatch(/nothing in the collection matches/i);
    expect(useStore.getState().phase).toBe('empty');
  });
});

/** Growing from the outline is two steps now: open the axis menu, then pick an
 *  axis. The menu is the point — with four grains there are several honest
 *  answers to "what is next to this", so the reader chooses rather than the app
 *  guessing. */
const growFirst = (): void => {
  fireEvent.click(screen.getAllByRole('button', { name: /ways to grow from/i })[0] as HTMLElement);
  fireEvent.click(screen.getAllByRole('button', { name: /related titles/i })[0] as HTMLElement);
};

describe('GraphOutline', () => {
  beforeEach(() => {
    useStore.getState().seed(bookRef('neuromancer'));
  });

  it('mirrors every node on the map', () => {
    render(<ExplorePanel />);
    const state = useStore.getState();
    for (const node of state.graph.nodes) {
      const title = state.books[state.corpusIndexOf.get(idOf(node.nodeRef)) as number]?.title as string;
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  it('growing from the list adds the same nodes a click would', () => {
    render(<ExplorePanel />);
    const before = useStore.getState().graph.nodes.length;
    growFirst();
    expect(useStore.getState().graph.nodes.length).toBeGreaterThan(before);
  });

  it('leaves already-placed positions untouched when a generation is added', () => {
    render(<ExplorePanel />);
    const before = useStore.getState().graph.nodes.map((n) => [...n.target]);
    growFirst();
    const after = useStore.getState().graph.nodes.slice(0, before.length).map((n) => n.target);
    // Bit-identical, not merely close: this is the property that stops the map
    // rearranging itself under someone mid-exploration.
    expect(after).toEqual(before);
  });
});

describe('collapsing from the list', () => {
  beforeEach(() => {
    useStore.getState().seed(bookRef('neuromancer'));
  });


  it('offers a hide control only once a book has been grown', () => {
    render(<ExplorePanel />);
    expect(screen.queryAllByRole('button', { name: /hide what was grown from/i })).toHaveLength(0);
    growFirst();
    expect(
      screen.getAllByRole('button', { name: /hide what was grown from/i }).length,
    ).toBeGreaterThan(0);
  });

  it('removes exactly what was grown, and leaves the rest where it was', () => {
    render(<ExplorePanel />);
    const before = useStore.getState().graph.nodes.map((n) => [n.nodeRef, [...n.target]] as const);

    growFirst();
    expect(useStore.getState().graph.nodes.length).toBeGreaterThan(before.length);

    fireEvent.click(
      screen.getAllByRole('button', { name: /hide what was grown from/i })[0] as HTMLElement,
    );

    const after = useStore.getState().graph.nodes;
    expect(after).toHaveLength(before.length);
    // Same books, same coordinates — collapsing one branch must not shuffle the map.
    expect(after.map((n) => [n.nodeRef, n.target])).toEqual(
      before.map(([id, t]) => [id, t]),
    );
  });

  it('never leaves the seed collapsible, so the map cannot vanish', () => {
    render(<ExplorePanel />);
    const seedRow = screen.queryAllByRole('button', { name: /hide what was grown from neuroman/i });
    expect(seedRow).toHaveLength(0);
  });

  it('keeps the expansion path replayable after a collapse', () => {
    render(<ExplorePanel />);
    growFirst();
    fireEvent.click(
      screen.getAllByRole('button', { name: /hide what was grown from/i })[0] as HTMLElement,
    );
    // Every remaining slot in the path must still address a real node, or a
    // shared link would replay into a different graph.
    const { path, graph } = useStore.getState();
    for (const step of path) expect(graph.nodes[step.slot]).toBeDefined();
  });
});

describe('DetailPanel', () => {
  it('renders nothing when no book is selected', () => {
    const { container } = render(<DetailPanel />);
    expect(container.querySelector('.panel--detail')).toBeNull();
  });

  it('renders an honest Bookshop link for a book with no ISBN', () => {
    useStore.getState().seed(bookRef('neuromancer'));
    render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    // No book in the corpus carries an ISBN, so this is not a fallback that
    // rarely fires — it is every link in the app. It must be labelled as a
    // search rather than promising a product page.
    const href = new URL(link.getAttribute('href') as string);
    expect(href.host).toBe('bookshop.org');
    expect(href.searchParams.get('keywords')).toContain('Neuromancer');
    expect(link.textContent).toContain('Find on Bookshop');
  });

  it('does not mark a search link sponsored, because it can earn nothing', () => {
    // Bookshop attributes through the `/a/{id}` path segment, which a search URL
    // has nowhere to carry. `rel="sponsored"` on a link that cannot pay a
    // commission is a false statement about a commercial relationship — quiet,
    // but still false. The old Amazon link asserted it unconditionally.
    useStore.getState().seed(bookRef('neuromancer'));
    const { container } = render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.getAttribute('rel')).not.toContain('sponsored');
    expect(link.getAttribute('href')).not.toContain('/a/');
    // And nothing in the panel may claim price, stock or availability, none of
    // which this side knows.
    expect(container.textContent).not.toMatch(/in stock|available now|ships/i);
  });

  it('withholds the affiliate disclosure when there is no affiliate', () => {
    // The disclosure used to render unconditionally, so with no id configured —
    // which is the state of this test run and of the deployed site — the app
    // told every visitor it earned commission on their purchases while earning
    // nothing. The requirement to disclose a real relationship is unchanged;
    // asserting one that does not exist is what stopped.
    const { container } = render(<Footer />);
    expect(container.textContent).not.toMatch(/commission/i);
  });
});
