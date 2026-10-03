import { describe, expect, it, vi } from 'vitest';
import { FakePrisma } from '@/test/fake-prisma';
import {
  ADVISORY_LOCK_TRANSACTION_OPTIONS,
  AdvisoryLockUsageError,
  acquireTransactionAdvisoryLock,
  advisoryLockKeys,
  withTransactionAdvisoryLock,
} from './advisory-lock';

function transactionClient() {
  return { $queryRaw: vi.fn().mockResolvedValue([{ lockResult: '' }]) };
}

describe('acquireTransactionAdvisoryLock', () => {
  it('casts the void lock result to text and binds the key as a parameter', async () => {
    const tx = transactionClient();
    await acquireTransactionAdvisoryLock(tx as never, 'quota:user-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [parts, ...values] = tx.$queryRaw.mock.calls[0];
    expect(Array.from(parts as TemplateStringsArray)).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended(',
      ', 0))::text AS "lockResult"',
    ]);
    expect(values).toEqual(['quota:user-1']);
  });

  it('rejects blank keys and the root client, whose implicit transaction would release the lock at once', async () => {
    const tx = transactionClient();
    await expect(acquireTransactionAdvisoryLock(tx as never, '')).rejects.toBeInstanceOf(AdvisoryLockUsageError);
    await expect(acquireTransactionAdvisoryLock(tx as never, '   ')).rejects.toBeInstanceOf(AdvisoryLockUsageError);
    const root = { ...transactionClient(), $transaction: vi.fn() };
    await expect(acquireTransactionAdvisoryLock(root as never, 'quota:user-1')).rejects.toThrow(/interactive transaction client/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(root.$queryRaw).not.toHaveBeenCalled();
  });

  it('succeeds where an uncast lock query fails with the production P2010 error', async () => {
    const db = new FakePrisma();
    const key = 'quota:user-1';
    await expect(db.client.$transaction((tx: any) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`))
      .rejects.toMatchObject({ code: 'P2010' });
    await expect(db.client.$transaction((tx: any) => acquireTransactionAdvisoryLock(tx, key))).resolves.toBeUndefined();
    expect(db.lockEvents.map((event) => event.event)).toEqual(['acquired', 'released']);
  });
});

describe('withTransactionAdvisoryLock', () => {
  it('locks first, then runs the work with the same transaction client', async () => {
    const tx = transactionClient();
    const client = { $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)) };
    const work = vi.fn(async (received: unknown) => {
      expect(received).toBe(tx);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      return 'done';
    });

    await expect(withTransactionAdvisoryLock(client as never, 'automation-limit:user-1', work)).resolves.toBe('done');
    expect(work).toHaveBeenCalledTimes(1);
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), ADVISORY_LOCK_TRANSACTION_OPTIONS);
  });

  it('lets callers override transaction options and propagates failures so the transaction rolls back', async () => {
    const db = new FakePrisma();
    const user = db.seed('user', { email: 'u@example.test', passwordHash: 'x' });
    await expect(withTransactionAdvisoryLock(db.client, 'k', async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { dmsUsedThisMonth: 9 } });
      throw new Error('boom');
    }, { timeout: 30_000 })).rejects.toThrow('boom');
    expect(db.row('user', { id: user.id })?.dmsUsedThisMonth).toBe(0);
    expect(db.transactions[0]).toMatchObject({ outcome: 'rolled-back', options: { maxWait: 10_000, timeout: 30_000 } });
    expect(db.lockEvents.at(-1)).toMatchObject({ key: 'k', event: 'released' });
  });

  it('serializes work that shares a key and leaves other keys concurrent', async () => {
    const db = new FakePrisma();
    const timeline: string[] = [];
    const task = (key: string, label: string) => withTransactionAdvisoryLock(db.client, key, async () => {
      timeline.push(`${label}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      timeline.push(`${label}:end`);
    });
    await Promise.all([task('shared', 'a'), task('shared', 'b'), task('other', 'c')]);
    expect(timeline.indexOf('b:start')).toBeGreaterThan(timeline.indexOf('a:end'));
    expect(timeline.indexOf('c:start')).toBeLessThan(timeline.indexOf('a:end'));
  });
});

describe('advisoryLockKeys', () => {
  it('namespaces keys per feature and keeps the legacy rate-limit format', () => {
    expect(advisoryLockKeys.quota('u')).toBe('quota:u');
    expect(advisoryLockKeys.automationLimit('u')).toBe('automation-limit:u');
    expect(advisoryLockKeys.analyticsReset('u')).toBe('analytics-reset:u');
    expect(advisoryLockKeys.adminSetup()).toBe('admin-setup');
    expect(advisoryLockKeys.rateLimit('RATE_LIMIT_LOGIN', 'abc')).toBe('RATE_LIMIT_LOGIN:abc');
  });
});
