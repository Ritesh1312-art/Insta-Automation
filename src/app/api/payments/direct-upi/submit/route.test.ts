import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    directUpiPayment: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    user: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prisma: { user: { findUnique: vi.fn() }, $transaction: vi.fn() },
    session: vi.fn(),
    email: vi.fn(),
    telegram: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.session }));
vi.mock('@/lib/mailer', () => ({ sendPaymentSubmittedEmail: mocks.email }));
vi.mock('@/lib/telegram', () => ({ notifyTelegramPaymentSubmitted: mocks.telegram }));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new Request('https://app.example.com/api/payments/direct-upi/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('Direct UPI submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: 'user-1', email: 'user@example.com', role: 'USER' });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.$queryRaw.mockResolvedValue([{ id: 'user-1' }]);
    mocks.tx.directUpiPayment.findUnique.mockResolvedValue(null);
    mocks.tx.directUpiPayment.findFirst.mockResolvedValue(null);
    mocks.tx.directUpiPayment.create.mockImplementation(async ({ data }) => ({ id: 'payment-1', createdAt: new Date(), ...data }));
    mocks.tx.user.update.mockResolvedValue({});
    mocks.tx.auditLog.create.mockResolvedValue({});
    mocks.email.mockResolvedValue({ sent: true });
    mocks.telegram.mockResolvedValue(true);
  });

  it('locks the user and stores the server-side plan price, never a client amount', async () => {
    const response = await POST(request({
      planType: 'PREMIUM', payerName: 'Ritesh Gupta', payerUpiId: 'ritesh@okaxis',
      utrNumber: '123456789012', amount: 1,
    }));
    expect(response.status).toBe(200);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.tx.directUpiPayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      planType: 'PREMIUM', amount: 29_900, utrNumber: '123456789012', status: 'PENDING_REVIEW',
    }) });
    await expect(response.json()).resolves.toMatchObject({ success: true, status: 'PENDING_REVIEW' });
  });

  it('rejects a second pending payment inside the same transaction', async () => {
    mocks.tx.directUpiPayment.findFirst.mockResolvedValue({ id: 'pending' });
    const response = await POST(request({
      planType: 'STANDARD', payerName: 'Ritesh Gupta', payerUpiId: 'ritesh@okaxis', utrNumber: '123456789012',
    }));
    expect(response.status).toBe(409);
    expect(mocks.tx.directUpiPayment.create).not.toHaveBeenCalled();
  });

  it('validates UTR and payer data before touching the database', async () => {
    const response = await POST(request({ planType: 'PREMIUM', payerName: 'R', payerUpiId: 'bad', utrNumber: '1' }));
    expect(response.status).toBe(400);
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
