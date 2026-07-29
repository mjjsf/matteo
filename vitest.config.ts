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
            // Pure decision logic with no WebGL and no DOM involved.
            'src/scene/motion.test.ts',
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
