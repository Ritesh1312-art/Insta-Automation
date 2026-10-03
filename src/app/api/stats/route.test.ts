import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType, session: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireSessionUser: state.session }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { GET as getStats } from './route';
import { GET as getFlows } from '../automations/route';

function signIn(userId: string | null) {
  if (userId) state.session.mockResolvedValue({ userId, email: `${userId}@example.test`, role: 'USER' });
  else state.session.mockRejectedValue(new Error('UNAUTHORIZED'));
}

function seedOwner(id: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('user', { id, email: `${id}@example.test`, passwordHash: 'hash', ...overrides });
}

function seedConnection(userId: string, instagramAccountId: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('metaConnection', {
    userId, metaUserId: `meta-${instagramAccountId}`, instagramAccountId, instagramUsername: `${userId}_ig`,
    accessTokenEncrypted: `encrypted-token-${instagramAccountId}`, ...overrides,
  });
}

function seedFlow(userId: string, instagramAccountId: string, status: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('automation', {
    userId, instagramAccountId, status, name: `${userId} ${status} flow`, keywords: ['guide'], dmMessageTemplate: 'Here you go',
    ...overrides,
  });
}

async function studio(userId: string) {
  signIn(userId);
  const response = await getStats();
  return { response, body: await response.json() };
}

async function flows(userId: string) {
  signIn(userId);
  const response = await getFlows();
  return { response, body: await response.json() };
}

beforeEach(() => {
  state.db.reset();
  state.session.mockReset();
});

