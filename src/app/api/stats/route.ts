import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireSessionUser();
    const connection = await prisma.metaConnection.findFirst({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' } });
    const eventFilter = { metaConnection: { userId: user.userId } };
    const runFilter = { automation: { userId: user.userId } };
    const [totalAutomations, activeAutomations, totalCommentsReceived, totalRuns, totalSuccess, totalFailed] = await Promise.all([
      prisma.automation.count({ where: { userId: user.userId } }), prisma.automation.count({ where: { userId: user.userId, status: 'ACTIVE' } }),
      prisma.webhookEvent.count({ where: eventFilter }), prisma.automationRun.count({ where: runFilter }),
      prisma.automationRun.count({ where: { ...runFilter, status: 'API_ACCEPTED' } }), prisma.automationRun.count({ where: { ...runFilter, status: 'FAILED' } }),
    ]);
    const owner = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { plan: true, monthlyDmQuota: true, dmsUsedThisMonth: true, quotaResetAt: true, subscriptionStatus: true, role: true },
    });
    return NextResponse.json({
      totalAutomations,
      activeAutomations,
      totalCommentsReceived,
      totalRuns,
      totalSuccess,
      totalFailed,
      successRate: totalRuns ? Math.round(totalSuccess / totalRuns * 100) : 0,
      connectionStatus: connection?.connectionStatus || 'DISCONNECTED',
      instagramUsername: connection?.instagramUsername || null,
      plan: owner?.plan || 'FREE',
      monthlyDmQuota: owner?.monthlyDmQuota || 30,
      dmsUsedThisMonth: owner?.dmsUsedThisMonth || 0,
      quotaResetAt: owner?.quotaResetAt || null,
      subscriptionStatus: owner?.subscriptionStatus || 'INACTIVE',
      role: owner?.role || 'USER',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === 'UNAUTHORIZED' ? 'Authentication required' : 'Unable to load dashboard statistics' }, { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 500 });
  }
}
