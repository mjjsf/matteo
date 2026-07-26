import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Two projects: pure logic runs in plain node, UI/state runs in happy-dom.
// The 3D scene is deliberately untested — there is no WebGL in happy-dom and
// asserting on three.js internals is not a useful signal. All scene logic
// worth testing lives in the pure modules and hooks instead.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/layout/**/*.test.ts',
            'src/domain/**/*.test.ts',
            'src/generated/**/*.test.ts',
            'scripts/**/*.test.ts',
            // Pure buffer logic with no DOM dependency, and it reads the
            // authored corpus from disk.
            'src/state/selectors.test.ts',
            // Pure geometry, no WebGL involved.
            'src/scene/searchTreeLayout.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/ui/**/*.test.ts?(x)', 'src/state/**/*.test.ts?(x)'],
          // Runs in the node project instead: it reads the authored corpus from
          // disk, and happy-dom gives `import.meta.url` an http:// scheme,
          // which file-system helpers cannot resolve.
          exclude: ['src/state/selectors.test.ts'],
        },
      },
    ],
  },
});
