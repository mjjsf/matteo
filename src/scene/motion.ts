/** Shared reduced-motion check.
 *
 *  Lives on its own because three separate places need it now — the camera
 *  tween, the node spawn animation, and the label transitions. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export type Vec3 = readonly [number, number, number];

/** Where a newly placed node's first written position should be.
 *
 *  Normally its parent's position, so the node eases outward and growth reads as
 *  branching rather than as things blinking into existence. Under reduced motion
 *  it is the node's own target.
 *
 *  That second case is the whole reason this is a named function rather than two
 *  lines inline. Writing the parent position and *also* skipping the tween is not
 *  "the animation minus the animation" — it is a node that departs and never
 *  arrives. It shipped that way once: every child sat exactly on top of its
 *  parent, so the whole graph collapsed onto a single line for anyone who had
 *  asked for less motion. Nothing threw, and no existing test could see it,
 *  because the scene is deliberately untested. Hence a pure helper stating the
 *  rule once, with a test on it. */
export function spawnOriginFor(target: Vec3, parentTarget: Vec3 | null, reduced: boolean): Vec3 {
  if (reduced) return target;
  return parentTarget ?? target;
}
