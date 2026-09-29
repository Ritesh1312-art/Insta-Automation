import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(),
  },
}));
vi.mock('./prisma', () => ({ prisma }));

import {
  applyApprovedPlan,
  assertDmQuota,
  planAssignmentData,
  releaseDmQuota,
  reserveDmQuota,
  resetDueQuotas,
  resetQuotaIfNeeded,
} from './quota';

const future = () => new Date(Date.now() + 86_400_000);
const past = () => new Date(Date.now() - 31 * 86_400_000);
const baseUser = {
  id: 'user', role: 'USER', plan: 'FREE', monthlyDmQuota: 30, dmsUsedThisMonth: 0,
  quotaResetAt: future(), planActivatedAt: null,
};

describe('quota lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a complete 30-day paid-plan assignment', () => {
    const now = new Date('2026-09-29T00:00:00Z');
    expect(planAssignmentData('PREMIUM', now)).toMatchObject({
      plan: 'PREMIUM', monthlyDmQuota: 750, dmsUsedThisMonth: 0,
      subscriptionStatus: 'ACTIVE', planActivatedAt: now,
    });
  });

  it('leaves admins and users before reset unchanged', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ ...baseUser, role: 'ADMIN' });
    await expect(resetQuotaIfNeeded('user')).resolves.toMatchObject({ role: 'ADMIN' });
    prisma.user.findUnique.mockResolvedValueOnce(baseUser);
    await expect(resetQuotaIfNeeded('user')).resolves.toBe(baseUser);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('initializes legacy paid activation dates and expires old paid plans', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ ...baseUser, plan: 'PREMIUM', monthlyDmQuota: 750 });
    prisma.user.update.mockResolvedValueOnce({ id: 'user' });
    await resetQuotaIfNeeded('user');
    expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ planActivatedAt: expect.any(Date), quotaResetAt: expect.any(Date) }),
    }));

    prisma.user.findUnique.mockResolvedValueOnce({ ...baseUser, plan: 'PREMIUM', planActivatedAt: past(), dmsUsedThisMonth: 400 });
    prisma.user.update.mockResolvedValueOnce({ id: 'user', plan: 'FREE' });
    await resetQuotaIfNeeded('user');
    expect(prisma.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plan: 'FREE', monthlyDmQuota: 30, subscriptionStatus: 'EXPIRED' }),
    }));
  });

  it('resets a due free quota', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, quotaResetAt: past(), dmsUsedThisMonth: 30 });
    prisma.user.update.mockResolvedValue({ ...baseUser, dmsUsedThisMonth: 0 });
    await resetQuotaIfNeeded('user');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { dmsUsedThisMonth: 0, quotaResetAt: expect.any(Date) },
    }));
  });

  it('reports exhausted quotas and atomically reserves available sends', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, dmsUsedThisMonth: 30 });
    await expect(assertDmQuota('user')).resolves.toMatchObject({ ok: false });

    prisma.user.findUnique.mockResolvedValue({ ...baseUser, dmsUsedThisMonth: 29 });
    prisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(reserveDmQuota('user')).resolves.toEqual({ ok: true, charged: true });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user', dmsUsedThisMonth: { lt: 30 } },
    }));

    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reserveDmQuota('user')).resolves.toMatchObject({ ok: false });
  });

  it('bypasses charging admins and releases normal reservations safely', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, role: 'ADMIN' });
    const adminReservation = await reserveDmQuota('user');
    expect(adminReservation).toEqual({ ok: true, charged: false });
    await releaseDmQuota('user', adminReservation);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();

    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await releaseDmQuota('user', { ok: true, charged: true });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user', dmsUsedThisMonth: { gt: 0 } },
    }));
  });

  it('applies approved plans and processes users due for reset', async () => {
    prisma.user.update.mockResolvedValue({ id: 'user' });
    await applyApprovedPlan('user', 'STANDARD');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plan: 'STANDARD', monthlyDmQuota: 250 }),
    }));

    prisma.user.findMany.mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, quotaResetAt: past() });
    await expect(resetDueQuotas()).resolves.toBe(2);
  });
});
