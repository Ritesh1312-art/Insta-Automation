import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';
import { diffTables, seedProductionLikeWorkspace } from '@/test/fixtures';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType, session: vi.fn() }));
// Only the session cookie is mocked; requireAdmin re-reads the role from the database.
vi.mock('@/lib/auth', () => ({ requireSessionUser: state.session }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { GET, POST } from './route';

function signIn(userId: string | null, tokenRole = 'ADMIN') {
  if (userId) state.session.mockResolvedValue({ userId, email: `${userId}@example.test`, role: tokenRole });
  else state.session.mockRejectedValue(new Error('UNAUTHORIZED'));
}

function post(body: unknown) {
  return POST(new NextRequest('https://app.example.test/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

const SECRETS = ['password-hash', 'ciphertext', 'passwordHash', 'telegramBotTokenEncrypted', 'accessTokenEncrypted'];

beforeEach(() => {
  state.db.reset();
  state.session.mockReset();
  seedProductionLikeWorkspace(state.db);
});

describe('admin users API authorization', () => {
  it('returns 401 without a session', async () => {
    signIn(null);
    const list = await GET();
    expect(list.status).toBe(401);
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    expect((await post({ action: 'RESET_ANALYTICS', userId: 'creator' })).status).toBe(401);
  });

  it('returns 403 to a regular USER for admin user data and mutations', async () => {
    signIn('creator', 'USER');
    const before = state.db.snapshot();
    const list = await GET();
    expect(list.status).toBe(403);
    await expect(list.json()).resolves.toEqual({ error: 'Admin only' });

    for (const action of ['RESET_ANALYTICS', 'RESET_QUOTA', 'APPLY_PLAN']) {
      const response = await post({ action, userId: 'creator', planId: 'PREMIUM' });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'Admin only' });
    }
    expect(diffTables(before, state.db.snapshot())).toEqual([]);
  });

  it('trusts the database role, not a stale ADMIN claim in the session token', async () => {
    signIn('creator', 'ADMIN'); // demoted user still holding an old token
    const response = await post({ action: 'RESET_ANALYTICS', userId: 'creator' });
    expect(response.status).toBe(403);
    expect(state.db.row('user', { id: 'creator' })?.totalCommentsReceived).toBe(84);
  });
});

describe('admin users API validation', () => {
  beforeEach(() => signIn('admin'));

  it.each([
    ['malformed JSON', '{not json'],
    ['a missing user', { action: 'RESET_ANALYTICS' }],
    ['a blank user', { action: 'RESET_ANALYTICS', userId: '   ' }],
    ['a non-string user', { action: 'RESET_ANALYTICS', userId: 42 }],
    ['a missing action', { userId: 'creator' }],
    ['an unknown action', { action: 'RESET_EVERYTHING', userId: 'creator' }],
    ['a differently cased action', { action: 'reset_analytics', userId: 'creator' }],
  ])('rejects %s with 400 and changes nothing', async (_label, body) => {
    const before = state.db.snapshot();
    const response = await post(body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'userId and a valid action are required' });
    expect(diffTables(before, state.db.snapshot())).toEqual([]);
  });

  it('returns 404 for an unknown target user without writing an audit entry', async () => {
    const before = state.db.snapshot();
    const response = await post({ action: 'RESET_ANALYTICS', userId: 'no-such-user' });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'User not found' });
    expect(diffTables(before, state.db.snapshot())).toEqual([]);
  });
});

