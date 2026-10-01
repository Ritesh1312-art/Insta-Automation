import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function requestFingerprint(request: Request, discriminator = '') {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
  // User-Agent is intentionally excluded: it is mutable and creates privacy leaks.
  return digest(`${address}|${discriminator.toLowerCase().trim()}`);
}

/** Database-backed limiter that works across serverless/Worker instances. */
export async function consumeRateLimit(params: {
  action: string;
  fingerprint: string;
  limit: number;
  windowMs: number;
}) {
  const since = new Date(Date.now() - params.windowMs);
  return prisma.$transaction(async (tx: any) => {
    // Serialize a given action/fingerprint window so parallel requests cannot all
    // pass the count before any of them records its attempt.
    const lockKey = `${params.action}:${params.fingerprint}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const used = await tx.auditLog.count({
      where: {
        action: params.action,
        ipAddress: params.fingerprint,
        createdAt: { gte: since },
      },
    });
    if (used >= params.limit) return false;
    await tx.auditLog.create({
      data: { action: params.action, ipAddress: params.fingerprint },
    });
    return true;
  });
}
