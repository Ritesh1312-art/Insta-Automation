import { describe, expect, it } from 'vitest';
import { FakePrisma, VOID_DESERIALIZATION_MESSAGE } from './fake-prisma';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('FakePrisma test double', () => {
  it('rejects an uncast advisory-lock query with the production P2010 error', async () => {
    const db = new FakePrisma();
    const key = 'quota:user-1';
    await expect(db.client.$transaction(async (tx: any) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`))
      .rejects.toMatchObject({ code: 'P2010', meta: { message: VOID_DESERIALIZATION_MESSAGE } });
    await expect(db.client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
      .rejects.toMatchObject({ code: 'P2010' });
    await expect(db.client.$transaction(async (tx: any) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lockResult"`))
      .resolves.toEqual([{ lockResult: '' }]);
  });

  it('holds a transaction advisory lock until the transaction settles', async () => {
    const db = new FakePrisma();
    const order: string[] = [];
    const lock = (tx: any) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'same-key'}, 0))::text AS "lockResult"`;
    const first = db.client.$transaction(async (tx: any) => {
      await lock(tx);
      order.push('first acquired');
      await tick();
      order.push('first done');
    });
    const second = db.client.$transaction(async (tx: any) => {
      await lock(tx);
      order.push('second acquired');
    });
    const otherKey = db.client.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'other-key'}, 0))::text AS "lockResult"`;
      order.push('other key acquired');
    });
    await Promise.all([first, second, otherKey]);
    expect(order.indexOf('second acquired')).toBeGreaterThan(order.indexOf('first done'));
    expect(order.indexOf('other key acquired')).toBeLessThan(order.indexOf('first done'));
  });

  it('rolls back an interactive transaction and enforces unique constraints', async () => {
    const db = new FakePrisma();
    const user = db.seed('user', { email: 'a@example.test', passwordHash: 'x' });
    await expect(db.client.$transaction(async (tx: any) => {
      await tx.user.update({ where: { id: user.id }, data: { totalCommentsReceived: { increment: 5 } } });
      await tx.user.create({ data: { email: 'a@example.test', passwordHash: 'y' } });
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(db.row('user', { id: user.id })?.totalCommentsReceived).toBe(0);
    expect(db.rows('user')).toHaveLength(1);
    expect(db.transactions.at(-1)?.outcome).toBe('rolled-back');
  });

  it('supports relation filters, includes, selects, counts, and aggregates', async () => {
    const db = new FakePrisma();
    const owner = db.seed('user', { email: 'owner@example.test', passwordHash: 'x' });
    db.seed('metaConnection', { userId: owner.id, metaUserId: 'm', instagramAccountId: 'ig-1', instagramUsername: 'creator', accessTokenEncrypted: 'secret' });
    db.seed('automation', { userId: owner.id, instagramAccountId: 'ig-1', name: 'A', dmMessageTemplate: 'x', status: 'ACTIVE', totalTriggers: 2 });
    db.seed('automation', { userId: owner.id, instagramAccountId: 'ig-1', name: 'B', dmMessageTemplate: 'x', totalTriggers: 3 });
    const [flow] = await db.client.automation.findMany({
      where: { metaConnection: { userId: owner.id }, status: 'ACTIVE' },
      include: { metaConnection: { select: { instagramUsername: true } } },
    });
    expect(flow).toMatchObject({ name: 'A', metaConnection: { instagramUsername: 'creator' } });
    expect(flow.metaConnection).not.toHaveProperty('accessTokenEncrypted');
    await expect(db.client.user.findUnique({ where: { id: owner.id }, select: { _count: { select: { automations: true } } } }))
      .resolves.toEqual({ _count: { automations: 2 } });
    await expect(db.client.automation.aggregate({ where: { userId: owner.id }, _count: { _all: true }, _sum: { totalTriggers: true } }))
      .resolves.toEqual({ _count: { _all: 2 }, _sum: { totalTriggers: 5 } });
  });
});
