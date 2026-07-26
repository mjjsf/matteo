import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStore } from '@/state/store';

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const FLY_MS = 800;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** Orbit controls plus a camera fly-to.
 *
 *  The destination is derived from the CURRENT view direction rather than a
 *  fixed offset:
 *      to.position = target + normalize(camera.position - target) * distance
 *  That preserves the user's orientation and changes only the framing, which is
 *  what keeps the move from being disorienting. A fixed offset would swing the
 *  camera to an arbitrary side on every selection. */
export function CameraRig({ radius }: { radius: number }): React.ReactElement {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const flyTarget = useStore((s) => s.flyTarget);

  const anim = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
  } | null>(null);

  const userInteracted = useRef(false);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !flyTarget) return;

    const target = new THREE.Vector3(...flyTarget.position);
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize();

    const to = target.clone().add(direction.multiplyScalar(flyTarget.distance));

    if (prefersReducedMotion()) {
      camera.position.copy(to);
      controls.target.copy(target);
      controls.update();
      return;
    }

    anim.current = {
      from: camera.position.clone(),
      to,
      fromTarget: controls.target.clone(),
      toTarget: target,
      start: performance.now(),
    };
  }, [flyTarget, camera]);

  // Cancel any running tween the moment the user grabs the camera — never trap
  // them mid-animation.
  useEffect(() => {
    const cancel = (): void => {
      anim.current = null;
      userInteracted.current = true;
    };
    window.addEventListener('pointerdown', cancel);
    window.addEventListener('wheel', cancel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', cancel);
      window.removeEventListener('wheel', cancel);
    };
  }, []);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const a = anim.current;
    if (a) {
      const t = Math.min(1, (performance.now() - a.start) / FLY_MS);
      const e = easeInOutCubic(t);
      camera.position.lerpVectors(a.from, a.to, e);
      controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      controls.update();
      if (t >= 1) anim.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enablePan
      minDistance={radius * 0.05}
      maxDistance={radius * 6}
      // Gentle drift on load to convey depth, stopped for good on first
      // interaction and disabled entirely under reduced-motion.
      autoRotate={!prefersReducedMotion() && !userInteracted.current}
      autoRotateSpeed={0.25}
      makeDefault
    />
  );
}
