import { useEffect, useRef } from 'react';
import { useStore, bookForRef } from '@/state/store';
import { toRef, type NodeRef } from '@/domain/nodeRef';

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
  seedRef: NodeRef | null;
  path: number[];
  openRef: NodeRef | null;
}

export function parseHash(hash: string): HashState {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', search = ''] = raw.split('?');
  const params = new URLSearchParams(search);

  const parts = pathPart.split('/').filter(Boolean);
  let seedRef: NodeRef | null = null;
  let via = '';
  for (let i = 0; i < parts.length - 1; i++) {
    // A bare id with no `kind:` prefix is a book — that is what every link
    // shared before node kinds existed carries, and they must keep resolving.
    if (parts[i] === 'from') seedRef = toRef(decodeURIComponent(parts[i + 1] as string));
    if (parts[i] === 'via') via = decodeURIComponent(parts[i + 1] as string);
  }

  const path = via
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    // Non-numeric junk is dropped rather than replayed as NaN, which `expand`
    // would treat as an unknown slot and silently ignore anyway.
    .filter((n) => Number.isInteger(n) && n >= 0);

  const open = params.get('open');
  return { seedRef, path, openRef: open ? toRef(open) : null };
}

export function serializeHash(state: HashState): string {
  if (!state.seedRef) return '';
  let path = `/from/${encodeURIComponent(state.seedRef)}`;
  if (state.path.length > 0) path += `/via/${state.path.join(',')}`;
  const q = state.openRef ? `?open=${encodeURIComponent(state.openRef)}` : '';
  return `#${path}${q}`;
}

/** Two-way sync between the store and the URL hash. */
export function useUrlSync(): void {
  const applying = useRef(false);
  const lastWritten = useRef<string>('');
  // The corpus arrives asynchronously, and restoring a shared link needs it.
  // Without this the first load of a `#/from/...` URL silently did nothing,
  // because every id lookup came back undefined.
  const status = useStore((s) => s.status);

  // URL -> store
  useEffect(() => {
    if (status !== 'ready') return;
    const apply = (): void => {
      const { seedRef, path, openRef } = parseHash(window.location.hash);
      const state = useStore.getState();

      // Nothing to restore, or this is the hash we ourselves just wrote.
      if (!seedRef || !bookForRef(seedRef)) return;
      const current = serializeHash({
        seedRef: state.graph.nodes[0]?.nodeRef ?? null,
        path: state.path,
        openRef: state.selectedRef,
      });
      if (current === window.location.hash) return;

      applying.current = true;
      try {
        state.restore(seedRef, path);
        if (openRef && bookForRef(openRef)) useStore.getState().select(openRef);
      } finally {
        applying.current = false;
      }
    };

    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [status]);

  // store -> URL
  useEffect(() => {
    return useStore.subscribe((s, prev) => {
      if (applying.current) return;

      const hash = serializeHash({
        seedRef: s.graph.nodes[0]?.nodeRef ?? null,
        path: s.path,
        openRef: s.selectedRef,
      });
      if (hash === lastWritten.current) return;

      // Seeding and expanding are navigations — Back should undo them. Merely
      // opening a book replaces, so browsing details does not fill the history
      // with entries nobody wants to step through.
      const structural = s.graph.nodes[0]?.nodeRef !== prev.graph.nodes[0]?.nodeRef
        || s.path.length !== prev.path.length;

      lastWritten.current = hash;
      const url = `${window.location.pathname}${window.location.search}${hash || '#'}`;
      if (structural) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    });
  }, []);
}
