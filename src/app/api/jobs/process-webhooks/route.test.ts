import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const mocks = vi.hoisted(() => ({
  processDueEvents: vi.fn(),
  resetDueQuotas: vi.fn(),
  db: null as unknown as FakePrismaType,
}));

vi.mock('@/services/automation/AutomationEngine', () => ({ AutomationEngine: { processDueEvents: mocks.processDueEvents } }));
vi.mock('@/lib/quota', () => ({ resetDueQuotas: mocks.resetDueQuotas }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  mocks.db = new FakePrisma();
  return { prisma: mocks.db.client };
});

import { GET } from './route';

const DAY = 86_400_000;
function request(authorization?: string) {
  return new NextRequest('http://internal/api/jobs/process-webhooks', {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  mocks.db.reset();
  mocks.processDueEvents.mockResolvedValue([{ status: 'PROCESSED', message: 'Private reply accepted by Meta' }]);
  mocks.resetDueQuotas.mockResolvedValue(2);
  process.env.CRON_SECRET = 'cron-secret';
});

describe('jobs/process-webhooks GET authorization', () => {
  it('rejects anonymous, wrong, and non-bearer callers', async () => {
    await expect(GET(request())).resolves.toMatchObject({ status: 401 });
    await expect(GET(request('Bearer nope'))).resolves.toMatchObject({ status: 401 });
    await expect(GET(request(`nope ${'cron-secret'}`))).resolves.toMatchObject({ status: 401 });
    expect(mocks.processDueEvents).not.toHaveBeenCalled();
  });

  it('stays closed when no CRON_SECRET is configured', async () => {
    delete process.env.CRON_SECRET;
    await expect(GET(request('Bearer '))).resolves.toMatchObject({ status: 401 });
    await expect(GET(request('Bearer '))).resolves.toMatchObject({ status: 401 });
    expect(mocks.processDueEvents).not.toHaveBeenCalled();
  });

  it('accepts the exact bearer secret and rejects same-length forgeries', async () => {
    await expect(GET(request('Bearer cron-secret!'))).resolves.toMatchObject({ status: 401 });
    await expect(GET(request('Bearer cron-secret'))).resolves.toMatchObject({ status: 200 });
  });
});

describe('jobs/process-webhooks GET behavior', () => {
  it('drains due events, resets due quotas, and reports both counts', async () => {
    const response = await GET(request('Bearer cron-secret'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processed: 1,
      quotasReset: 2,
      results: [{ status: 'PROCESSED', message: 'Private reply accepted by Meta' }],
    });
    expect(mocks.processDueEvents).toHaveBeenCalledTimes(1);
    expect(mocks.resetDueQuotas).toHaveBeenCalledTimes(1);
  });

  it('purges terminal webhook events by the 30/90-day retention windows only', async () => {
    const age = (days: number) => new Date(Date.now() - days * DAY);
    const seeded = (status: string, createdAt: Date) => mocks.db.seed('webhookEvent', {
      instagramAccountId: null, eventId: `${status}:${createdAt.getTime()}:${Math.random()}`, eventType: 'comments',
      commentId: 'c', rawPayload: {}, status, createdAt,
    });
    const staleProcessed = seeded('PROCESSED', age(31));
    const staleIgnored = seeded('IGNORED', age(40));
    const staleFailed = seeded('FAILED', age(91));
    const freshProcessed = seeded('PROCESSED', age(1));
    const recentFailed = seeded('FAILED', age(30));
    const oldButRetryable = seeded('RETRYING', age(400));
    const oldButUnprocessed = seeded('RECEIVED', age(400));

    const response = await GET(request('Bearer cron-secret'));
    await expect(response.json()).resolves.toMatchObject({ webhookRetention: 3 });

    const remaining = new Set(mocks.db.rows('webhookEvent').map((row) => row.id as string));
    for (const gone of [staleProcessed, staleIgnored, staleFailed]) expect(remaining.has(gone.id)).toBe(false);
    for (const kept of [freshProcessed, recentFailed, oldButRetryable, oldButUnprocessed]) expect(remaining.has(kept.id)).toBe(true);
  });

  it('deletes only retainable messaging/rate-limit audit rows after 180 days', async () => {
    const age = (days: number) => new Date(Date.now() - days * DAY);
    const audit = (action: string, createdAt: Date) => mocks.db.seed('auditLog', {
      userId: null, action, details: { note: 'x' }, createdAt,
    });
    const oldMessaging = audit('MESSAGING_PROCESSED', age(181));
    const oldMessagingFailed = audit('MESSAGING_FAILED', age(181));
    const oldFollowGate = audit('FOLLOW_GATE_VERIFIED', age(181));
    const recentMessaging = audit('MESSAGING_PROCESSED', age(10));
    const oldUnrelated = audit('LOGIN', age(400));

    const response = await GET(request('Bearer cron-secret'));
    await expect(response.json()).resolves.toMatchObject({ auditRetention: 3 });

    const remaining = new Set(mocks.db.rows('auditLog').map((row) => row.id as string));
    for (const gone of [oldMessaging, oldMessagingFailed, oldFollowGate]) expect(remaining.has(gone.id)).toBe(false);
    for (const kept of [recentMessaging, oldUnrelated]) expect(remaining.has(kept.id)).toBe(true);
  });

  it('still runs quota resets when a due-event batch fails', async () => {
    mocks.processDueEvents.mockRejectedValue(new Error('db down'));
    await expect(GET(request('Bearer cron-secret'))).rejects.toThrow('db down');
    expect(mocks.resetDueQuotas).toHaveBeenCalledTimes(1);
  });
});
