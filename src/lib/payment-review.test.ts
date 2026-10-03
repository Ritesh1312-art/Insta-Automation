import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    directUpiPayment: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    user: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prisma: { directUpiPayment: { findUnique: vi.fn() }, $transaction: vi.fn() },
    activatedEmail: vi.fn(),
    rejectedEmail: vi.fn(),
  };
});
vi.mock('./prisma', () => ({ prisma: mocks.prisma }));
vi.mock('./mailer', () => ({
  sendPlanActivatedEmail: mocks.activatedEmail,
  sendPaymentRejectedEmail: mocks.rejectedEmail,
}));

import { PaymentReviewError, reviewDirectUpiPayment } from './payment-review';

const pending = {
  id: 'payment', userId: 'user', userEmail: 'user@example.com', payerName: 'User', payerUpiId: 'user@upi',
  planType: 'PREMIUM', amount: 299, utrNumber: '123456789012', status: 'PENDING_REVIEW',
  approvedAt: null, reviewedBy: null, reviewNote: null, createdAt: new Date(), updatedAt: new Date(),
};

describe('payment review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.directUpiPayment.findUnique.mockResolvedValue(pending);
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.tx));
    mocks.tx.$queryRaw.mockResolvedValue([{ lockResult: '' }]);
    mocks.tx.directUpiPayment.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.directUpiPayment.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'VERIFIED' });
    mocks.tx.user.update.mockResolvedValue({});
    mocks.tx.user.findUniqueOrThrow.mockResolvedValue({ plan: 'FREE', planActivatedAt: null });
    mocks.tx.auditLog.create.mockResolvedValue({});
    mocks.activatedEmail.mockResolvedValue({ sent: true });
    mocks.rejectedEmail.mockResolvedValue({ sent: true });
  });

  it('claims a pending payment once, activates the plan, audits, and emails', async () => {
    const result = await reviewDirectUpiPayment({
      paymentId: 'payment', decision: 'VERIFIED', reviewedBy: 'admin', source: 'DASHBOARD', reviewNote: 'Bank matched',
    });
    expect(mocks.tx.directUpiPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment', status: 'PENDING_REVIEW' },
      data: expect.objectContaining({ status: 'VERIFIED', reviewedBy: 'admin', approvedAt: expect.any(Date) }),
    }));
    expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plan: 'PREMIUM', monthlyDmQuota: 750, subscriptionStatus: 'ACTIVE' }),
    }));
    expect(mocks.activatedEmail).toHaveBeenCalledWith('user@example.com', 'PREMIUM', 750);
    expect(result.status).toBe('VERIFIED');
  });

  it('takes the owner quota lock (cast, inside the review transaction) before changing the plan', async () => {
    await reviewDirectUpiPayment({ paymentId: 'payment', decision: 'VERIFIED', reviewedBy: 'admin', source: 'DASHBOARD' });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [queryParts, lockKey] = mocks.tx.$queryRaw.mock.calls[0];
    expect(Array.from(queryParts as TemplateStringsArray).join('<key>'))
      .toBe('SELECT pg_advisory_xact_lock(hashtextextended(<key>, 0))::text AS "lockResult"');
    expect(lockKey).toBe('quota:user');
    // The lock is the first statement of the transaction.
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.directUpiPayment.updateMany.mock.invocationCallOrder[0]);
    expect(mocks.tx.directUpiPayment.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.tx.user.update.mock.invocationCallOrder[0]);
  });

  it('rejects without cancelling an already-active paid term', async () => {
    mocks.tx.user.findUniqueOrThrow.mockResolvedValue({ plan: 'STANDARD', planActivatedAt: new Date() });
    mocks.tx.directUpiPayment.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'REJECTED' });
    await reviewDirectUpiPayment({
      paymentId: 'payment', decision: 'REJECTED', reviewedBy: 'telegram:1', source: 'TELEGRAM', reviewNote: 'Not found',
    });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user' }, data: { subscriptionStatus: 'ACTIVE' },
    });
    expect(mocks.rejectedEmail).toHaveBeenCalledWith('user@example.com', 'PREMIUM', 'Not found');
  });

  it('rejects missing, already-reviewed, invalid-plan, and concurrently claimed records', async () => {
    mocks.prisma.directUpiPayment.findUnique.mockResolvedValueOnce(null);
    await expect(reviewDirectUpiPayment({ paymentId: 'x', decision: 'VERIFIED', reviewedBy: 'a', source: 'DASHBOARD' }))
      .rejects.toMatchObject({ status: 404 });

    mocks.prisma.directUpiPayment.findUnique.mockResolvedValueOnce({ ...pending, status: 'VERIFIED' });
    await expect(reviewDirectUpiPayment({ paymentId: 'x', decision: 'VERIFIED', reviewedBy: 'a', source: 'DASHBOARD' }))
      .rejects.toBeInstanceOf(PaymentReviewError);

    mocks.prisma.directUpiPayment.findUnique.mockResolvedValueOnce({ ...pending, planType: 'FREE' });
    await expect(reviewDirectUpiPayment({ paymentId: 'x', decision: 'VERIFIED', reviewedBy: 'a', source: 'DASHBOARD' }))
      .rejects.toMatchObject({ status: 400 });

    mocks.prisma.directUpiPayment.findUnique.mockResolvedValueOnce(pending);
    mocks.tx.directUpiPayment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reviewDirectUpiPayment({ paymentId: 'x', decision: 'VERIFIED', reviewedBy: 'a', source: 'DASHBOARD' }))
      .rejects.toMatchObject({ status: 409 });
  });
});
