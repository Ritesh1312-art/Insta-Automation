import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
      AUTH_SECRET: '0123456789abcdef0123456789abcdef',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      META_APP_SECRET: 'meta-secret',
      META_VERIFY_TOKEN: 'verify-token',
      META_GRAPH_API_VERSION: 'v21.0',
    },
    clearMocks: true,
    restoreMocks: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/lib/**/*.ts',
        'src/services/**/*.ts',
      ],
      exclude: ['src/lib/prisma.ts'],
      thresholds: {
        statements: 70,
        branches: 55,
        functions: 85,
        lines: 75,
      },
    },
  },
});
