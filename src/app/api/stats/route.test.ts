import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  connection: vi.fn(),
  automationCount: vi.fn(),
  webhookCount: vi.fn(),
  runCount: vi.fn(),
  user: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.session }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    metaConnection: { findFirst: mocks.connection },
    automation: { count: mocks.automationCount },
    webhookEvent: { count: mocks.webhookCount },
    automationRun: { count: mocks.runCount },
    user: { findUnique: mocks.user },
  },
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: 'owner' });
  mocks.connection.mockResolvedValue({
    connectionStatus: 'CONNECTED', instagramUsername: 'creator', profilePictureUrl: null,
  });
  mocks.automationCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
  mocks.webhookCount.mockResolvedValue(12);
  mocks.runCount.mockResolvedValueOnce(10).mockResolvedValueOnce(8).mockResolvedValueOnce(1);
  mocks.user.mockResolvedValue({
    plan: 'PREMIUM', monthlyDmQuota: 750, dmsUsedThisMonth: 25,
    quotaResetAt: null, subscriptionStatus: 'ACTIVE', role: 'USER',
  });
});

describe('Studio statistics API', () => {
  it('returns account-owned connection, flow, webhook, and execution totals', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalAutomations: 3,
      activeAutomations: 2,
      totalCommentsReceived: 12,
      totalRuns: 10,
      totalSuccess: 8,
      totalFailed: 1,
      successRate: 80,
      connectionStatus: 'CONNECTED',
      instagramUsername: 'creator',
      plan: 'PREMIUM',
      monthlyDmQuota: 750,
      dmsUsedThisMonth: 25,
    });
    expect(mocks.connection).toHaveBeenCalledWith({
      where: { userId: 'owner' }, orderBy: { createdAt: 'desc' },
    });
    expect(mocks.webhookCount).toHaveBeenCalledWith({
      where: { metaConnection: { userId: 'owner' } },
    });
  });
});
