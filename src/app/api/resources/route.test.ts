import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.session }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    resource: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      delete: mocks.remove,
    },
  },
}));

import { DELETE, GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: 'owner' });
});

describe('resource library API', () => {
  it('returns only the signed-in user resources with flow usage counts', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'resource-1', _count: { automations: 2 } }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner' },
      include: { _count: { select: { automations: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('creates validated text resources owned by the session user', async () => {
    mocks.create.mockResolvedValue({ id: 'resource-1' });
    const request = new NextRequest('https://app.example.com/api/resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Prompt pack', type: 'TEXT', textContent: 'Reusable prompt' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'owner', name: 'Prompt pack', type: 'TEXT', textContent: 'Reusable prompt' }),
    });
  });

  it('prevents deleting a resource while a flow uses it', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'resource-1', _count: { automations: 1 } });
    const response = await DELETE(new NextRequest('https://app.example.com/api/resources?id=resource-1', { method: 'DELETE' }));
    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('deletes an unused resource only after ownership verification', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'resource-1', _count: { automations: 0 } });
    mocks.remove.mockResolvedValue({ id: 'resource-1' });
    const response = await DELETE(new NextRequest('https://app.example.com/api/resources?id=resource-1', { method: 'DELETE' }));
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'resource-1', userId: 'owner' } }));
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'resource-1' } });
  });
});