describe('Studio statistics API', () => {
  it('returns owner-scoped connection, flow, comment, execution, and quota totals', async () => {
    seedOwner('owner', { totalCommentsReceived: 12, plan: 'PREMIUM', monthlyDmQuota: 750, dmsUsedThisMonth: 25, subscriptionStatus: 'ACTIVE' });
    seedConnection('owner', 'ig-owner', { instagramUsername: 'creator' });
    const active = seedFlow('owner', 'ig-owner', 'ACTIVE');
    seedFlow('owner', 'ig-owner', 'ACTIVE');
    seedFlow('owner', 'ig-owner', 'PAUSED');
    const event = state.db.seed('webhookEvent', { instagramAccountId: 'ig-owner', eventType: 'comments', rawPayload: {} });
    for (const status of ['API_ACCEPTED', 'API_ACCEPTED', 'API_ACCEPTED', 'FAILED', 'RETRYING']) {
      state.db.seed('automationRun', { automationId: active.id, webhookEventId: event.id, idempotencyKey: `run-${Math.random()}`, status });
    }
    // Another account's activity must not leak into these totals.
    seedOwner('other', { totalCommentsReceived: 99 });
    seedConnection('other', 'ig-other');
    const foreign = seedFlow('other', 'ig-other', 'ACTIVE');
    state.db.seed('automationRun', { automationId: foreign.id, webhookEventId: event.id, idempotencyKey: 'foreign-run', status: 'API_ACCEPTED' });

    const { response, body } = await studio('owner');
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      totalAutomations: 3,
      activeAutomations: 2,
      totalCommentsReceived: 12,
      totalRuns: 5,
      totalSuccess: 3,
      totalFailed: 1,
      successRate: 60,
      connectionStatus: 'CONNECTED',
      instagramUsername: 'creator',
      plan: 'PREMIUM',
      monthlyDmQuota: 750,
      dmsUsedThisMonth: 25,
    });
    expect(JSON.stringify(body)).not.toContain('encrypted-token');
  });

  it('shows one ACTIVE flow as 1/1, matching the Flows list', async () => {
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');
    seedFlow('owner', 'ig-owner', 'ACTIVE');

    const [stats, list] = [await studio('owner'), await flows('owner')];
    expect(stats.body).toMatchObject({ activeAutomations: 1, totalAutomations: 1 });
    expect(list.body.automations).toHaveLength(1);
    expect(list.body.automations[0].status).toBe('ACTIVE');
  });

  it('always reports the same flows the Flows list returns, isolated per user and across reconnected accounts', async () => {
    seedOwner('alice');
    seedConnection('alice', 'ig-alice-old', { connectionStatus: 'DISCONNECTED' });
    seedConnection('alice', 'ig-alice-new');
    seedFlow('alice', 'ig-alice-new', 'ACTIVE');
    seedFlow('alice', 'ig-alice-new', 'PAUSED');
    seedFlow('alice', 'ig-alice-old', 'ACTIVE'); // still listed in Flows, so it must count in Studio too

    seedOwner('bob');
    seedConnection('bob', 'ig-bob');
    for (const status of ['ACTIVE', 'ACTIVE', 'DRAFT', 'ARCHIVED']) seedFlow('bob', 'ig-bob', status);

    seedOwner('carol'); // no connection, no flows

    for (const userId of ['alice', 'bob', 'carol']) {
      const [stats, list] = [await studio(userId), await flows(userId)];
      const listed = list.body.automations as Array<{ id: string; userId: string; status: string }>;
      expect(listed.every((flow) => flow.userId === userId)).toBe(true);
      expect(stats.body.totalAutomations).toBe(listed.length);
      expect(stats.body.activeAutomations).toBe(listed.filter((flow) => flow.status === 'ACTIVE').length);
    }
    expect((await studio('alice')).body).toMatchObject({ totalAutomations: 3, activeAutomations: 2 });
    expect((await studio('bob')).body).toMatchObject({ totalAutomations: 4, activeAutomations: 2 });
    expect((await studio('carol')).body).toMatchObject({ totalAutomations: 0, activeAutomations: 0, connectionStatus: 'DISCONNECTED' });
  });

  it('counts only flows whose stored status is exactly ACTIVE', async () => {
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');
    for (const status of ['ACTIVE', 'active', 'ACTIVE ', 'PAUSED', 'ERROR', 'DRAFT', 'ARCHIVED']) seedFlow('owner', 'ig-owner', status);
    const { body } = await studio('owner');
    expect(body).toMatchObject({ totalAutomations: 7, activeAutomations: 1 });
  });

  it('reports the owner comment counter rather than retained webhook events', async () => {
    seedOwner('owner', { totalCommentsReceived: 0 });
    seedConnection('owner', 'ig-owner');
    for (let index = 0; index < 4; index += 1) {
      state.db.seed('webhookEvent', { instagramAccountId: 'ig-owner', eventType: index % 2 ? 'messaging' : 'comments', rawPayload: {} });
    }
    expect((await studio('owner')).body.totalCommentsReceived).toBe(0);
    expect(state.db.rows('webhookEvent')).toHaveLength(4);
  });

  it('is never cacheable, including authentication and server errors', async () => {
    seedOwner('owner');
    expect((await studio('owner')).response.headers.get('cache-control')).toBe('private, no-store');

    signIn(null);
    const unauthorized = await getStats();
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('cache-control')).toBe('private, no-store');

    vi.spyOn(state.db.client.automation, 'count').mockRejectedValueOnce(new Error('database unavailable'));
    const failed = await studio('owner');
    expect(failed.response.status).toBe(500);
    expect(failed.response.headers.get('cache-control')).toBe('private, no-store');
    expect(failed.body).toEqual({ error: 'Unable to load dashboard statistics' });
  });
});

describe('Flows list API', () => {
  it('returns only the signed-in user’s flows, uncached, without connection secrets', async () => {
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');
    const own = seedFlow('owner', 'ig-owner', 'ACTIVE');
    seedOwner('other');
    seedConnection('other', 'ig-other');
    seedFlow('other', 'ig-other', 'ACTIVE');

    const { response, body } = await flows('owner');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.automations.map((flow: { id: string }) => flow.id)).toEqual([own.id]);
    expect(body.automations[0].metaConnection).toEqual({
      id: expect.any(String), instagramAccountId: 'ig-owner', instagramUsername: 'owner_ig', connectionStatus: 'CONNECTED',
    });
    expect(JSON.stringify(body)).not.toContain('encrypted-token');
  });

  it('returns uncached 401 and 500 responses', async () => {
    signIn(null);
    const unauthorized = await getFlows();
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('cache-control')).toBe('private, no-store');

    seedOwner('owner');
    vi.spyOn(state.db.client.automation, 'findMany').mockRejectedValueOnce(new Error('database unavailable'));
    const failed = await flows('owner');
    expect(failed.response.status).toBe(500);
    expect(failed.response.headers.get('cache-control')).toBe('private, no-store');
  });
});
