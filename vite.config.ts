import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Default to a RELATIVE base so the build is correct wherever it is mounted:
// a GitHub Pages project site (/matteo/), a user site or custom domain (/), or
// a preview served from a subdirectory. An absolute '/' default emits
// `/assets/index-*.js`, which 404s on a project page and yields a blank screen
// while the deploy still reports success — a silent failure that is easy to ship.
//
// Relative paths are safe here specifically because routing is hash-based
// (see src/state/urlHash.ts), so the document's path depth never changes and
// relative asset URLs always resolve. If path-based routing is ever introduced,
// this must become an explicit absolute base again.
//
// VITE_BASE still overrides it for anything unusual.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
  },
});
