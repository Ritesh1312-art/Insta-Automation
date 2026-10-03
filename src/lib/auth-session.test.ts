import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('./prisma', () => ({ prisma: mocks.prisma }));

import { requireSessionUser, signToken } from './auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('session-version enforcement', () => {
  it('rejects a signed session after the account sessionVersion changes', async () => {
    const token = await signToken({
      userId: 'user-id',
      email: 'user@example.test',
      role: 'USER',
      sessionVersion: 3,
    });
    mocks.cookies.mockResolvedValue({ get: () => ({ value: token }) });
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.test',
      role: 'USER',
      sessionVersion: 4,
    });

    await expect(requireSessionUser()).rejects.toMatchObject({ message: 'UNAUTHORIZED' });
  });

  it('uses the current database account when the session version still matches', async () => {
    const token = await signToken({
      userId: 'user-id',
      email: 'old@example.test',
      role: 'USER',
      sessionVersion: 4,
    });
    mocks.cookies.mockResolvedValue({ get: () => ({ value: token }) });
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: 'current@example.test',
      role: 'USER',
      sessionVersion: 4,
    });

    await expect(requireSessionUser()).resolves.toMatchObject({
      userId: 'user-id',
      email: 'current@example.test',
      role: 'USER',
      sessionVersion: 4,
    });
  });
});
