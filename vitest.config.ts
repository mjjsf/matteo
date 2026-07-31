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
            'src/domain/**/*.test.ts',
            'src/generated/**/*.test.ts',
            'scripts/**/*.test.ts',
            // Pure decision logic with no WebGL and no DOM involved. Named file
            // by file rather than globbed, so that adding a test beside a
            // component is a decision about whether it belongs in `node` rather
            // than something that happens by accident and then fails on `window`.
            'src/scene/motion.test.ts',
            'src/scene/transition.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/ui/**/*.test.ts?(x)', 'src/state/**/*.test.ts?(x)'],
        },
      },
    ],
  },
});
