import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
export async function GET() {
  try {
    const user = await requireSessionUser();
    const [runs, webhooks] = await Promise.all([
      prisma.automationRun.findMany({ where: { automation: { userId: user.userId } }, take: 50, orderBy: { createdAt: 'desc' }, include: { automation: true, webhookEvent: true } }),
      prisma.webhookEvent.findMany({ where: { metaConnection: { userId: user.userId } }, take: 20, orderBy: { createdAt: 'desc' } }),
    ]);
    return NextResponse.json({ runs, webhooks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === 'UNAUTHORIZED' ? 'Authentication required' : 'Unable to load logs' }, { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 500 });
  }
}
