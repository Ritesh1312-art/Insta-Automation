import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { activeUserFlowsWhere, userFlowsWhere } from '@/lib/flow-scope';
import { privateJson } from '@/lib/http-cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireSessionUser();
    const runFilter = { automation: userFlowsWhere(user.userId) };
    const [connection, totalAutomations, activeAutomations, totalRuns, totalSuccess, totalFailed, owner] = await Promise.all([
      prisma.metaConnection.findFirst({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        select: { connectionStatus: true, webhookStatus: true, instagramUsername: true, profilePictureUrl: true },
      }),
      // Same owner-only scope as GET /api/automations, so Studio always matches the Flows list.
      prisma.automation.count({ where: userFlowsWhere(user.userId) }),
      prisma.automation.count({ where: activeUserFlowsWhere(user.userId) }),
      prisma.automationRun.count({ where: runFilter }),
      prisma.automationRun.count({ where: { ...runFilter, status: 'API_ACCEPTED' } }),
      prisma.automationRun.count({ where: { ...runFilter, status: 'FAILED' } }),
      prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          totalCommentsReceived: true,
          plan: true,
          monthlyDmQuota: true,
          dmsUsedThisMonth: true,
          quotaResetAt: true,
          subscriptionStatus: true,
          role: true,
        },
      }),
    ]);
    return privateJson({
      totalAutomations,
      activeAutomations,
      // The owner's comment counter (incremented once per new comment event and
      // cleared only by the admin "Reset analytics" action). Webhook events
      // themselves are retained for the logs and are not counted here.
      totalCommentsReceived: owner?.totalCommentsReceived ?? 0,
      totalRuns,
      totalSuccess,
      totalFailed,
      successRate: totalRuns ? Math.round(totalSuccess / totalRuns * 100) : 0,
      connectionStatus: connection?.connectionStatus || 'DISCONNECTED',
      // Separate axis: a healthy token with a failed webhook subscribe is not
      // an expired connection, and the dashboard warns about it differently.
      webhookStatus: connection?.webhookStatus || 'UNKNOWN',
      instagramUsername: connection?.instagramUsername || null,
      profilePictureUrl: connection?.profilePictureUrl || null,
      plan: owner?.plan || 'FREE',
      monthlyDmQuota: owner?.monthlyDmQuota || 30,
      dmsUsedThisMonth: owner?.dmsUsedThisMonth || 0,
      quotaResetAt: owner?.quotaResetAt || null,
      subscriptionStatus: owner?.subscriptionStatus || 'INACTIVE',
      role: owner?.role || 'USER',
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'UNAUTHORIZED';
    return privateJson(
      { error: unauthorized ? 'Authentication required' : 'Unable to load dashboard statistics' },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
