import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Next.js imports route modules while collecting build metadata. Keep that
  // phase database-independent; env:check still enforces production setup and
  // /api/health reports a missing or unreachable database as degraded.
  const connectionString = process.env.DATABASE_URL
    || 'postgresql://invalid:invalid@127.0.0.1:5432/invalid';

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
