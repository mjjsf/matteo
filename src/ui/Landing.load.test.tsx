import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Book } from '@/domain/types';
import type { NeighborsFile } from '@/domain/similarity';
import type { GraphIndexFile } from '@/domain/graphIndex';
import corpusJson from '@/generated/corpus.json';
import neighborsJson from '@/generated/neighbors.json';
import graphIndexJson from '@/generated/graph-index.json';
import { bookRef } from '@/domain/nodeRef';

/** The landing input during the corpus download.
 *
 *  This window used to have no input in it at all: the app replaced the whole
 *  screen with "Loading the books…" until both JSON artifacts had arrived, and
 *  `setQuery` discarded keystrokes while there was no search index.
 *
 *  Testing it needs the genuine pre-load state, and the corpus index is
 *  module-level state in the store with no un-hydrate. So the module registry is
 *  reset before each test and the store and component are imported fresh —
 *  together, so they share one instance. Hydration then happens inside each test
 *  at the point the fetch would have resolved. `ExplorePanel.test.tsx` covers
 *  the same component from the opposite side, already loaded. */

type Store = typeof import('@/state/store').useStore;
let useStore: Store;
let Landing: typeof import('./Landing').Landing;

beforeEach(async () => {
  vi.resetModules();
  ({ useStore } = await import('@/state/store'));
  ({ Landing } = await import('./Landing'));
});

// Explicit cleanup: Testing Library's automatic version only registers when
// vitest globals are enabled, which they are not here.
afterEach(cleanup);

/** Stands in for the fetch resolving. Wrapped in `act` because the arrival has
 *  to reach the DOM, not just the store — the whole point is that the list
 *  appears without another keystroke. */
const hydrate = (): void => {
  act(() => {
    useStore
      .getState()
      .hydrate(
      corpusJson as unknown as Book[],
      neighborsJson as unknown as NeighborsFile,
      graphIndexJson as unknown as GraphIndexFile,
    );
  });
};

const input = (): HTMLInputElement =>
  screen.getByLabelText(/name a book, author or subject/i) as HTMLInputElement;

describe('Landing before the corpus arrives', () => {
  it('offers a usable input rather than a loading screen', () => {
    expect(useStore.getState().status).toBe('loading');
    render(<Landing />);
    expect(input()).toBeTruthy();
  });

  it('keeps what you type while the corpus is still downloading', () => {
    // The input is controlled on `query`. `setQuery` used to return early when
    // there was no index, which dropped the keystroke and left the field looking
    // broken rather than merely slow.
    render(<Landing />);
    fireEvent.change(input(), { target: { value: 'neuroman' } });
    expect(input().value).toBe('neuroman');
    expect(useStore.getState().query).toBe('neuroman');
  });

  it('does not claim there is no match while the books are still loading', () => {
    render(<Landing />);
    fireEvent.change(input(), { target: { value: 'neuromancer' } });
    expect(screen.queryByText(/nothing in the collection matches/i)).toBeNull();
  });

  it('populates the list on arrival, against what was already typed', () => {
    // The point of the whole change: no second keystroke required.
    render(<Landing />);
    fireEvent.change(input(), { target: { value: 'neuromancer' } });
    expect(useStore.getState().suggestions).toHaveLength(0);

    hydrate();

    expect(useStore.getState().suggestions.length).toBeGreaterThan(0);
    expect(useStore.getState().suggestions[0]?.label).toMatch(/neuromancer/i);
    expect(screen.getByRole('option', { name: /neuromancer/i })).toBeTruthy();
  });

  it('honours a submit made before the corpus landed', () => {
    render(<Landing />);
    fireEvent.change(input(), { target: { value: 'neuromancer' } });
    // Dispatched straight at the form, because there is no longer a submit
    // button to click. Note what this therefore does NOT prove: happy-dom does
    // not implement HTML implicit submission, so that Enter reaches this handler
    // at all is checked in a real browser, not here.
    fireEvent.submit(input().closest('form')!);
    // Nothing to seed from yet, but the intent is remembered rather than lost.
    expect(useStore.getState().phase).toBe('empty');
    expect(useStore.getState().seedWhenReady).toBe(true);

    hydrate();

    expect(useStore.getState().phase).toBe('active');
    expect(useStore.getState().seedWhenReady).toBe(false);
    expect(useStore.getState().graph.nodes[0]?.nodeRef).toBe(bookRef('neuromancer'));
  });

  it('does not seed on arrival when nothing was submitted', () => {
    render(<Landing />);
    fireEvent.change(input(), { target: { value: 'neuromancer' } });
    hydrate();
    expect(useStore.getState().phase).toBe('empty');
  });
});
