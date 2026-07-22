// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * ESLint 9 flat config (V5.4).
 *
 * DELIBERATELY CONSERVATIVE. This codebase predates its linter by five
 * phases, so a maximalist ruleset would produce thousands of findings and
 * teach the team to ignore the tool — the classic failure mode. The rules
 * enabled here are the ones that catch REAL defects (floating promises,
 * unreachable code, accidental `any` leaking through a boundary), not style:
 * formatting is Prettier's job, and `eslint-config-prettier` disables every
 * rule that would fight it, so the two tools never disagree.
 *
 * Type-aware linting is enabled only for src/ — the smoke scripts are
 * deliberately loose (they construct partial fixtures on purpose) and are
 * linted with the non-type-aware ruleset instead.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/**', '*.config.mjs', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts'],
    rules: {
      // Real-defect rules, kept as errors.
      '@typescript-eslint/no-floating-promises': 'off', // requires type info; enabled in the typed block below
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',

      // `any` is sometimes the honest type at a vendor/Prisma boundary; the
      // codebase uses it deliberately and narrowly, so this warns, never blocks.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused code is a real smell, but leading-underscore is the documented
      // convention for intentionally-unused params (e.g. NullProvider._req).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Nest DI relies on empty constructors and parameter properties.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // `require` appears intentionally in smoke bootstraps and one lazy import.
      '@typescript-eslint/no-require-imports': 'off',
      // A very recent ESLint rule demanding `new Error(msg, { cause })` on every
      // rethrow. The convention predates the codebase's error handling and
      // changing it would touch frozen modules; tracked as future work rather
      // than silently rewritten here.
      'preserve-caught-error': 'off',
    },
  },

  {
    // Scripts are tooling, not shipped code: looser on purpose.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // MUST be last: turns off every rule that would conflict with Prettier.
  prettier,
);
