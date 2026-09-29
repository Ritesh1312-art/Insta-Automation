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
  globalIgnores([
    '.next/**',
    '.open-next/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
]);
