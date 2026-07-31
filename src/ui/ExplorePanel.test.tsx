import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/state/store';
import type { Book } from '@/domain/types';
import type { NeighborsFile } from '@/domain/similarity';
import corpusJson from '@/generated/corpus.json';
import neighborsJson from '@/generated/neighbors.json';
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
    .hydrate(corpusJson as unknown as Book[], neighborsJson as unknown as NeighborsFile);
  useStore.getState().reset();
});

describe('Landing', () => {
  it('renders a labelled input and no map', () => {
    render(<Landing />);
    expect(screen.getByLabelText(/name a book to start from/i)).toBeTruthy();
    expect(useStore.getState().phase).toBe('empty');
    expect(useStore.getState().graph.nodes).toHaveLength(0);
  });

  it('typing offers suggestions', () => {
    render(<Landing />);
    fireEvent.change(screen.getByLabelText(/name a book to start from/i), {
      target: { value: 'neuromancer' },
    });
    expect(useStore.getState().suggestions[0]?.book.title).toBe('Neuromancer');
    expect(screen.getByText('Neuromancer')).toBeTruthy();
  });

  it('choosing a suggestion seeds a graph that is already branched', () => {
    render(<Landing />);
    fireEvent.change(screen.getByLabelText(/name a book to start from/i), {
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
    fireEvent.change(screen.getByLabelText(/name a book to start from/i), {
      target: { value: 'qqqqzzzz' },
    });
    expect(screen.getByRole('status').textContent).toMatch(/no book/i);
    expect(useStore.getState().phase).toBe('empty');
  });
});

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
    const grow = screen.getAllByRole('button', { name: /show books similar to/i })[0];
    expect(grow).toBeTruthy();
    fireEvent.click(grow as HTMLElement);
    expect(useStore.getState().graph.nodes.length).toBeGreaterThan(before);
  });

  it('leaves already-placed positions untouched when a generation is added', () => {
    render(<ExplorePanel />);
    const before = useStore.getState().graph.nodes.map((n) => [...n.target]);
    fireEvent.click(
      screen.getAllByRole('button', { name: /show books similar to/i })[0] as HTMLElement,
    );
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

  const growFirst = (): void => {
    fireEvent.click(
      screen.getAllByRole('button', { name: /show books similar to/i })[0] as HTMLElement,
    );
  };

  it('offers a hide control only once a book has been grown', () => {
    render(<ExplorePanel />);
    expect(screen.queryAllByRole('button', { name: /hide the books grown from/i })).toHaveLength(0);
    growFirst();
    expect(
      screen.getAllByRole('button', { name: /hide the books grown from/i }).length,
    ).toBeGreaterThan(0);
  });

  it('removes exactly what was grown, and leaves the rest where it was', () => {
    render(<ExplorePanel />);
    const before = useStore.getState().graph.nodes.map((n) => [n.nodeRef, [...n.target]] as const);

    growFirst();
    expect(useStore.getState().graph.nodes.length).toBeGreaterThan(before.length);

    fireEvent.click(
      screen.getAllByRole('button', { name: /hide the books grown from/i })[0] as HTMLElement,
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
    const seedRow = screen.queryAllByRole('button', { name: /hide the books grown from neuroman/i });
    expect(seedRow).toHaveLength(0);
  });

  it('keeps the expansion path replayable after a collapse', () => {
    render(<ExplorePanel />);
    growFirst();
    fireEvent.click(
      screen.getAllByRole('button', { name: /hide the books grown from/i })[0] as HTMLElement,
    );
    // Every remaining slot in the path must still address a real node, or a
    // shared link would replay into a different graph.
    const { path, graph } = useStore.getState();
    for (const slot of path) expect(graph.nodes[slot]).toBeDefined();
  });
});

describe('DetailPanel', () => {
  it('renders nothing when no book is selected', () => {
    const { container } = render(<DetailPanel />);
    expect(container.querySelector('.panel--detail')).toBeNull();
  });

  it('renders an honest Amazon link for a book with no ISBN', () => {
    useStore.getState().seed(bookRef('neuromancer'));
    render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    // The seed corpus carries no fabricated ISBNs, so this must be the search
    // fallback and must be labelled as such rather than promising a product page.
    expect(link.getAttribute('href')).toContain('/s?');
    expect(link.getAttribute('rel')).toContain('sponsored');
    expect(link.textContent).toContain('Find on Amazon');
  });

  it('asks Amazon to filter to Prime without claiming eligibility itself', () => {
    useStore.getState().seed(bookRef('neuromancer'));
    const { container } = render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    // The refinement travels in the URL, where Amazon acts on it.
    expect(link.getAttribute('href')).toContain('rh=');
    // The explainer line under the button is gone, so there is no longer any
    // prose here describing the filter — which makes the negative the whole
    // guarantee, and the one worth asserting: the panel must never state that
    // this particular book ships with Prime. Nothing in the UI may say it does.
    expect(container.textContent).not.toMatch(/eligible for prime|ships with prime|prime shipping/i);
    expect(container.textContent).not.toMatch(/prime/i);
  });

  it('carries the affiliate disclosure in the footer on every screen', () => {
    // It used to be repeated inside the detail panel as well. That duplicate is
    // gone; the requirement is not, so the assertion moved to where the single
    // remaining copy lives rather than being deleted with it.
    const { container } = render(<Footer />);
    expect(container.textContent).toContain('Amazon Associate');
  });
});
