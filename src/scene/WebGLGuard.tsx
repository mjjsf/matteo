import { useEffect, useState } from 'react';

function detectWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** Renders `fallback` when WebGL2 is unavailable.
 *
 *  Cheap to support because the search, tree, and detail panels are already
 *  independent of the canvas — the fallback is the same UI at full width. Also
 *  covers low-power devices and blocked-GPU configurations. */
export function WebGLGuard({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}): React.ReactElement {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(detectWebGL2());
  }, []);

  if (supported === null) return <></>;
  return <>{supported ? children : fallback}</>;
}
