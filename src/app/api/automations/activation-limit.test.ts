import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType, session: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireSessionUser: state.session }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { PATCH, POST } from './route';

const FLOW = { triggerType: 'KEYWORD', matchingMode: 'EXACT', keywords: ['guide'], dmMessageTemplate: 'Here is your guide' };

function request(method: 'POST' | 'PATCH', body: unknown) {
  return new Request('https://app.example.test/api/automations', {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

function seedFlow(status: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('automation', { userId: 'owner', instagramAccountId: 'ig-owner', name: `${status} flow`, status, ...FLOW, ...overrides });
}

const activeFlows = () => state.db.rows('automation').filter((flow) => flow.userId === 'owner' && flow.status === 'ACTIVE');

beforeEach(() => {
  state.db.reset();
  state.session.mockReset();
  state.session.mockResolvedValue({ userId: 'owner', email: 'owner@example.test', role: 'USER' });
  state.db.seed('user', { id: 'owner', email: 'owner@example.test', passwordHash: 'hash', plan: 'FREE' }); // 1 active flow allowed
  state.db.seed('metaConnection', { userId: 'owner', metaUserId: 'meta', instagramAccountId: 'ig-owner', instagramUsername: 'creator', accessTokenEncrypted: 'secret' });
});

describe('active automation limit', () => {
  it('checks the limit and saves inside one transaction holding the cast per-user lock', async () => {
    const response = await POST(request('POST', { name: 'Launch', status: 'ACTIVE', ...FLOW }));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const [lock] = state.db.rawQueries;
    expect(state.db.rawQueries).toHaveLength(1);
    expect(lock).toMatchObject({ values: ['automation-limit:owner'], transactionId: expect.any(Number) });
    expect(lock.sql).toContain('::text AS "lockResult"');
    const lockedOperations = state.db.operations.filter((entry) => entry.transactionId === lock.transactionId);
    expect(lockedOperations.map((entry) => `${entry.model}.${entry.operation}`)).toEqual(['automation.count', 'automation.create']);
    expect(state.db.transactions[0]).toMatchObject({ outcome: 'committed' });
  });

  it('lets only one of several concurrent activations take the last slot', async () => {
    const flows = [seedFlow('PAUSED'), seedFlow('PAUSED'), seedFlow('DRAFT')];
    const responses = await Promise.all(flows.map((flow) => PATCH(request('PATCH', { id: flow.id, status: 'ACTIVE' }))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409]);
    expect(activeFlows()).toHaveLength(1);

    const conflict = responses.find((response) => response.status === 409)!;
    await expect(conflict.json()).resolves.toEqual({ error: 'Your plan allows 1 active automation.' });
  });

  it('lets only one of several concurrent ACTIVE creations succeed', async () => {
    const responses = await Promise.all(['One', 'Two', 'Three'].map((name) => POST(request('POST', { name, status: 'ACTIVE', ...FLOW }))));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409]);
    expect(activeFlows()).toHaveLength(1);
    const conflict = responses.find((response) => response.status === 409)!;
    await expect(conflict.json()).resolves.toEqual({ error: 'Your plan allows 1 active automation. Pause one or upgrade.' });
  });

  it('still allows editing a flow that is already ACTIVE at the limit', async () => {
    const flow = seedFlow('ACTIVE');
    const response = await POST(request('POST', { automationId: flow.id, name: 'Renamed', status: 'ACTIVE', ...FLOW }));
    expect(response.status).toBe(200);
    expect(state.db.row('automation', { id: flow.id })).toMatchObject({ name: 'Renamed', status: 'ACTIVE' });
    const reactivate = await PATCH(request('PATCH', { id: flow.id, status: 'ACTIVE' }));
    expect(reactivate.status).toBe(200);
  });

  it('pauses without taking the lock and does not limit admins', async () => {
    const flow = seedFlow('ACTIVE');
    const paused = await PATCH(request('PATCH', { id: flow.id, status: 'PAUSED' }));
    expect(paused.status).toBe(200);
    expect(state.db.rawQueries).toHaveLength(0);

    state.db.reset();
    state.db.seed('user', { id: 'owner', email: 'owner@example.test', passwordHash: 'hash', role: 'ADMIN' });
    state.db.seed('metaConnection', { userId: 'owner', metaUserId: 'meta', instagramAccountId: 'ig-owner', instagramUsername: 'creator' });
    seedFlow('ACTIVE');
    const extra = await POST(request('POST', { name: 'Admin extra', status: 'ACTIVE', ...FLOW }));
    expect(extra.status).toBe(201);
    expect(activeFlows()).toHaveLength(2);
  });

  it('does not activate another user’s flow', async () => {
    const foreign = state.db.seed('automation', { userId: 'other', instagramAccountId: 'ig-other', name: 'Foreign', status: 'PAUSED', ...FLOW });
    const response = await PATCH(request('PATCH', { id: foreign.id, status: 'ACTIVE' }));
    expect(response.status).toBe(404);
    expect(state.db.row('automation', { id: foreign.id })?.status).toBe('PAUSED');
  });
});
