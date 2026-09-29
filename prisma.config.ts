import { PrismaPg } from '@prisma/adapter-pg';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  experimental: {
    adapter: true,
  },
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  adapter: async () => new PrismaPg({
    connectionString: process.env.DATABASE_URL || 'postgresql://invalid:invalid@127.0.0.1:5432/invalid',
  }),
});
