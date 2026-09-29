import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  connectionFindFirst: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    automation: {
      deleteMany: mocks.deleteMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
      create: mocks.create,
    },
    metaConnection: { findFirst: mocks.connectionFindFirst },
  },
}));

import { DELETE, POST } from './route';

describe('DELETE /api/automations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionUser.mockResolvedValue({ userId: 'owner', email: 'owner@example.com', role: 'USER' });
  });

  it('deletes only an ownership-scoped parent and relies on database cascade', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const response = await DELETE(new Request('https://app.example.com/api/automations?id=auto-1') as never);
    expect(response.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'auto-1', userId: 'owner' } });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('does not reveal or delete another user’s automation', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    const response = await DELETE(new Request('https://app.example.com/api/automations?id=foreign') as never);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Automation not found' });
  });
});

describe('POST /api/automations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionUser.mockResolvedValue({ userId: 'owner', email: 'owner@example.com', role: 'USER' });
    mocks.connectionFindFirst.mockResolvedValue({ instagramAccountId: 'ig-owner' });
  });

  it('updates the selected owned flow instead of silently creating a duplicate', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'auto-1', userId: 'owner', status: 'ACTIVE' });
    mocks.update.mockResolvedValue({ id: 'auto-1', name: 'Updated flow' });
    const request = new Request('https://app.example.com/api/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'auto-1',
        name: 'Updated flow',
        status: 'PAUSED',
        triggerType: 'KEYWORD',
        matchingMode: 'EXACT',
        keywords: ['guide'],
        dmMessageTemplate: 'Here is your guide',
      }),
    });

    const response = await POST(request as never);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'auto-1' } }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('cannot update a missing or foreign flow ID', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const request = new Request('https://app.example.com/api/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        automationId: 'foreign',
        name: 'Bad update',
        status: 'PAUSED',
        triggerType: 'ANY_COMMENT',
        dmMessageTemplate: 'Nope',
      }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
