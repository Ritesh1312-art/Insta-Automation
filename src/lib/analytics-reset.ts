import { prisma } from '@/lib/prisma';
import { advisoryLockKeys, withTransactionAdvisoryLock } from '@/lib/advisory-lock';

export const ANALYTICS_RESET_AUDIT_ACTION = 'ADMIN_ANALYTICS_RESET';

/** Aggregate counters as they were immediately before a reset (numbers only, no content). */
export type AnalyticsTotals = {
  totalCommentsReceived: number;
  automationCount: number;
  totalTriggers: number;
  totalSuccess: number;
  totalFailed: number;
  lastTriggeredAt: string | null;
};

export type AnalyticsResetResult = {
  targetUserId: string;
  previous: AnalyticsTotals;
  automationsReset: number;
};

/** The complete set of columns this reset is allowed to write. */
export const ANALYTICS_RESET_USER_DATA = { totalCommentsReceived: 0 } as const;
export const ANALYTICS_RESET_AUTOMATION_DATA = {
  totalTriggers: 0,
  totalSuccess: 0,
  totalFailed: 0,
  lastTriggeredAt: null,
} as const;

/**
 * Admin-only "Reset analytics" for one user, as one database transaction.
 *
 * Resets ONLY `User.totalCommentsReceived` and, on every automation the user
 * owns, `totalTriggers`, `totalSuccess`, `totalFailed`, and `lastTriggeredAt`.
 * It never touches DM quota usage, plan or subscription state, credentials or
 * roles, Meta connections or tokens, media, resources, automation definitions
 * or ACTIVE/PAUSED status, webhook events, execution logs, or payments.
 *
 * Writes an `ADMIN_ANALYTICS_RESET` audit entry with the acting admin ID, the
 * target user ID, and the previous totals. Returns null for an unknown user.
 * This is only ever invoked by an explicit admin request — never on deploy.
 */
export async function resetUserAnalytics(params: { adminId: string; targetUserId: string }): Promise<AnalyticsResetResult | null> {
  // Serializing resets of the same user keeps the recorded "previous totals"
  // accurate if the button is submitted twice.
  return withTransactionAdvisoryLock(prisma, advisoryLockKeys.analyticsReset(params.targetUserId), async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: params.targetUserId },
      select: { id: true, totalCommentsReceived: true },
    });
    if (!user) return null;

    const flows = await tx.automation.aggregate({
      where: { userId: user.id },
      _count: { _all: true },
      _sum: { totalTriggers: true, totalSuccess: true, totalFailed: true },
      _max: { lastTriggeredAt: true },
    });
    const previous: AnalyticsTotals = {
      totalCommentsReceived: user.totalCommentsReceived,
      automationCount: flows._count._all,
      totalTriggers: flows._sum.totalTriggers ?? 0,
      totalSuccess: flows._sum.totalSuccess ?? 0,
      totalFailed: flows._sum.totalFailed ?? 0,
      lastTriggeredAt: flows._max.lastTriggeredAt?.toISOString() ?? null,
    };

    await tx.user.update({ where: { id: user.id }, data: ANALYTICS_RESET_USER_DATA });
    const automations = await tx.automation.updateMany({
      where: { userId: user.id },
      data: ANALYTICS_RESET_AUTOMATION_DATA,
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: ANALYTICS_RESET_AUDIT_ACTION,
        details: {
          adminId: params.adminId,
          targetUserId: user.id,
          previousTotals: previous,
          automationsReset: automations.count,
        },
      },
    });

    return { targetUserId: user.id, previous, automationsReset: automations.count };
  });
}
