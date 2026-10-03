import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';
import { diffTables, seedProductionLikeWorkspace } from '@/test/fixtures';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));
vi.mock('./prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import {
  ANALYTICS_RESET_AUDIT_ACTION,
  ANALYTICS_RESET_AUTOMATION_DATA,
  ANALYTICS_RESET_USER_DATA,
  resetUserAnalytics,
} from './analytics-reset';

beforeEach(() => state.db.reset());

describe('resetUserAnalytics', () => {
  it('writes exactly the allowed analytics columns and nothing else', () => {
    expect(ANALYTICS_RESET_USER_DATA).toEqual({ totalCommentsReceived: 0 });
    expect(ANALYTICS_RESET_AUTOMATION_DATA).toEqual({ totalTriggers: 0, totalSuccess: 0, totalFailed: 0, lastTriggeredAt: null });
  });

  it('zeroes the comment counter and every owned flow’s counters, leaving all other data untouched', async () => {
    const { lastTrigger } = seedProductionLikeWorkspace(state.db);
    const before = state.db.snapshot();

    const result = await resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' });

    expect(result).toEqual({
      targetUserId: 'creator',
      automationsReset: 2,
      previous: {
        totalCommentsReceived: 84, automationCount: 2, totalTriggers: 25, totalSuccess: 22, totalFailed: 3,
        lastTriggeredAt: lastTrigger.toISOString(),
      },
    });
    const audit = state.db.rows('auditLog').find((row) => row.action === ANALYTICS_RESET_AUDIT_ACTION)!;
    const changes = diffTables(before, state.db.snapshot());
    expect(changes).toEqual(expect.arrayContaining([
      { model: 'user', id: 'creator', change: 'field:totalCommentsReceived' },
      { model: 'auditLog', id: audit.id, change: 'added' },
    ]));
    // Only these fields may differ (updatedAt is maintained by Prisma).
    const allowed = new Set([
      'user/creator/field:totalCommentsReceived', 'user/creator/field:updatedAt',
      ...['flow-active', 'flow-paused'].flatMap((id) => ['totalTriggers', 'totalSuccess', 'totalFailed', 'lastTriggeredAt', 'updatedAt']
        .map((field) => `automation/${id}/field:${field}`)),
      `auditLog/${audit.id}/added`,
    ]);
    expect(changes.map((entry) => `${entry.model}/${entry.id}/${entry.change}`).filter((key) => !allowed.has(key))).toEqual([]);

    expect(state.db.row('user', { id: 'creator' })).toMatchObject({
      totalCommentsReceived: 0, dmsUsedThisMonth: 37, monthlyDmQuota: 250, plan: 'STANDARD', subscriptionStatus: 'ACTIVE',
      role: 'USER', passwordHash: 'creator-password-hash', sessionVersion: 3,
    });
    for (const id of ['flow-active', 'flow-paused']) {
      expect(state.db.row('automation', { id })).toMatchObject({ totalTriggers: 0, totalSuccess: 0, totalFailed: 0, lastTriggeredAt: null });
    }
    expect(state.db.row('automation', { id: 'flow-active' })?.status).toBe('ACTIVE');
    expect(state.db.row('automation', { id: 'flow-paused' })?.status).toBe('PAUSED');
    expect(state.db.row('user', { id: 'bystander' })?.totalCommentsReceived).toBe(7);
    expect(state.db.row('automation', { id: 'bystander-flow' })?.totalTriggers).toBe(4);
  });

  it('writes an audit entry with the admin, target, and previous totals only — no secrets or message content', async () => {
    seedProductionLikeWorkspace(state.db);
    await resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' });

    const audit = state.db.rows('auditLog').find((row) => row.action === ANALYTICS_RESET_AUDIT_ACTION)!;
    expect(audit.userId).toBe('creator');
    expect(audit.details).toEqual({
      adminId: 'admin',
      targetUserId: 'creator',
      automationsReset: 2,
      previousTotals: expect.objectContaining({ totalCommentsReceived: 84, totalTriggers: 25, totalSuccess: 22, totalFailed: 3 }),
    });
    const serialized = JSON.stringify(audit);
    for (const secret of ['password-hash', 'ciphertext', 'guide please', '555-0100', 'creator@example.test']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('runs as one transaction holding the cast analytics-reset lock, with no deletes', async () => {
    seedProductionLikeWorkspace(state.db);
    await resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' });

    expect(state.db.transactions).toEqual([expect.objectContaining({ outcome: 'committed' })]);
    const transactionId = state.db.transactions[0].id;
    expect(state.db.rawQueries).toEqual([expect.objectContaining({ values: ['analytics-reset:creator'], transactionId })]);
    expect(state.db.rawQueries[0].sql).toContain('::text AS "lockResult"');
    expect(state.db.operations.every((entry) => entry.transactionId === transactionId)).toBe(true);
    const writes = state.db.operations.filter((entry) => !/^(find|count|aggregate)/.test(entry.operation));
    expect(writes.map((entry) => ({ model: entry.model, operation: entry.operation, where: entry.args.where, data: entry.args.data }))).toEqual([
      { model: 'user', operation: 'update', where: { id: 'creator' }, data: { totalCommentsReceived: 0 } },
      { model: 'automation', operation: 'updateMany', where: { userId: 'creator' }, data: ANALYTICS_RESET_AUTOMATION_DATA },
      { model: 'auditLog', operation: 'create', where: undefined, data: expect.objectContaining({ action: ANALYTICS_RESET_AUDIT_ACTION }) },
    ]);
  });

  it('rolls everything back if the audit entry cannot be written', async () => {
    seedProductionLikeWorkspace(state.db);
    const before = state.db.snapshot();
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'auditLog' && entry.operation === 'create') throw new Error('audit insert failed');
    };
    await expect(resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' })).rejects.toThrow('audit insert failed');
    expect(diffTables(before, state.db.snapshot())).toEqual([]);
  });

  it('returns null and writes nothing for an unknown user', async () => {
    seedProductionLikeWorkspace(state.db);
    const before = state.db.snapshot();
    await expect(resetUserAnalytics({ adminId: 'admin', targetUserId: 'missing' })).resolves.toBeNull();
    expect(diffTables(before, state.db.snapshot())).toEqual([]);
  });

  it('handles users without flows and records zeros on a repeated or concurrent double submit', async () => {
    state.db.seed('user', { id: 'empty', email: 'empty@example.test', passwordHash: 'x', totalCommentsReceived: 3 });
    await expect(resetUserAnalytics({ adminId: 'admin', targetUserId: 'empty' })).resolves.toMatchObject({
      automationsReset: 0,
      previous: { totalCommentsReceived: 3, automationCount: 0, totalTriggers: 0, totalSuccess: 0, totalFailed: 0, lastTriggeredAt: null },
    });

    state.db.reset();
    seedProductionLikeWorkspace(state.db);
    const [first, second] = await Promise.all([
      resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' }),
      resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' }),
    ]);
    const totals = [first!.previous.totalCommentsReceived, second!.previous.totalCommentsReceived].sort((a, b) => a - b);
    expect(totals).toEqual([0, 84]);
    expect(state.db.rows('auditLog').filter((row) => row.action === ANALYTICS_RESET_AUDIT_ACTION)).toHaveLength(2);
  });
});
