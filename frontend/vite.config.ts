/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

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
