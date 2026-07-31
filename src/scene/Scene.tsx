import { useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemeColors } from '@/domain/palette';
import { useStore } from '@/state/store';
import { EDGE_LEN } from '@/domain/graph';
import { CameraRig } from './CameraRig';
import { GraphEdges } from './GraphEdges';
import { GraphPoints } from './GraphPoints';
import { HighlightRing } from './HighlightRing';
import { emptyTransitionState } from './transition';
import { useClickToExpand, usePointPicking } from './usePointPicking';

function SceneContents({
  theme,
  pointsRef,
}: {
  theme: ThemeColors;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  // State as well as the ref: `usePointPicking` needs a render to attach once
  // the object exists, while `GraphEdges`, `HighlightRing` and the HTML overlays
  // read the position buffer inside their own frame loops and must not
  // re-render when it arrives.
  const [points, setPoints] = useState<THREE.Points | null>(null);
  const onReady = useCallback(
    (p: THREE.Points) => {
      pointsRef.current = p;
      setPoints(p);
    },
    [pointsRef],
  );

  // Nodes that are retreating off the map, written by `GraphPoints` and read by
  // `GraphEdges`. A ref rather than store state for the same reason `pointsRef`
  // is one: it changes mid-animation, and a re-render inside the Canvas on every
  // collapse is exactly what this scene is built to avoid.
  const transition = useRef(emptyTransitionState());

  usePointPicking(points, true);
  useClickToExpand(true);

  return (
    <>
      <CameraRig />
      {/* Edges first so nodes draw over them. */}
      <GraphEdges theme={theme} pointsRef={pointsRef} transition={transition} />
      <GraphPoints theme={theme} onReady={onReady} transition={transition} />
      <HighlightRing theme={theme} pointsRef={pointsRef} />
    </>
  );
}

/** The canvas.
 *
 *  The camera's initial framing is fixed rather than derived from the data,
 *  because at mount there IS no data — the graph starts empty and the seed lands
 *  at the origin. Everything after that is handled by `requestFly`. */
export function Scene({
  theme,
  pointsRef,
  children,
}: {
  theme: ThemeColors;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
  children?: React.ReactNode;
}): React.ReactElement {
  const count = useStore((s) => s.graph.nodes.length);

  return (
    <Canvas
      // The canvas is a visualisation OF the app, not the interaction surface.
      // It is not aria-hidden (it is not meaningless) but every function is also
      // reachable through the real DOM panels.
      role="img"
      aria-label={
        count === 0
          ? 'Empty map. Search for a book to start.'
          : `Three-dimensional map of ${count} books grown outward from your starting book. The list beside it covers the same books.`
      }
      camera={{
        position: [EDGE_LEN * 1.6, EDGE_LEN * 1.1, EDGE_LEN * 2.4],
        fov: 45,
        near: 0.1,
        far: EDGE_LEN * 200,
      }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => gl.setClearColor(theme.surface)}
    >
      <SceneContents theme={theme} pointsRef={pointsRef} />
      {children}
    </Canvas>
  );
}
