import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

export type RateLimitResult = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export function requestIp(request: Pick<NextRequest, 'headers'>): string {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

export function rateLimitKey(scope: string, identifier: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be configured with at least 32 characters');
  const digest = createHmac('sha256', secret).update(`${scope}:${identifier.toLowerCase()}`).digest('hex');
  return `${scope}:${digest}`;
}

export async function consumeRateLimit(params: {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const key = rateLimitKey(params.scope, params.identifier);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.rateLimitBucket.findUnique({ where: { key } });
        if (!current || current.expiresAt <= now) {
          await tx.rateLimitBucket.upsert({
            where: { key },
            create: { key, count: 1, windowStart: now, expiresAt: new Date(now.getTime() + params.windowMs) },
            update: { count: 1, windowStart: now, expiresAt: new Date(now.getTime() + params.windowMs) },
          });
          return { allowed: true, remaining: Math.max(0, params.limit - 1) } as const;
        }

        if (current.count >= params.limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000)),
          } as const;
        }

        const updated = await tx.rateLimitBucket.update({
          where: { key },
          data: { count: { increment: 1 } },
        });
        return { allowed: true, remaining: Math.max(0, params.limit - updated.count) } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }

  return { allowed: false, retryAfterSeconds: Math.ceil(params.windowMs / 1000) };
}

export function rateLimitResponse(result: Extract<RateLimitResult, { allowed: false }>) {
  return {
    status: 429,
    headers: { 'Retry-After': String(result.retryAfterSeconds) },
  };
}
