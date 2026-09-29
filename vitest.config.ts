import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.ts', 'src/services/**/*.ts'],
      exclude: ['src/lib/prisma.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50
      }
    }
  }
});
