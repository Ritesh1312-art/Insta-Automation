import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  prisma: { user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/require-admin', () => ({
  requireAdmin: mocks.requireAdmin,
  isAuthError: (error: unknown, code: string) => error instanceof Error && error.message === code,
}));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockRejectedValue(new Error('FORBIDDEN'));
});

describe('admin users API authorization', () => {
  it('returns 403 to a regular USER for admin user data', async () => {
    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Admin only' });
  });

  it('returns 403 to a regular USER for admin user mutations', async () => {
    const request = new NextRequest('https://app.example.test/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'RESET_QUOTA', userId: 'other-user' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Admin only' });
  });
});
