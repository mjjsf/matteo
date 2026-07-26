import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `base` is explicit rather than sniffed from CI env vars so that
// `VITE_BASE=/matteo/ npm run build && npm run preview` reproduces the
// production subpath build locally — which is where subpath bugs surface.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
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
