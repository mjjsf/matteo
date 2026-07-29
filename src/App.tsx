import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { FIELD } from '@/domain/palette';
import { useStore } from '@/state/store';
import { useUrlSync } from '@/state/urlHash';
import { useGlobalKeys } from '@/state/keyboard';
import { Scene } from '@/scene/Scene';
import { WebGLGuard } from '@/scene/WebGLGuard';
import { Landing } from '@/ui/Landing';
import { ExplorePanel } from '@/ui/ExplorePanel';
import { DetailPanel } from '@/ui/DetailPanel';
import { BookTooltip } from '@/ui/BookTooltip';
import { NodeLabels } from '@/ui/NodeLabels';
import { Legend } from '@/ui/Legend';
import { Footer } from '@/ui/Footer';
import { ListOnlyApp } from '@/ui/ListOnlyApp';

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

export function App(): React.ReactElement {
  const theme = FIELD;
  const cameraRef = useRef<THREE.Camera | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const phase = useStore((s) => s.phase);

  useUrlSync();
  useGlobalKeys();

  useEffect(() => {
    document.body.style.background = theme.surface;
    document.body.style.color = theme.textPrimary;
  }, [theme]);

  return (
    <WebGLGuard fallback={<ListOnlyApp />}>
      {phase === 'empty' ? (
        <div className="app app--empty">
          <Landing />
          <Footer />
        </div>
      ) : (
        <div className="app">
          <a className="skip-link" href="#explore-heading">
            Skip to the book list
          </a>

          <div className="stage">
            <Scene theme={theme} pointsRef={pointsRef}>
              <CameraPublisher cameraRef={cameraRef} />
            </Scene>
            <NodeLabels cameraRef={cameraRef} pointsRef={pointsRef} />
            <BookTooltip cameraRef={cameraRef} pointsRef={pointsRef} />
            <Legend theme={theme} />
          </div>

          <ExplorePanel />
          <DetailPanel />
          <Footer />
        </div>
      )}
    </WebGLGuard>
  );
}
