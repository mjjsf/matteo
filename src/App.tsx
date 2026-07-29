import { Suspense, useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { FIELD } from '@/domain/palette';
import { useStore } from '@/state/store';
import { useUrlSync } from '@/state/urlHash';
import { useCorpus } from '@/state/useCorpus';
import { useGlobalKeys } from '@/state/keyboard';
import { WebGLGuard } from '@/scene/WebGLGuard';
import { Landing } from '@/ui/Landing';
import { ExplorePanel } from '@/ui/ExplorePanel';
import { DetailPanel } from '@/ui/DetailPanel';
import { Footer } from '@/ui/Footer';
import { ListOnlyApp } from '@/ui/ListOnlyApp';
import { MapStage } from '@/ui/lazyMapStage';

export function App(): React.ReactElement {
  const theme = FIELD;
  const cameraRef = useRef<THREE.Camera | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const phase = useStore((s) => s.phase);
  const status = useStore((s) => s.status);
  const loadError = useStore((s) => s.loadError);

  useCorpus();
  useUrlSync();
  useGlobalKeys();

  useEffect(() => {
    document.body.style.background = theme.surface;
    document.body.style.color = theme.textPrimary;
  }, [theme]);

  if (status !== 'ready') {
    return (
      <div className="app app--empty">
        <main className="landing">
          <div className="landing__inner">
            <h1 className="landing__brand">
              matteo
              <span className="landing__sub">
                {status === 'error' ? 'Could not load the books.' : 'Loading the books…'}
              </span>
            </h1>
            {status === 'error' && (
              <p className="landing__hint" role="alert">
                {loadError} — reload to try again.
              </p>
            )}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

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

          {/* Fallback is an empty stage rather than a spinner: the panels
              beside it are already populated and usable, so a loading message
              over the canvas would announce a wait that does not block anything.
              In practice the chunk is already there, preloaded while the user
              was typing. */}
          <Suspense fallback={<div className="stage" />}>
            <MapStage theme={theme} cameraRef={cameraRef} pointsRef={pointsRef} />
          </Suspense>

          <ExplorePanel />
          <DetailPanel />
          <Footer />
        </div>
      )}
    </WebGLGuard>
  );
}
