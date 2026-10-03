import { prisma } from '@/lib/prisma';
import { advisoryLockKeys, withTransactionAdvisoryLock, type TransactionClient } from '@/lib/advisory-lock';
import { getPlan, isPaidPlan, type PlanId } from '@/lib/plans';
import { safeErrorMessage } from '@/lib/safe-error';

export const PLAN_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

/** How many scheduled quota resets run at once; each holds a pooled connection. */
const SCHEDULED_RESET_CONCURRENCY = 5;

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

/**
 * Runs `work` in one interactive transaction holding the user's quota lock.
 * Every read-modify-write of plan/quota state (cycle resets, reservations,
 * releases, plan assignment) goes through this lock, so none of them can
 * interleave — e.g. a cycle reset can no longer overwrite a plan that was
 * approved between its read and its write.
 */
export function withQuotaLock<T>(userId: string, work: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return withTransactionAdvisoryLock(prisma, advisoryLockKeys.quota(userId), work);
}

/** Paid-plan expiry and 30-day usage reset. Caller must hold the quota lock in `tx`. */
async function applyQuotaCycle(tx: TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  if (user.role === 'ADMIN') return user; // admins bypass quota cycles

  const now = new Date();
  const plan = getPlan(user.plan);

  // A paid plan expires exactly 30 days after activation, even if quotaResetAt
  // was changed or missing. This check intentionally runs before the fast path.
  if (plan.priceInr > 0) {
    if (!user.planActivatedAt) {
      return tx.user.update({
        where: { id: userId },
        data: {
          planActivatedAt: now,
          quotaResetAt: new Date(now.getTime() + PLAN_CYCLE_MS),
        },
      });
    }

    if (now.getTime() - user.planActivatedAt.getTime() >= PLAN_CYCLE_MS) {
      const free = getPlan('FREE');
      return tx.user.update({
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

  return tx.user.update({
    where: { id: userId },
    data: {
      dmsUsedThisMonth: 0,
      quotaResetAt: new Date(now.getTime() + PLAN_CYCLE_MS),
    },
  });
}

export async function resetQuotaIfNeeded(userId: string) {
  return withQuotaLock(userId, (tx) => applyQuotaCycle(tx, userId));
}

function quotaReachedMessage(planName: string, quota: number) {
  return `${planName} plan quota reached (${quota} DMs / 30 days). Upgrade or wait for reset.`;
}

export async function assertDmQuota(userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await resetQuotaIfNeeded(userId);
  if (!user) return { ok: false, message: 'Workspace owner not found' };
  if (user.role === 'ADMIN') return { ok: true };

  const plan = getPlan(user.plan);
  const quota = user.monthlyDmQuota || plan.dmQuota;
  if (user.dmsUsedThisMonth >= quota) {
    return { ok: false, message: quotaReachedMessage(plan.name, quota) };
  }
  return { ok: true };
}

export type DmReservation = { ok: true; charged: boolean } | { ok: false; message: string };

/**
 * Reserves one DM before calling Meta so concurrent webhooks cannot exceed a
 * plan cap. The cycle check and the conditional increment run in the same
 * locked transaction; Meta is called only after it commits.
 */
export async function reserveDmQuota(userId: string): Promise<DmReservation> {
  return withQuotaLock<DmReservation>(userId, async (tx) => {
    const user = await applyQuotaCycle(tx, userId);
    if (!user) return { ok: false, message: 'Workspace owner not found' };
    if (user.role === 'ADMIN') return { ok: true, charged: false };

    const plan = getPlan(user.plan);
    const quota = user.monthlyDmQuota > 0 ? user.monthlyDmQuota : plan.dmQuota;
    const reserved = await tx.user.updateMany({
      where: { id: userId, dmsUsedThisMonth: { lt: quota } },
      data: { dmsUsedThisMonth: { increment: 1 } },
    });
    if (reserved.count !== 1) return { ok: false, message: quotaReachedMessage(plan.name, quota) };
    return { ok: true, charged: true };
  });
}

/** Releases a reservation when Meta definitively rejects the request. */
export async function releaseDmQuota(userId: string, reservation: DmReservation) {
  if (!reservation.ok || !reservation.charged) return;
  await withQuotaLock(userId, (tx) => tx.user.updateMany({
    where: { id: userId, dmsUsedThisMonth: { gt: 0 } },
    data: { dmsUsedThisMonth: { decrement: 1 } },
  }));
}

/** Admin "Reset DM usage": zeroes the current cycle's usage. Returns null for unknown users. */
export async function resetDmUsage(userId: string) {
  return withQuotaLock(userId, async (tx) => {
    const current = await applyQuotaCycle(tx, userId);
    if (!current) return null;
    return tx.user.update({ where: { id: userId }, data: { dmsUsedThisMonth: 0 } });
  });
}

/** Kept for administrative/backfill callers; normal sends must use reserveDmQuota. */
export async function incrementDmUsage(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { dmsUsedThisMonth: { increment: 1 } },
  });
}

export async function applyApprovedPlan(userId: string, planId: PlanId) {
  return withQuotaLock(userId, (tx) => tx.user.update({
    where: { id: userId },
    data: planAssignmentData(planId),
  }));
}

/** Scheduled job: applies due cycle resets/expiries. Returns how many users were processed successfully. */
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

  // Small batches: every reset is a locked transaction holding a pooled
  // connection, and one user's failure must not abort everyone else's reset.
  let processed = 0;
  for (let index = 0; index < due.length; index += SCHEDULED_RESET_CONCURRENCY) {
    const batch = due.slice(index, index + SCHEDULED_RESET_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((user: { id: string }) => resetQuotaIfNeeded(user.id)));
    for (const result of results) {
      if (result.status === 'fulfilled') processed += 1;
      else console.error('[quota] scheduled reset failed', { error: safeErrorMessage(result.reason) });
    }
  }
  return processed;
}
