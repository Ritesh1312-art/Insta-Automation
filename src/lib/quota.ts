import { prisma } from '@/lib/prisma';
import { getPlan, type PlanId } from '@/lib/plans';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export async function resetQuotaIfNeeded(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const now = new Date();
  const resetAt = user.quotaResetAt;
  if (resetAt && resetAt > now) return user;

  const nextReset = new Date(now.getTime() + MONTH_MS);
  return prisma.user.update({
    where: { id: userId },
    data: {
      dmsUsedThisMonth: 0,
      quotaResetAt: nextReset,
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
  const plan = getPlan(planId);
  const now = new Date();
  return prisma.user.update({
    where: { id: userId },
    data: {
      plan: plan.id,
      monthlyDmQuota: plan.dmQuota,
      dmsUsedThisMonth: 0,
      subscriptionStatus: 'ACTIVE',
      planActivatedAt: now,
      quotaResetAt: new Date(now.getTime() + MONTH_MS),
    },
  });
}

export async function resetDueQuotas(limit = 200) {
  const now = new Date();
  const due = await prisma.user.findMany({
    where: {
      OR: [{ quotaResetAt: null }, { quotaResetAt: { lte: now } }],
    },
    select: { id: true },
    take: limit,
  });
  await Promise.all(due.map((user: { id: string }) => resetQuotaIfNeeded(user.id)));
  return due.length;
}