describe('RESET_ANALYTICS', () => {
  beforeEach(() => signIn('admin'));

  it('resets only the target user’s analytics and reports the previous totals', async () => {
    const before = state.db.snapshot();
    const response = await post({ action: 'RESET_ANALYTICS', userId: 'creator' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      analytics: {
        automationsReset: 2,
        previous: expect.objectContaining({ totalCommentsReceived: 84, automationCount: 2, totalTriggers: 25 }),
      },
    });
    for (const secret of SECRETS) expect(JSON.stringify(body)).not.toContain(secret);

    // Comments received 84 -> 0; flow counters cleared.
    expect(state.db.row('user', { id: 'creator' })?.totalCommentsReceived).toBe(0);
    expect(state.db.row('automation', { id: 'flow-active' })).toMatchObject({
      status: 'ACTIVE', totalTriggers: 0, totalSuccess: 0, totalFailed: 0, lastTriggeredAt: null,
    });

    // DM quota, plan, flows, connection, logs, payments, and other users are untouched.
    const changed = diffTables(before, state.db.snapshot())
      .filter((entry) => !(entry.model === 'auditLog' && entry.change === 'added'))
      .map((entry) => `${entry.model}/${entry.id}/${entry.change}`);
    expect(changed.sort()).toEqual([
      'automation/flow-active/field:lastTriggeredAt', 'automation/flow-active/field:totalFailed',
      'automation/flow-active/field:totalSuccess', 'automation/flow-active/field:totalTriggers', 'automation/flow-active/field:updatedAt',
      'automation/flow-paused/field:lastTriggeredAt', 'automation/flow-paused/field:totalSuccess',
      'automation/flow-paused/field:totalTriggers', 'automation/flow-paused/field:updatedAt',
      'user/creator/field:totalCommentsReceived', 'user/creator/field:updatedAt',
    ]);
    expect(state.db.row('user', { id: 'creator' })).toMatchObject({ dmsUsedThisMonth: 37, plan: 'STANDARD', subscriptionStatus: 'ACTIVE' });

    const audits = state.db.rows('auditLog').filter((row) => row.action === 'ADMIN_ANALYTICS_RESET');
    expect(audits).toEqual([expect.objectContaining({
      userId: 'creator',
      details: expect.objectContaining({ adminId: 'admin', targetUserId: 'creator' }),
    })]);
  });

  it('shows the reset immediately in the user list', async () => {
    await post({ action: 'RESET_ANALYTICS', userId: 'creator' });
    const list = await (await GET()).json();
    expect(list.users.find((user: { id: string }) => user.id === 'creator')).toMatchObject({
      totalCommentsReceived: 0, dmsUsedThisMonth: 37, _count: { automations: 2, directUpiPayments: 1 },
    });
  });

  it('returns a generic 500 and leaves data unchanged if the reset transaction fails', async () => {
    const before = state.db.snapshot();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'auditLog') throw new Error('insert failed for creator@example.test');
    };
    const response = await post({ action: 'RESET_ANALYTICS', userId: 'creator' });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Unable to update user' });
    expect(diffTables(before, state.db.snapshot())).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('other admin user actions', () => {
  beforeEach(() => signIn('admin'));

  it('lists users with analytics counters but never password hashes or encrypted tokens', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.users.find((user: { id: string }) => user.id === 'creator')).toMatchObject({ totalCommentsReceived: 84 });
    for (const secret of SECRETS) expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('RESET_QUOTA clears DM usage under the quota lock and leaves analytics alone', async () => {
    const response = await post({ action: 'RESET_QUOTA', userId: 'creator' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toMatchObject({ id: 'creator', dmsUsedThisMonth: 0, totalCommentsReceived: 84, plan: 'STANDARD' });
    for (const secret of SECRETS) expect(JSON.stringify(body)).not.toContain(secret);
    expect(state.db.rawQueries.map((query) => query.values[0])).toEqual(['quota:creator']);
    expect(state.db.row('automation', { id: 'flow-active' })?.totalTriggers).toBe(20);
  });

  it('APPLY_PLAN returns only the safe user view', async () => {
    const response = await post({ action: 'APPLY_PLAN', userId: 'creator', planId: 'PREMIUM' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toMatchObject({ plan: 'PREMIUM', monthlyDmQuota: 750, totalCommentsReceived: 84 });
    for (const secret of SECRETS) expect(JSON.stringify(body)).not.toContain(secret);
    expect((await post({ action: 'APPLY_PLAN', userId: 'creator', planId: 'GOLD' })).status).toBe(400);
  });
});
