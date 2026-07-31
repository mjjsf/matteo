import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import type { ThemeColors } from '@/domain/palette';
import { Scene } from '@/scene/Scene';
import { BookTooltip } from './BookTooltip';
import { NodeMenu } from './NodeMenu';
import { NodeLabels } from './NodeLabels';
import { Legend } from './Legend';

/** Publishes the R3F camera so the HTML overlays can project world positions to
 *  screen space without living inside the Canvas. */
function CameraPublisher({
  cameraRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);
  return null;
}

/** Everything that needs three.js, behind one module boundary.
 *
 *  This exists to be lazily imported. The app always opens on the landing
 *  screen, which is one input box and needs no 3D at all — but three.js and
 *  react-three-fiber sat in the main chunk, so the browser downloaded and
 *  parsed roughly a megabyte of renderer before it could show that box. Nothing
 *  in here is referenced until a book is actually seeded, so it splits cleanly.
 *
 *  Keep the boundary honest: anything importing `three` or `@react-three/*`
 *  belongs on this side of it, or the split silently stops working. The refs
 *  crossing the boundary are `import type` only, which erases at compile time. */
export default function MapStage({
  theme,
  cameraRef,
  pointsRef,
}: {
  theme: ThemeColors;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  pointsRef: React.MutableRefObject<THREE.Points | null>;
}): React.ReactElement {
  return (
    <div className="stage">
      <Scene theme={theme} pointsRef={pointsRef}>
        <CameraPublisher cameraRef={cameraRef} />
      </Scene>
      <NodeLabels cameraRef={cameraRef} pointsRef={pointsRef} />
      <BookTooltip cameraRef={cameraRef} pointsRef={pointsRef} />
      <NodeMenu cameraRef={cameraRef} pointsRef={pointsRef} />
      <Legend theme={theme} />
    </div>
  );
}
