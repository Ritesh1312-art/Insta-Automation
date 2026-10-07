import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'off',
      '@next/next/no-img-element': 'off',
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
  {
    // Local provisioning helpers are deliberate CommonJS (they must run before
    // the TypeScript toolchain is available and load `pg` via require).
    files: ['scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    '.next/**',
    '.open-next/**',
    // `wrangler dev` writes a bundled copy of the worker here; linting a
    // generated bundle only burns memory (it OOM'd a 4 GB sandbox).
    '.wrangler/**',
    // Provisioning logs from scripts/run-tests.mjs.
    '.test-logs/**',
    // The generated Prisma client is build output, ignored by git as well.
    'src/generated/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
]);
