import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type * as THREE from 'three';
import type { ThemeColors } from '@/domain/palette';
import { useStore } from '@/state/store';
import { BookPoints } from './BookPoints';
import { CameraRig } from './CameraRig';
import { HighlightRing } from './HighlightRing';
import { SearchTree } from './SearchTree';
import { useClickToSelect, usePointPicking } from './usePointPicking';

function SceneContents({ theme }: { theme: ThemeColors }): React.ReactElement {
  const radius = useStore((s) => s.radius);
  const [points, setPoints] = useState<THREE.Points | null>(null);
  const onReady = useCallback((p: THREE.Points) => setPoints(p), []);

  usePointPicking(points, true, radius);
  useClickToSelect(true);

  return (
    <>
      <CameraRig radius={radius} />
      <BookPoints theme={theme} onReady={onReady} />
      <HighlightRing radius={radius} theme={theme} />
      <SearchTree radius={radius} theme={theme} />
    </>
  );
}

export function Scene({
  theme,
  children,
}: {
  theme: ThemeColors;
  children?: React.ReactNode;
}): React.ReactElement {
  const radius = useStore((s) => s.radius);
  const bookCount = useStore((s) => s.books.length);

  return (
    <Canvas
      // The canvas is a visualisation OF the app, not the interaction surface.
      // It is not aria-hidden (it is not meaningless) but every function is also
      // reachable through the real DOM panels.
      role="img"
      aria-label={`Three-dimensional map of ${bookCount} books positioned by shared subjects and authors. Use the search field and result list to navigate.`}
      camera={{ position: [radius * 1.6, radius * 0.9, radius * 1.6], fov: 45, near: 0.1, far: radius * 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => gl.setClearColor(theme.surface)}
    >
      <SceneContents theme={theme} />
      {children}
    </Canvas>
  );
}
