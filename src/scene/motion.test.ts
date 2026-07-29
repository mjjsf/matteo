import { describe, expect, it } from 'vitest';
import { spawnOriginFor, type Vec3 } from './motion';

const TARGET: Vec3 = [3, 4, 5];
const PARENT: Vec3 = [0, 1, 0];

describe('spawnOriginFor', () => {
  it('starts a node at its parent so growth reads as branching', () => {
    expect(spawnOriginFor(TARGET, PARENT, false)).toEqual(PARENT);
  });

  it('starts the seed at its own target — it has no parent to grow from', () => {
    expect(spawnOriginFor(TARGET, null, false)).toEqual(TARGET);
  });

  it('places a node at its TARGET under reduced motion, never at its parent', () => {
    // The regression this file exists for. Under reduced motion the tween that
    // would carry a node from parent to target is skipped, so returning the
    // parent here strands it there forever: every child lands exactly on top of
    // its parent and the whole graph collapses onto a line. Skipping the journey
    // has to mean arriving instantly, not never leaving.
    expect(spawnOriginFor(TARGET, PARENT, true)).toEqual(TARGET);
    expect(spawnOriginFor(TARGET, null, true)).toEqual(TARGET);
  });

  it('separates distinct siblings under reduced motion', () => {
    // Stated as the property that actually matters: two children of one parent
    // must not end up at the same coordinates.
    const a = spawnOriginFor([1, 0, 0], PARENT, true);
    const b = spawnOriginFor([0, 1, 0], PARENT, true);
    expect(a).not.toEqual(b);
  });
});
