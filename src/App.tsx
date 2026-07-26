import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { DARK, LIGHT, type ThemeColors } from '@/domain/palette';
import { useStore } from '@/state/store';
import { useUrlSync } from '@/state/urlHash';
import { useGlobalKeys } from '@/state/keyboard';
import { Scene } from '@/scene/Scene';
import { WebGLGuard } from '@/scene/WebGLGuard';
import { SearchPanel } from '@/ui/SearchPanel';
import { DetailPanel } from '@/ui/DetailPanel';
import { BookTooltip } from '@/ui/BookTooltip';
import { TreeLabels } from '@/ui/TreeLabels';
import { Legend } from '@/ui/Legend';
import { Footer } from '@/ui/Footer';
import { ListOnlyApp } from '@/ui/ListOnlyApp';

function useTheme(): ThemeColors {
  const [dark, setDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark ? DARK : LIGHT;
}

/** Publishes the R3F camera so the HTML tooltip can project world positions to
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
  const theme = useTheme();
  const cameraRef = useRef<THREE.Camera | null>(null);
  const activeBranchId = useStore((s) => s.activeBranchId);
  const taxonomy = useStore((s) => s.taxonomy);

  useUrlSync();
  useGlobalKeys();

  useEffect(() => {
    document.body.style.background = theme.surface;
    document.body.style.color = theme.textPrimary;
  }, [theme]);

  return (
    <WebGLGuard fallback={<ListOnlyApp />}>
      <div className="app">
        <a className="skip-link" href="#book-search">
          Skip to search
        </a>

        <div className="stage">
          <Scene theme={theme}>
            <CameraPublisher cameraRef={cameraRef} />
          </Scene>
          <TreeLabels cameraRef={cameraRef} />
          <BookTooltip cameraRef={cameraRef} />
          <Legend theme={theme} />
          {activeBranchId && (
            <div className="filter-chip" role="status">
              Filtered to{' '}
              <strong>{taxonomy.byId.get(activeBranchId)?.label ?? activeBranchId}</strong>
              <button
                type="button"
                onClick={() => useStore.getState().setActiveBranch(null)}
                aria-label="Clear subject filter"
              >
                clear
              </button>
            </div>
          )}
        </div>

        <SearchPanel />
        <DetailPanel />
        <Footer />
      </div>
    </WebGLGuard>
  );
}
