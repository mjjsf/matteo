import { useEffect } from 'react';
import { useStore } from '@/state/store';

/** Global keyboard handling.
 *
 *  Escape unwinds ONE level per press — selection, then branch filter, then the
 *  query. Clearing all three at once is the kind of thing that is annoying every
 *  single time, because the user almost always means "back out a step". */
export function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const changed = useStore.getState().escape();
      if (changed) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
