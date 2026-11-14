import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // Relative paths so dist/ works from any S3/CloudFront prefix.
  base: './',
  plugins: [wasm()],
  // Full reloads only on request: with several people (or agents) editing at once, hot reloads fire mid-play.
  server: { hmr: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          physics: ['@dimforge/rapier3d'],
          post: ['postprocessing', 'n8ao'],
        },
      },
    },
  },
});
