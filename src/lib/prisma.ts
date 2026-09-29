import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be configured');
  }

  // The JavaScript query compiler + pg adapter avoids Prisma's native Rust
  // engine. That makes the same client work on Node hosts and Cloudflare
  // Workers with nodejs_compat enabled.
  const adapter = new PrismaPg({
    connectionString,
    max: Number.parseInt(process.env.DATABASE_POOL_SIZE || '5', 10),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
