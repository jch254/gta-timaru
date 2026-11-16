import { configDefaults, defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // Relative paths so dist/ works from any S3/CloudFront prefix.
  base: './',
  plugins: [wasm()],
  test: {
    exclude: [...configDefaults.exclude, 'studiodaw/**'],
  },
  // Full reloads only on request: with several people (or agents) editing at once, hot reloads fire mid-play.
  // The fixed port is what every script in scripts/ and scripts/playtest/ dials.
  server: { hmr: false, port: 5195 },
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
