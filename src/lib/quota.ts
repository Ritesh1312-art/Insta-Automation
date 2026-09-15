import { prisma } from '@/lib/prisma';
import { getPlan, isPaidPlan, type PlanId } from '@/lib/plans';

export const PLAN_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

export function planAssignmentData(planId: PlanId, now = new Date()) {
  const plan = getPlan(planId);
  return {
    plan: plan.id,
    monthlyDmQuota: plan.dmQuota,
    dmsUsedThisMonth: 0,
    subscriptionStatus: 'ACTIVE',
    planActivatedAt: plan.priceInr > 0 ? now : null,
    quotaResetAt: new Date(now.getTime() + PLAN_CYCLE_MS),
  };
}

export async function resetQuotaIfNeeded(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  if (user.role === 'ADMIN') return user; // admins bypass quota cycles

  const now = new Date();
  const plan = getPlan(user.plan);

  // A paid plan expires exactly 30 days after activation, even if quotaResetAt
  // was changed or missing. This check intentionally runs before the fast path.
  if (plan.priceInr > 0) {
    if (!user.planActivatedAt) {
      return prisma.user.update({
        where: { id: userId },
        data: {
          planActivatedAt: now,
          quotaResetAt: new Date(now.getTime() + PLAN_CYCLE_MS),
        },
      });
    }

    if (now.getTime() - user.planActivatedAt.getTime() >= PLAN_CYCLE_MS) {
      const free = getPlan('FREE');
      return prisma.user.update({
        where: { id: userId },
        data: {
          plan: free.id,
          monthlyDmQuota: free.dmQuota,
          dmsUsedThisMonth: 0,
          subscriptionStatus: 'EXPIRED',
          planActivatedAt: null,
          quotaResetAt: new Date(now.getTime() + PLAN_CYCLE_MS),
        },
      });
    }
  }

  if (user.quotaResetAt && user.quotaResetAt > now) return user;

  return prisma.user.update({
    where: { id: userId },
    data: {
      dmsUsedThisMonth: 0,
      quotaResetAt: new Date(now.getTime() + PLAN_CYCLE_MS),
    },
  });
}

export async function assertDmQuota(userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await resetQuotaIfNeeded(userId);
  if (!user) return { ok: false, message: 'Workspace owner not found' };
  if (user.role === 'ADMIN') return { ok: true };

  const plan = getPlan(user.plan);
  const quota = user.monthlyDmQuota || plan.dmQuota;
  if (user.dmsUsedThisMonth >= quota) {
    return {
      ok: false,
      message: `${plan.name} plan quota reached (${quota} DMs / 30 days). Upgrade or wait for reset.`,
    };
  }
  return { ok: true };
}

export async function incrementDmUsage(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { dmsUsedThisMonth: { increment: 1 } },
  });
}

export async function applyApprovedPlan(userId: string, planId: PlanId) {
  return prisma.user.update({
    where: { id: userId },
    data: planAssignmentData(planId),
  });
}

export async function resetDueQuotas(limit = 200) {
  const now = new Date();
  const paidPlanIds = (['STANDARD', 'PREMIUM', 'PREMIUM_PRO', 'PREMIUM_PRO_PLUS'] as PlanId[])
    .filter((planId) => isPaidPlan(planId));
  const paidExpiryBoundary = new Date(now.getTime() - PLAN_CYCLE_MS);
  const due = await prisma.user.findMany({
    where: {
      role: { not: 'ADMIN' },
      OR: [
        { quotaResetAt: null },
        { quotaResetAt: { lte: now } },
        { plan: { in: paidPlanIds }, planActivatedAt: { lte: paidExpiryBoundary } },
      ],
    },
    select: { id: true },
    take: limit,
  });
  await Promise.all(due.map((user: { id: string }) => resetQuotaIfNeeded(user.id)));
  return due.length;
}
