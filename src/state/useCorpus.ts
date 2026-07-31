import { useEffect } from 'react';
import { useStore } from './store';
import { fetchCorpusData } from './corpusData';

/** Load the corpus once, on mount.
 *
 *  Guarded by the store's own status rather than by a ref, so React 18's
 *  double-invoked effects in development do not fetch twice. */
export function useCorpus(): void {
  useEffect(() => {
    if (useStore.getState().status !== 'loading') return;
    let cancelled = false;

    fetchCorpusData()
      .then(({ books, neighbors, graphIndex }) => {
        if (!cancelled) useStore.getState().hydrate(books, neighbors, graphIndex);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Surfaced rather than swallowed: without the corpus there is no app at
        // all, so a silent empty state would be a mystery rather than a bug.
        const message = error instanceof Error ? error.message : String(error);
        console.error('Could not load the book corpus:', error);
        useStore.getState().failToLoad(message);
      });

    return () => {
      cancelled = true;
    };
  }, []);
}
