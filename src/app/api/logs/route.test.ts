import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  runs: vi.fn(),
  webhooks: vi.fn(),
  audits: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.session }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    automationRun: { findMany: mocks.runs },
    webhookEvent: { findMany: mocks.webhooks },
    auditLog: { findMany: mocks.audits },
  },
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: 'owner' });
  mocks.runs.mockResolvedValue([]);
  mocks.webhooks.mockResolvedValue([]);
  mocks.audits.mockResolvedValue([]);
});

describe('dashboard logs API', () => {
  it('scopes every log stream to the signed-in workspace and reads current messaging audits', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({
      where: { automation: { userId: 'owner' } },
    }));
    expect(mocks.webhooks).toHaveBeenCalledWith(expect.objectContaining({
      where: { metaConnection: { userId: 'owner' } },
    }));
    expect(mocks.audits).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner', action: { startsWith: 'MESSAGING_' } },
    }));
  });

  it('returns 401 without a session', async () => {
    mocks.session.mockRejectedValue(new Error('UNAUTHORIZED'));
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.runs).not.toHaveBeenCalled();
  });
});
