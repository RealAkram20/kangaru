const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

/**
 * AGENTS.md Frontend Standards: "ESLint + Prettier with committed config;
 * `tsc --noEmit` must pass. No `any` without an inline justification comment."
 *
 * The rules below are the ones this app's failure modes call for, rather than
 * a general style opinion — `no-floating-promises` in particular, because
 * every write in this app is an `async` call into the outbox and a dropped
 * promise there is a silently lost odometer reading.
 */
module.exports = [
  ...expoConfig,
  prettier,
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // A dropped promise here is a queued transition that never got queued.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // `any` erases the contract this app is built against. Allowed only with
      // a written reason, which is what the description option enforces.
      '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: false }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts'],
    rules: {
      // Test doubles stand in for native modules whose real shapes are wider
      // than anything a test needs.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    /*
     * Expo config plugins, which are CommonJS `.js` by necessity — they are
     * required by `expo prebuild` outside the app's TypeScript build.
     *
     * The block above only reaches `.ts`/`.tsx`, so a `.js` test file gets no
     * Jest globals and every `describe` and `expect` in it is reported as
     * `no-undef`. Declaring them here rather than sprinkling per-file global
     * comments keeps the exception in one visible place.
     */
    files: ['plugins/**/*.js'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'writable',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
      },
    },
  },
];
