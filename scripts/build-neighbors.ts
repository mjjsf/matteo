/** Entry point for `npm run neighbors`.
 *
 *  Deliberately trivial: everything lives in `scripts/lib/neighbors.ts`, which
 *  performs no work on import. See the note there for what that separation is
 *  protecting against. */
import { buildNeighbors } from './lib/neighbors';

buildNeighbors();
