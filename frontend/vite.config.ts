/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  /*
   * `@/` -> `src/`. Declared here and in tsconfig.app.json, and both are
   * required: TypeScript resolves the alias for the editor and `tsc -b`,
   * Vite resolves it for the bundle and for Vitest, which shares this file.
   *
   * It exists for Animate UI. Its icon sources are distributed through the
   * shadcn registry importing `@/components/animate-ui/...`, so the alias is
   * what lets an updated icon be pulled in unedited.
   */
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    rollupOptions: {
      output: {
        /*
         * Split the framework out of the app chunk.
         *
         * Without this, React, the router and axios are bundled with our own
         * code, so shipping a one-line page fix invalidates the whole
         * download for every returning user. These dependencies change only
         * when we deliberately upgrade them, so giving them their own chunk
         * lets the browser keep them across deploys.
         *
         * Route chunks are handled separately, by the `lazy()` imports in
         * routes/router.tsx — the bundler splits those automatically.
         *
         * Written as a function rather than the `{name: [...]}` object form
         * because Vite 8 bundles with Rolldown, whose `manualChunks` accepts
         * only a function.
         */
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },

  /*
   * Vitest lives in this file rather than its own vitest.config.ts so tests
   * build through exactly the same pipeline as the app — the same React
   * plugin, the same resolution, the same `import.meta.env`. Two configs is
   * two things to keep in step, and the failure mode is a test that passes
   * against a build the app never gets.
   */
  test: {
    // Testing Library needs a DOM.
    environment: 'jsdom',

    /*
     * No globals. `describe`/`it`/`expect` are imported explicitly in every
     * test file, which keeps ESLint and `tsc --noEmit` honest without a
     * types entry telling them about names that only exist under the runner.
     */
    globals: false,

    setupFiles: ['./src/test/setup.ts'],

    /*
     * Vitest defaults to 5s per test. These are Testing Library flows that
     * type character by character through multi-step forms, and the runner
     * executes files in parallel — so under load the slowest of them tip
     * over 5s and fail in a different combination on every run. The work
     * is genuine, not a hang; 20s removes the false negatives without
     * hiding a real deadlock, which would still blow through it.
     */
    testTimeout: 20_000,

    /*
     * The app's styling is design tokens in plain CSS. None of it changes
     * what a test asserts, and processing it per file is dead time.
     */
    css: false,

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Type-only modules, the entry point and the test harness itself.
      // A coverage figure that counts files nothing can meaningfully test
      // is a figure nobody trusts.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/types/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
