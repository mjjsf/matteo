import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/state/store';
import { SearchPanel } from './SearchPanel';
import { DetailPanel } from './DetailPanel';

/** Two smoke tests only. The 3D scene is deliberately untested — there is no
 *  WebGL in happy-dom and asserting on three.js internals is not useful signal.
 *  What matters here is that the DOM path drives the store, because that is the
 *  path keyboard and screen-reader users take. */

// Explicit cleanup: Testing Library's automatic version only registers when
// vitest globals are enabled, which they are not here.
afterEach(cleanup);

beforeEach(() => {
  useStore.setState({
    query: '',
    results: [],
    matchedIds: null,
    searchTree: [],
    selectedId: null,
    activeBranchId: null,
    hoveredId: null,
    focusedResultIndex: -1,
  });
});

describe('SearchPanel', () => {
  it('renders a labelled search input', () => {
    render(<SearchPanel />);
    expect(screen.getByLabelText(/search titles, authors, subjects/i)).toBeTruthy();
  });

  it('typing filters the corpus and lists results', () => {
    render(<SearchPanel />);
    const input = screen.getByLabelText(/search titles, authors, subjects/i);
    fireEvent.change(input, { target: { value: 'neuromancer' } });

    const state = useStore.getState();
    expect(state.results.length).toBeGreaterThan(0);
    expect(state.matchedIds).not.toBeNull();
    expect(state.results[0]?.book.title).toBe('Neuromancer');
    expect(screen.getByText('Neuromancer')).toBeTruthy();
  });

  it('builds a tag tree from the results', () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByLabelText(/search titles, authors, subjects/i), {
      target: { value: 'cyberpunk' },
    });
    expect(useStore.getState().searchTree.length).toBeGreaterThan(0);
  });

  it('clearing the query restores everything rather than hiding it', () => {
    render(<SearchPanel />);
    const input = screen.getByLabelText(/search titles, authors, subjects/i);
    fireEvent.change(input, { target: { value: 'cyberpunk' } });
    expect(useStore.getState().matchedIds).not.toBeNull();

    fireEvent.change(input, { target: { value: '' } });
    // null, not an empty Set — otherwise the whole corpus would be dimmed.
    expect(useStore.getState().matchedIds).toBeNull();
    expect(useStore.getState().searchTree).toEqual([]);
  });

  it('selecting a result updates the store', () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByLabelText(/search titles, authors, subjects/i), {
      target: { value: 'neuromancer' },
    });
    fireEvent.click(screen.getByText('Neuromancer'));
    expect(useStore.getState().selectedId).toBe('neuromancer');
  });
});

describe('DetailPanel', () => {
  it('renders nothing when no book is selected', () => {
    const { container } = render(<DetailPanel />);
    expect(container.querySelector('.panel--detail')).toBeNull();
  });

  it('renders an honest Amazon link for a book with no ISBN', () => {
    useStore.getState().select('neuromancer');
    render(<DetailPanel />);
    const link = screen.getByRole('link') as HTMLAnchorElement;
    // The seed corpus carries no fabricated ISBNs, so this must be the search
    // fallback and must be labelled as such rather than promising a product page.
    expect(link.getAttribute('href')).toContain('/s?');
    expect(link.getAttribute('rel')).toContain('sponsored');
    expect(link.textContent).toContain('Find on Amazon');
  });

  it('never claims Prime eligibility', () => {
    useStore.getState().select('neuromancer');
    const { container } = render(<DetailPanel />);
    expect(container.textContent?.toLowerCase()).not.toContain('prime');
  });

  it('shows the affiliate disclosure', () => {
    useStore.getState().select('neuromancer');
    const { container } = render(<DetailPanel />);
    expect(container.textContent).toContain('Amazon Associate');
  });
});
