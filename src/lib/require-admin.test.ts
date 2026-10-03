import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('./auth', () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock('./prisma', () => ({ prisma: mocks.prisma }));

import { isAuthError, requireAdmin } from './require-admin';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUser.mockResolvedValue({ userId: 'user-id', email: 'user@example.test', role: 'USER' });
  mocks.prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
});

describe('admin authorization guard', () => {
  it('rejects a regular USER with FORBIDDEN', async () => {
    await expect(requireAdmin()).rejects.toMatchObject({ message: 'FORBIDDEN' });
    expect(isAuthError(new Error('FORBIDDEN'), 'FORBIDDEN')).toBe(true);
  });

  it('checks the current database role instead of trusting a stale ADMIN JWT claim', async () => {
    mocks.requireSessionUser.mockResolvedValue({ userId: 'user-id', email: 'user@example.test', role: 'ADMIN' });
    mocks.prisma.user.findUnique.mockResolvedValue({ role: 'USER' });

    await expect(requireAdmin()).rejects.toMatchObject({ message: 'FORBIDDEN' });
  });

  it('permits only a session whose current database account is ADMIN', async () => {
    const session = { userId: 'admin-id', email: 'admin@example.test', role: 'ADMIN', sessionVersion: 2 };
    mocks.requireSessionUser.mockResolvedValue(session);
    mocks.prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });

    await expect(requireAdmin()).resolves.toEqual(session);
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-id' },
      select: { role: true },
    });
  });
});
