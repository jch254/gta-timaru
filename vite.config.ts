import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';

// Every build is stamped so a game left running can tell a newer one has been deployed (src/core/update.ts):
// the stamp is baked into the code and written to dist/version.json, which the game reads now and then.
// CodeBuild names the commit it built; anywhere else the build is named for the time it was made.
const builtAt = Date.now();
const build = { build: process.env.CODEBUILD_RESOLVED_SOURCE_VERSION || `local-${builtAt}`, builtAt };

function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(build)}\n` });
    },
  };
}

export default defineConfig({
  // Relative paths so dist/ works from any S3/CloudFront prefix.
  base: './',
  plugins: [wasm(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(build.build),
    __BUILT_AT__: JSON.stringify(build.builtAt),
  },
  test: {
    // .claude/ can hold whole worktree copies of the repo; without this the suite runs twice.
    exclude: [...configDefaults.exclude, 'studiodaw/**', '.claude/**'],
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
