import { useEffect, useRef } from 'react';
import { useStore } from '@/state/store';

/** Hash routing, deliberately — GitHub Pages has no rewrite rules, so path
 *  routing would 404 on refresh or on a shared deep link.
 *
 *  Shapes: `#/book/{id}`, `#/branch/{nodeId}`, `#/branch/{nodeId}/book/{id}`,
 *  each optionally with `?q=…`. */
export interface HashState {
  bookId: string | null;
  branchId: string | null;
  query: string;
}

export function parseHash(hash: string): HashState {
  const raw = hash.replace(/^#/, '');
  const [path = '', search = ''] = raw.split('?');
  const params = new URLSearchParams(search);
  const query = params.get('q') ?? '';

  const parts = path.split('/').filter(Boolean);
  let bookId: string | null = null;
  let branchId: string | null = null;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'book') bookId = decodeURIComponent(parts[i + 1] as string);
    if (parts[i] === 'branch') branchId = decodeURIComponent(parts[i + 1] as string);
  }
  return { bookId, branchId, query };
}

export function serializeHash(state: HashState): string {
  let path = '';
  if (state.branchId) path += `/branch/${encodeURIComponent(state.branchId)}`;
  if (state.bookId) path += `/book/${encodeURIComponent(state.bookId)}`;
  const q = state.query.trim() ? `?q=${encodeURIComponent(state.query.trim())}` : '';
  return path || q ? `#${path}${q}` : '';
}

const DEBOUNCE_MS = 300;

/** Two-way sync between the store and the URL hash. */
export function useUrlSync(): void {
  const applying = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWritten = useRef<string>('');

  // URL -> store
  useEffect(() => {
    const apply = (): void => {
      const { bookId, branchId, query } = parseHash(window.location.hash);
      const state = useStore.getState();
      applying.current = true;
      try {
        if (query !== state.query) state.setQuery(query);
        // Unknown ids are ignored silently rather than throwing.
        if (branchId !== state.activeBranchId) {
          state.setActiveBranch(state.taxonomy.byId.has(branchId ?? '') ? branchId : null);
        }
        if (bookId !== state.selectedId) {
          state.select(state.byId.has(bookId ?? '') ? bookId : null, { fly: true });
        }
      } finally {
        applying.current = false;
      }
    };

    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // store -> URL
  useEffect(() => {
    const write = (replace: boolean, hash: string): void => {
      if (hash === lastWritten.current) return;
      lastWritten.current = hash;
      const url = `${window.location.pathname}${window.location.search}${hash || '#'}`;
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    };

    return useStore.subscribe((s, prev) => {
      if (applying.current) return;

      const hash = serializeHash({
        bookId: s.selectedId,
        branchId: s.activeBranchId,
        query: s.query,
      });

      // Selections and branch changes are navigations — Back should undo them.
      // Query keystrokes are not, or typing would create dozens of entries.
      const structural =
        s.selectedId !== prev.selectedId || s.activeBranchId !== prev.activeBranchId;

      if (structural) {
        if (timer.current) clearTimeout(timer.current);
        write(false, hash);
        return;
      }

      if (s.query !== prev.query) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => write(true, hash), DEBOUNCE_MS);
      }
    });
  }, []);
}
