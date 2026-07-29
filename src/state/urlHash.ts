import { useEffect, useRef } from 'react';
import { useStore, bookById } from '@/state/store';

/** Hash routing, deliberately — GitHub Pages has no rewrite rules, so path
 *  routing would 404 on refresh or on a shared deep link.
 *
 *  Shape: `#/from/{seedBookId}` plus optionally `/via/{slot,slot,…}` and
 *  `?open={bookId}`.
 *
 *  The `via` list is the point. A link carrying only the seed would restore a
 *  starting book and throw away the exploration someone actually wanted to
 *  share. Placement is fully deterministic, so replaying the seed and then those
 *  expansions in order reproduces the identical graph — which is why the slots
 *  are worth the extra characters. */
export interface HashState {
  seedId: string | null;
  path: number[];
  openId: string | null;
}

export function parseHash(hash: string): HashState {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', search = ''] = raw.split('?');
  const params = new URLSearchParams(search);

  const parts = pathPart.split('/').filter(Boolean);
  let seedId: string | null = null;
  let via = '';
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'from') seedId = decodeURIComponent(parts[i + 1] as string);
    if (parts[i] === 'via') via = decodeURIComponent(parts[i + 1] as string);
  }

  const path = via
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    // Non-numeric junk is dropped rather than replayed as NaN, which `expand`
    // would treat as an unknown slot and silently ignore anyway.
    .filter((n) => Number.isInteger(n) && n >= 0);

  return { seedId, path, openId: params.get('open') };
}

export function serializeHash(state: HashState): string {
  if (!state.seedId) return '';
  let path = `/from/${encodeURIComponent(state.seedId)}`;
  if (state.path.length > 0) path += `/via/${state.path.join(',')}`;
  const q = state.openId ? `?open=${encodeURIComponent(state.openId)}` : '';
  return `#${path}${q}`;
}

/** Two-way sync between the store and the URL hash. */
export function useUrlSync(): void {
  const applying = useRef(false);
  const lastWritten = useRef<string>('');

  // URL -> store
  useEffect(() => {
    const apply = (): void => {
      const { seedId, path, openId } = parseHash(window.location.hash);
      const state = useStore.getState();

      // Nothing to restore, or this is the hash we ourselves just wrote.
      if (!seedId || !bookById(seedId)) return;
      const current = serializeHash({
        seedId: state.graph.nodes[0]?.bookId ?? null,
        path: state.path,
        openId: state.selectedId,
      });
      if (current === window.location.hash) return;

      applying.current = true;
      try {
        state.restore(seedId, path);
        if (openId && bookById(openId)) useStore.getState().select(openId);
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
    return useStore.subscribe((s, prev) => {
      if (applying.current) return;

      const hash = serializeHash({
        seedId: s.graph.nodes[0]?.bookId ?? null,
        path: s.path,
        openId: s.selectedId,
      });
      if (hash === lastWritten.current) return;

      // Seeding and expanding are navigations — Back should undo them. Merely
      // opening a book replaces, so browsing details does not fill the history
      // with entries nobody wants to step through.
      const structural = s.graph.nodes[0]?.bookId !== prev.graph.nodes[0]?.bookId
        || s.path.length !== prev.path.length;

      lastWritten.current = hash;
      const url = `${window.location.pathname}${window.location.search}${hash || '#'}`;
      if (structural) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    });
  }, []);
}
