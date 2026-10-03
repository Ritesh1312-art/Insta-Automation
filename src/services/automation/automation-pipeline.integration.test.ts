/**
 * Opt-in integration tests against a real PostgreSQL database through the
 * production Prisma client (Rust-free client + @prisma/adapter-pg).
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/insta_test npx vitest run src/services/automation/automation-pipeline.integration.test.ts
 *
 * The database must already have the migrations applied, and its name must
 * contain "test": every table is truncated between tests. Without
 * TEST_DATABASE_URL the suite is skipped.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ACCESS_TOKEN = 'EAAG-integration-token-0123456789abcdef';
const IG = 'ig-integration';

describe.skipIf(!TEST_DATABASE_URL)('automation pipeline on PostgreSQL (TEST_DATABASE_URL)', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let AutomationEngine: typeof import('./AutomationEngine').AutomationEngine;
  let lock: typeof import('@/lib/advisory-lock');
  let quota: typeof import('@/lib/quota');
  let resetUserAnalytics: typeof import('@/lib/analytics-reset').resetUserAnalytics;
  let encryptToken: typeof import('@/lib/encryption').encryptToken;
  let tables: string[] = [];

  beforeAll(async () => {
    const databaseName = new URL(TEST_DATABASE_URL!).pathname.slice(1);
    if (!/test/i.test(databaseName)) {
      throw new Error(`Refusing to run: database "${databaseName}" does not look like a test database (its tables are truncated).`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ prisma } = await import('@/lib/prisma'));
    ({ AutomationEngine } = await import('./AutomationEngine'));
    lock = await import('@/lib/advisory-lock');
    quota = await import('@/lib/quota');
    ({ resetUserAnalytics } = await import('@/lib/analytics-reset'));
    ({ encryptToken } = await import('@/lib/encryption'));
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    tables = rows.map((row) => `"${row.tablename.replace(/"/g, '""')}"`);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(', ')} CASCADE`);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/messages')) return Response.json({ recipient_id: 'fan', message_id: 'mid-1' });
      if (path.endsWith('/replies')) return Response.json({ id: 'reply-1' });
      return Response.json({ error: { code: 100, message: 'unexpected call' } }, { status: 400 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { await prisma?.$disconnect(); });

  async function seedWorkspace(owner: Record<string, unknown> = {}) {
    await prisma.user.create({
      data: {
        id: 'creator', email: 'creator@example.test', passwordHash: 'hash', plan: 'FREE', monthlyDmQuota: 30,
        quotaResetAt: new Date(Date.now() + 20 * 86_400_000), totalCommentsReceived: 84, ...owner,
      },
    });
    await prisma.metaConnection.create({
      data: { userId: 'creator', metaUserId: 'meta', instagramAccountId: IG, instagramUsername: 'creator', accessTokenEncrypted: encryptToken(ACCESS_TOKEN) },
    });
    const media = await prisma.media.create({ data: { instagramAccountId: IG, instagramMediaId: 'reel-1', mediaType: 'REEL', timestamp: new Date() } });
    await prisma.automation.create({
      data: {
        id: 'flow', userId: 'creator', instagramAccountId: IG, mediaId: media.id, name: 'Guide flow', status: 'ACTIVE',
        keywords: ['guide'], followGateEnabled: false, dmMessageTemplate: 'Here you go', publicReplyEnabled: true,
        publicReplyTemplates: ['Check your DMs!'], totalTriggers: 20, totalSuccess: 17, totalFailed: 3, lastTriggeredAt: new Date(),
      },
    });
  }

  it('rejects the old uncast lock query with P2010 and accepts the helper’s cast query', async () => {
    const key = 'integration:void';
    await expect(prisma.$transaction((tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`))
      .rejects.toMatchObject({ code: 'P2010' });
    await expect(lock.withTransactionAdvisoryLock(prisma, key, async () => 'locked')).resolves.toBe('locked');
  });

  it('holds the advisory lock for the whole transaction and releases it at commit', async () => {
    const key = 'integration:held';
    const tryLock = async () => {
      const [row] = await prisma.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked`;
      if (row.locked) await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
      return row.locked;
    };
    await lock.withTransactionAdvisoryLock(prisma, key, async () => {
      expect(await tryLock()).toBe(false); // another session cannot take it
    });
    expect(await tryLock()).toBe(true);
  });

  it('processes an ACTIVE matching comment end to end with real quota locks', async () => {
    await seedWorkspace();
    const result = await AutomationEngine.processCommentEvent({
      instagramAccountId: IG, mediaId: 'reel-1', commentId: 'comment-1', commenterId: 'fan-1', commenterUsername: 'fan',
      commentText: 'guide', rawPayload: {},
    });
    expect(result).toMatchObject({ status: 'PROCESSED' });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: 'creator' } })).resolves.toMatchObject({ totalCommentsReceived: 85, dmsUsedThisMonth: 1 });
    await expect(prisma.automation.findUniqueOrThrow({ where: { id: 'flow' } })).resolves.toMatchObject({ totalTriggers: 21, totalSuccess: 18, status: 'ACTIVE' });
    await expect(prisma.automationRun.findFirstOrThrow()).resolves.toMatchObject({ status: 'API_ACCEPTED', dmStatus: 'SENT', publicReplyStatus: 'SENT' });
    await expect(prisma.webhookEvent.findFirstOrThrow()).resolves.toMatchObject({ status: 'PROCESSED' });

    const duplicate = await AutomationEngine.processCommentEvent({
      instagramAccountId: IG, mediaId: 'reel-1', commentId: 'comment-1', commenterId: 'fan-1', commenterUsername: 'fan',
      commentText: 'guide', rawPayload: {},
    });
    expect(duplicate.status).toBe('IGNORED');
    expect(await prisma.automationRun.count()).toBe(1);
  });

  it('never over-reserves the DM quota under concurrent reservations', async () => {
    await seedWorkspace({ monthlyDmQuota: 3 });
    const results = await Promise.all(Array.from({ length: 8 }, () => quota.reserveDmQuota('creator')));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: 'creator' } })).resolves.toMatchObject({ dmsUsedThisMonth: 3 });
  });

  it('resets only analytics counters for the target user', async () => {
    await seedWorkspace({ dmsUsedThisMonth: 12 });
    await prisma.user.create({ data: { id: 'admin', email: 'admin@example.test', passwordHash: 'x', role: 'ADMIN' } });
    const result = await resetUserAnalytics({ adminId: 'admin', targetUserId: 'creator' });
    expect(result?.previous).toMatchObject({ totalCommentsReceived: 84, totalTriggers: 20, totalSuccess: 17, totalFailed: 3 });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: 'creator' } })).resolves.toMatchObject({ totalCommentsReceived: 0, dmsUsedThisMonth: 12, plan: 'FREE' });
    await expect(prisma.automation.findUniqueOrThrow({ where: { id: 'flow' } })).resolves.toMatchObject({
      status: 'ACTIVE', totalTriggers: 0, totalSuccess: 0, totalFailed: 0, lastTriggeredAt: null, keywords: ['guide'],
    });
    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'ADMIN_ANALYTICS_RESET' } })).resolves.toMatchObject({
      userId: 'creator', details: expect.objectContaining({ adminId: 'admin', targetUserId: 'creator' }),
    });
  });
});
