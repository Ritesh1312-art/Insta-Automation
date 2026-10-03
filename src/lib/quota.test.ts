import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));
vi.mock('./prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import {
  applyApprovedPlan,
  assertDmQuota,
  planAssignmentData,
  releaseDmQuota,
  reserveDmQuota,
  resetDmUsage,
  resetDueQuotas,
  resetQuotaIfNeeded,
} from './quota';

const DAY = 86_400_000;
const future = () => new Date(Date.now() + DAY);
const past = () => new Date(Date.now() - 31 * DAY);

function seedUser(overrides: Record<string, unknown> = {}) {
  return state.db.seed('user', {
    id: 'user', email: 'user@example.test', passwordHash: 'hash', role: 'USER', plan: 'FREE',
    monthlyDmQuota: 30, dmsUsedThisMonth: 0, quotaResetAt: future(), planActivatedAt: null,
    ...overrides,
  });
}

const user = () => state.db.row('user', { id: 'user' })!;
const userWrites = () => state.db.operations.filter((entry) => entry.model === 'user' && /update|create|upsert/.test(entry.operation));

beforeEach(() => state.db.reset());

describe('quota lifecycle', () => {
  it('builds a complete 30-day paid-plan assignment', () => {
    const now = new Date('2026-09-29T00:00:00Z');
    expect(planAssignmentData('PREMIUM', now)).toMatchObject({
      plan: 'PREMIUM', monthlyDmQuota: 750, dmsUsedThisMonth: 0,
      subscriptionStatus: 'ACTIVE', planActivatedAt: now,
    });
  });

  it('leaves admins and users before reset unchanged', async () => {
    seedUser({ role: 'ADMIN' });
    await expect(resetQuotaIfNeeded('user')).resolves.toMatchObject({ role: 'ADMIN' });
    state.db.reset();
    seedUser();
    await expect(resetQuotaIfNeeded('user')).resolves.toMatchObject({ id: 'user', dmsUsedThisMonth: 0 });
    expect(userWrites()).toHaveLength(0);
    await expect(resetQuotaIfNeeded('missing')).resolves.toBeNull();
  });

  it('initializes legacy paid activation dates and expires old paid plans', async () => {
    seedUser({ plan: 'PREMIUM', monthlyDmQuota: 750 });
    await resetQuotaIfNeeded('user');
    expect(user().planActivatedAt).toBeInstanceOf(Date);
    expect(user().quotaResetAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

    state.db.reset();
    seedUser({ plan: 'PREMIUM', monthlyDmQuota: 750, planActivatedAt: past(), dmsUsedThisMonth: 400 });
    await resetQuotaIfNeeded('user');
    expect(user()).toMatchObject({ plan: 'FREE', monthlyDmQuota: 30, dmsUsedThisMonth: 0, subscriptionStatus: 'EXPIRED', planActivatedAt: null });
  });

  it('resets a due free quota', async () => {
    seedUser({ quotaResetAt: past(), dmsUsedThisMonth: 30 });
    await resetQuotaIfNeeded('user');
    expect(user().dmsUsedThisMonth).toBe(0);
    expect(user().quotaResetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('reports exhausted quotas and atomically reserves available sends', async () => {
    seedUser({ dmsUsedThisMonth: 30 });
    await expect(assertDmQuota('user')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('quota reached') });
    await expect(reserveDmQuota('user')).resolves.toMatchObject({ ok: false });
    expect(user().dmsUsedThisMonth).toBe(30);

    state.db.reset();
    seedUser({ dmsUsedThisMonth: 29 });
    await expect(assertDmQuota('user')).resolves.toEqual({ ok: true });
    await expect(reserveDmQuota('user')).resolves.toEqual({ ok: true, charged: true });
    expect(user().dmsUsedThisMonth).toBe(30);
    await expect(reserveDmQuota('user')).resolves.toMatchObject({ ok: false });
    await expect(reserveDmQuota('missing')).resolves.toEqual({ ok: false, message: 'Workspace owner not found' });
  });

  it('bypasses charging admins and releases normal reservations safely', async () => {
    seedUser({ role: 'ADMIN', dmsUsedThisMonth: 3 });
    const adminReservation = await reserveDmQuota('user');
    expect(adminReservation).toEqual({ ok: true, charged: false });
    await releaseDmQuota('user', adminReservation);
    expect(user().dmsUsedThisMonth).toBe(3);

    state.db.reset();
    seedUser({ dmsUsedThisMonth: 1 });
    await releaseDmQuota('user', { ok: true, charged: true });
    await releaseDmQuota('user', { ok: true, charged: true });
    expect(user().dmsUsedThisMonth).toBe(0); // never negative
    await releaseDmQuota('user', { ok: false, message: 'not reserved' });
    expect(user().dmsUsedThisMonth).toBe(0);
  });

  it('applies approved plans, resets DM usage, and processes users due for reset', async () => {
    seedUser({ dmsUsedThisMonth: 12 });
    await applyApprovedPlan('user', 'STANDARD');
    expect(user()).toMatchObject({ plan: 'STANDARD', monthlyDmQuota: 250, dmsUsedThisMonth: 0, subscriptionStatus: 'ACTIVE' });

    await reserveDmQuota('user');
    await expect(resetDmUsage('user')).resolves.toMatchObject({ dmsUsedThisMonth: 0, plan: 'STANDARD' });
    await expect(resetDmUsage('missing')).resolves.toBeNull();

    state.db.reset();
    state.db.seed('user', { id: 'one', email: 'one@example.test', passwordHash: 'x', quotaResetAt: past(), dmsUsedThisMonth: 9 });
    state.db.seed('user', { id: 'two', email: 'two@example.test', passwordHash: 'x', quotaResetAt: null, dmsUsedThisMonth: 4 });
    state.db.seed('user', { id: 'admin', email: 'admin@example.test', passwordHash: 'x', role: 'ADMIN', quotaResetAt: past() });
    state.db.seed('user', { id: 'current', email: 'current@example.test', passwordHash: 'x', quotaResetAt: future(), dmsUsedThisMonth: 2 });
    await expect(resetDueQuotas()).resolves.toBe(2);
    expect(state.db.row('user', { id: 'one' })?.dmsUsedThisMonth).toBe(0);
    expect(state.db.row('user', { id: 'two' })?.dmsUsedThisMonth).toBe(0);
    expect(state.db.row('user', { id: 'current' })?.dmsUsedThisMonth).toBe(2);
  });
});

describe('quota advisory locking', () => {
  it('takes the cast per-user lock inside the transaction before reading or reserving', async () => {
    seedUser({ dmsUsedThisMonth: 2 });
    await expect(reserveDmQuota('user')).resolves.toEqual({ ok: true, charged: true });

    expect(state.db.rawQueries).toHaveLength(1);
    const [lock] = state.db.rawQueries;
    expect(lock.sql).toContain('SELECT pg_advisory_xact_lock(hashtextextended($?, 0))::text AS "lockResult"');
    expect(lock.values).toEqual(['quota:user']);
    expect(lock.transactionId).not.toBeNull();

    // Every quota read/write ran in the same transaction that holds the lock.
    const userOperations = state.db.operationsFor('user');
    expect(userOperations.map((entry) => entry.operation)).toEqual(['findUnique', 'updateMany']);
    expect(userOperations.every((entry) => entry.transactionId === lock.transactionId)).toBe(true);
    expect(state.db.transactions).toEqual([
      expect.objectContaining({ id: lock.transactionId, outcome: 'committed', options: { maxWait: 10_000, timeout: 15_000 } }),
    ]);
    expect(state.db.lockEvents).toEqual([
      { key: 'quota:user', transactionId: lock.transactionId, event: 'acquired' },
      { key: 'quota:user', transactionId: lock.transactionId, event: 'released' },
    ]);
  });

  it('locks every quota mutation path (reset, assert, release, admin reset, plan approval)', async () => {
    seedUser({ dmsUsedThisMonth: 5 });
    await resetQuotaIfNeeded('user');
    await assertDmQuota('user');
    await releaseDmQuota('user', { ok: true, charged: true });
    await resetDmUsage('user');
    await applyApprovedPlan('user', 'PREMIUM');
    expect(state.db.rawQueries.map((query) => query.values[0])).toEqual(Array(5).fill('quota:user'));
    expect(state.db.rawQueries.every((query) => query.transactionId !== null && query.sql.includes('::text'))).toBe(true);
    expect(state.db.operationsFor('user').every((entry) => entry.transactionId !== null)).toBe(true);
  });

  it('serializes concurrent reservations so a plan cap is never exceeded', async () => {
    seedUser({ monthlyDmQuota: 3, dmsUsedThisMonth: 0 });
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveDmQuota('user')));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(user().dmsUsedThisMonth).toBe(3);

    // Lock holders never overlap: every acquisition is followed by its own release.
    const events = state.db.lockEvents;
    for (let index = 0; index < events.length; index += 2) {
      expect(events[index]).toMatchObject({ event: 'acquired' });
      expect(events[index + 1]).toMatchObject({ event: 'released', transactionId: events[index].transactionId });
    }
  });

  it('never lets a concurrent cycle expiry overwrite a plan that is being approved', async () => {
    seedUser({ plan: 'PREMIUM', monthlyDmQuota: 750, planActivatedAt: past(), subscriptionStatus: 'ACTIVE' });
    await Promise.all([resetQuotaIfNeeded('user'), applyApprovedPlan('user', 'PREMIUM')]);
    // Either order is correct once serialized; without the lock the stale
    // expiry write would land last and downgrade the user to FREE/EXPIRED.
    expect(user()).toMatchObject({ plan: 'PREMIUM', subscriptionStatus: 'ACTIVE', monthlyDmQuota: 750 });
  });

  it('keeps processing scheduled resets when one user fails, logging only a safe message', async () => {
    state.db.seed('user', { id: 'one', email: 'one@example.test', passwordHash: 'x', quotaResetAt: past(), dmsUsedThisMonth: 9 });
    state.db.seed('user', { id: 'two', email: 'two@example.test', passwordHash: 'x', quotaResetAt: past(), dmsUsedThisMonth: 4 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.db.beforeRawQuery = (_sql, values) => {
      if (values[0] === 'quota:one') throw new Error('connection reset; postgresql://admin:pw@db.example/prod');
    };
    await expect(resetDueQuotas()).resolves.toBe(1);
    expect(state.db.row('user', { id: 'two' })?.dmsUsedThisMonth).toBe(0);
    expect(state.db.row('user', { id: 'one' })?.dmsUsedThisMonth).toBe(9);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('admin:pw');
  });
});
