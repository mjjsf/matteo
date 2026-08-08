import { Suspense, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { FIELD } from '@/domain/palette';
import { useStore } from '@/state/store';
import { useUrlSync } from '@/state/urlHash';
import { useCorpus } from '@/state/useCorpus';
import { useGlobalKeys } from '@/state/keyboard';
import { WebGLGuard } from '@/scene/WebGLGuard';
import { Landing } from '@/ui/Landing';
import { Browse } from '@/ui/Browse';
import { ExplorePanel } from '@/ui/ExplorePanel';
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
  // Hash-driven so the index is linkable and Back works, like every other route
  // here. Read once and on hashchange rather than through `useUrlSync`, which
  // owns the map's own state and would fight over it.
  const [browsing, setBrowsing] = useState(() => window.location.hash.startsWith('#/browse'));

  useCorpus();
  useUrlSync();
  useGlobalKeys();

  useEffect(() => {
    const onHash = (): void => setBrowsing(window.location.hash.startsWith('#/browse'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.body.style.background = theme.surface;
    document.body.style.color = theme.textPrimary;
  }, [theme]);

  // Only a hard failure replaces the landing screen. While the corpus is still
  // downloading, `Landing` renders as normal — the input is live and focused
  // from first paint, and its suggestion list fills in when the data arrives.
  // This used to return early on anything but 'ready', which meant there was no
  // field at all to type into for the length of two JSON fetches.
  if (status === 'error') {
    return (
      <div className="app app--empty">
        <main className="landing">
          <div className="landing__inner">
            <h1 className="landing__brand">
              matteo
              <span className="landing__sub">Could not load the books.</span>
            </h1>
            <p className="landing__hint" role="alert">
              {loadError} — reload to try again.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <WebGLGuard fallback={<ListOnlyApp />}>
      {browsing ? (
        <div className="app app--empty">
          <Browse
            onClose={() => {
              // Only blank the hash when there is nothing to point at. Once a
              // map exists the URL belongs to `useUrlSync`, and clearing it here
              // would throw away the link that was just created.
              if (useStore.getState().phase === 'empty') window.location.hash = '';
              setBrowsing(false);
            }}
          />
          {/* No "Browse the collection" link on the browse screen itself. */}
          <Footer showBrowse={false} />
        </div>
      ) : phase === 'empty' ? (
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
          <Footer />
        </div>
      )}
    </WebGLGuard>
  );
}
