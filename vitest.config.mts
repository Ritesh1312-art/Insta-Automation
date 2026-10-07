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
    // Fixed values so unit tests are deterministic, but an integration run
    // (scripts/run-tests.mjs) passes its own AUTH_SECRET / ENCRYPTION_KEY /
    // META_APP_SECRET, and the test process must see exactly what the running
    // application sees: it decrypts the tokens the server encrypted.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test',
      AUTH_SECRET: process.env.AUTH_SECRET || '0123456789abcdef0123456789abcdef',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      META_APP_SECRET: process.env.META_APP_SECRET || 'meta-secret',
      META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || 'verify-token',
      META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION || 'v21.0',
      META_APP_ID: process.env.META_APP_ID || '1234567890',
      ADMIN_LOGIN_IDENTIFIER: process.env.ADMIN_LOGIN_IDENTIFIER || '',
    },
    // Integration suites drive a real server and database; 5s (the default) is
    // not enough for a provisioning round trip.
    testTimeout: 30_000,
    hookTimeout: 60_000,
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
