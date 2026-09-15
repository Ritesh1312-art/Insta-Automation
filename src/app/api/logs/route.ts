import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireSessionUser();
    const [runs, webhooks, postbackAudits] = await Promise.all([
      prisma.automationRun.findMany({
        where: { automation: { userId: user.userId } },
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: { automation: true, webhookEvent: true },
      }),
      prisma.webhookEvent.findMany({
        where: { metaConnection: { userId: user.userId } },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: { userId: user.userId, action: { startsWith: 'POSTBACK_' } },
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return NextResponse.json({ runs, webhooks, postbackAudits });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'UNAUTHORIZED';
    return NextResponse.json(
      { error: unauthorized ? 'Authentication required' : 'Unable to load logs' },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
