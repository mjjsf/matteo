import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/state/store';
import { Landing } from './Landing';
import { ExplorePanel } from './ExplorePanel';
import { DetailPanel } from './DetailPanel';

/** The 3D scene is deliberately untested — there is no WebGL in happy-dom and
 *  asserting on three.js internals is not useful signal. What matters here is
 *  that the DOM path drives the store, because that is the path keyboard and
 *  screen-reader users take, and it must grow the same graph the canvas does. */

// Explicit cleanup: Testing Library's automatic version only registers when
// vitest globals are enabled, which they are not here.
afterEach(cleanup);

beforeEach(() => {
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
    expect(state.graph.nodes[0]?.bookId).toBe('neuromancer');
    // A lone point is not a map: seeding must expand once immediately.
    expect(state.graph.nodes.length).toBeGreaterThan(1);
    expect(state.selectedId).toBe('neuromancer');
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
    useStore.getState().seed('neuromancer');
  });

  it('mirrors every node on the map', () => {
    render(<ExplorePanel />);
    const state = useStore.getState();
    for (const node of state.graph.nodes) {
      const title = state.books[state.corpusIndexOf.get(node.bookId) as number]?.title as string;
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

describe('DetailPanel', () => {
  it('renders nothing when no book is selected', () => {
    const { container } = render(<DetailPanel />);
    expect(container.querySelector('.panel--detail')).toBeNull();
  });

  it('renders an honest Amazon link for a book with no ISBN', () => {
    useStore.getState().seed('neuromancer');
    render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    // The seed corpus carries no fabricated ISBNs, so this must be the search
    // fallback and must be labelled as such rather than promising a product page.
    expect(link.getAttribute('href')).toContain('/s?');
    expect(link.getAttribute('rel')).toContain('sponsored');
    expect(link.textContent).toContain('Find on Amazon');
  });

  it('asks Amazon to filter to Prime without claiming eligibility itself', () => {
    useStore.getState().seed('neuromancer');
    const { container } = render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    // The refinement travels in the URL...
    expect(link.getAttribute('href')).toContain('rh=');
    // ...and the page describes what the link ASKS FOR, never asserting that
    // this particular book ships with Prime.
    expect(container.textContent).toContain('filtered to Prime-eligible results');
    expect(container.textContent).not.toMatch(/eligible for prime|ships with prime|prime shipping/i);
  });

  it('shows the affiliate disclosure', () => {
    useStore.getState().seed('neuromancer');
    const { container } = render(<DetailPanel />);
    expect(container.textContent).toContain('Amazon Associate');
  });
});
