import { lazy } from 'react';

/** The one place that names the split point.
 *
 *  This module must NOT import `MapStage` statically, or three.js lands back in
 *  the main chunk and the split silently stops working while everything still
 *  compiles and runs. The dynamic import is the boundary; keeping the `lazy`
 *  wrapper and the preload beside each other means there is exactly one line to
 *  get wrong instead of two files to keep in agreement. */
const load = (): Promise<typeof import('./MapStage')> => import('./MapStage');

export const MapStage = lazy(load);

/** Start fetching the chunk before it is needed.
 *
 *  Called as soon as someone types into the landing input, so the renderer has
 *  usually arrived by the time they press Enter and the split costs no
 *  perceptible delay. Safe to call repeatedly — the module registry dedupes. */
export function preloadMapStage(): void {
  void load();
}
