/**
 * GROUP A1 + A3 — Meta OAuth callback and media sync, driven through the real
 * HTTP server against the mock Graph API and a real PostgreSQL database.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_URL,
  BASE_URL,
  IG_ACCOUNT_ID,
  PAGE_ID,
  PAGE_TOKEN,
  Session,
  clearMails,
  integrationEnabled,
  readGraphCalls,
  resetGraphControl,
  setMockMediaError,
  truncateAll,
  truncateMockLogs,
  MOCK_GRAPH_LOG,
} from './helpers';

const describeIntegration = integrationEnabled ? describe : describe.skip;
const PASSWORD = 'StrongPass123!';

describeIntegration('A1 Meta OAuth callback (live mock Graph API)', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let createOAuthState: typeof import('@/lib/auth').createOAuthState;
  let decryptToken: typeof import('@/lib/encryption').decryptToken;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ prisma } = await import('@/lib/prisma'));
    ({ createOAuthState } = await import('@/lib/auth'));
    ({ decryptToken } = await import('@/lib/encryption'));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearMails();
    await resetGraphControl();
    truncateMockLogs(MOCK_GRAPH_LOG);
  });

  it('starts the flow at /api/auth/meta/url with a signed state', async () => {
    const session = new Session();
    const registered = await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'creator@example.test', password: PASSWORD, name: 'Creator' }),
    });
    expect(registered.status).toBe(201);

    const { status, body } = await session.json<{ url: string }>('/api/auth/meta/url');
    expect(status).toBe(200);
    const url = new URL(body.url);
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.searchParams.get('client_id')).toBe(process.env.META_APP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/auth/meta/callback`);
    expect(url.searchParams.get('state')?.split('.')).toHaveLength(3);
    expect(url.searchParams.get('scope')).toContain('instagram_manage_messages');
  });

  it('exchanges the code, subscribes webhooks, syncs media and stores an encrypted token', async () => {
    const session = new Session();
    const registered = await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'creator@example.test', password: PASSWORD }),
    });
    expect(registered.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'creator@example.test' } });

    const state = await createOAuthState(user.id);
    const callback = await session.fetch(`/api/auth/meta/callback?code=GOOD_CODE&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(307);
    const location = new URL(callback.headers.get('location') as string);
    expect(location.pathname).toBe('/dashboard');
    expect(location.searchParams.get('connected')).toBe('true');
    expect(location.searchParams.get('synced')).toBe('4'); // 2 pages x 2 items
    expect(location.searchParams.get('webhookWarning')).toBeNull();

    const connection = await prisma.metaConnection.findUniqueOrThrow({ where: { instagramAccountId: IG_ACCOUNT_ID } });
    expect(connection).toMatchObject({
      userId: user.id,
      metaUserId: 'meta-user-1',
      facebookPageId: PAGE_ID,
      instagramUsername: 'mock.creator',
      connectionStatus: 'CONNECTED',
      tokenType: 'BEARER',
    });
    // The token column is real ciphertext, not the plaintext page token.
    expect(connection.accessTokenEncrypted).toBeTruthy();
    expect(connection.accessTokenEncrypted).not.toContain(PAGE_TOKEN);
    expect(connection.accessTokenEncrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:/);
    expect(decryptToken(connection.accessTokenEncrypted as string)).toBe(PAGE_TOKEN);
    expect(connection.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(connection.scopes).toContain('instagram_basic');

    const media = await prisma.media.findMany({ where: { instagramAccountId: IG_ACCOUNT_ID }, orderBy: { instagramMediaId: 'asc' } });
    expect(media.map((row) => row.instagramMediaId)).toEqual(['media-1-1', 'media-1-2', 'media-2-1', 'media-2-2']);
    expect(media[0]).toMatchObject({ mediaType: 'REEL', permalink: expect.stringContaining('instagram.com/reel/') });
    // Carousel parent without media_url falls back to its first child.
    expect(media[1].mediaUrl).toContain('/cdn/child-1.jpg');

    const calls = await readGraphCalls();
    const subscriptions = calls.filter((call) => call.path.endsWith('/subscribed_apps'));
    expect(subscriptions.map((call) => call.path).sort()).toEqual([
      `/v26.0/${IG_ACCOUNT_ID}/subscribed_apps`,
      `/v26.0/${PAGE_ID}/subscribed_apps`,
    ]);
    for (const call of subscriptions) expect(call.authorization).toBe(`Bearer ${PAGE_TOKEN}`);
    const instagramSubscription = subscriptions.find((call) => call.path.includes(IG_ACCOUNT_ID));
    expect(instagramSubscription?.query.subscribed_fields).toBe('comments,messages,messaging_postbacks');
    const pageSubscription = subscriptions.find((call) => call.path.includes(PAGE_ID));
    expect(pageSubscription?.query.subscribed_fields).toBe('feed,messages,messaging_postbacks');
    expect(calls.some((call) => call.path === '/v26.0/oauth/access_token')).toBe(true);
    expect(calls.some((call) => call.path === '/v26.0/me/accounts')).toBe(true);
  });

  it('rejects a forged/expired state without touching the database', async () => {
    const session = new Session();
    await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'creator@example.test', password: PASSWORD }),
    });

    const forged = await session.fetch('/api/auth/meta/callback?code=GOOD_CODE&state=not.a.jwt');
    expect(forged.status).toBe(307);
    expect(new URL(forged.headers.get('location') as string).searchParams.get('error')).toBe('meta_connection_failed');
    expect(await prisma.metaConnection.count()).toBe(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'creator@example.test' } });
    const state = await createOAuthState(user.id);
    const missingCode = await session.fetch(`/api/auth/meta/callback?state=${encodeURIComponent(state)}`);
    expect(new URL(missingCode.headers.get('location') as string).searchParams.get('error')).toBe('meta_connection_failed');
    expect(await prisma.metaConnection.count()).toBe(0);

    // A state signed with the app secret but for another purpose must not pass.
    const wrongAudience = await createOAuthState('someone-else');
    expect(wrongAudience).not.toBe(state);
    const mismatch = await session.fetch(`/api/auth/meta/callback?code=GOOD_CODE&state=${encodeURIComponent(state.slice(0, -2))}x`);
    expect(new URL(mismatch.headers.get('location') as string).searchParams.get('error')).toBe('meta_connection_failed');
  });

  it('fails the callback (no connection row) when Meta rejects the code', async () => {
    const session = new Session();
    await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'creator@example.test', password: PASSWORD }),
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'creator@example.test' } });
    const state = await createOAuthState(user.id);

    const response = await session.fetch(`/api/auth/meta/callback?code=BAD_CODE&state=${encodeURIComponent(state)}`);
    expect(new URL(response.headers.get('location') as string).searchParams.get('error')).toBe('meta_connection_failed');
    expect(await prisma.metaConnection.count()).toBe(0);
    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'META_AUTH_CALLBACK_ERROR' } }))
      .resolves.toMatchObject({ userId: user.id });
  });
});

describeIntegration('A3 media sync via /api/media?sync=true', () => {
  let prisma: typeof import('@/lib/prisma').prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ prisma } = await import('@/lib/prisma'));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await resetGraphControl();
    truncateMockLogs(MOCK_GRAPH_LOG);
  });

  async function seedConnectedWorkspace() {
    const user = await prisma.user.create({
      data: { email: 'syncer@example.test', passwordHash: 'hash', plan: 'FREE', monthlyDmQuota: 30 },
    });
    const { encryptToken } = await import('@/lib/encryption');
    await prisma.metaConnection.create({
      data: {
        userId: user.id,
        metaUserId: 'meta-user-1',
        instagramAccountId: IG_ACCOUNT_ID,
        facebookPageId: PAGE_ID,
        instagramUsername: 'mock.creator',
        accessTokenEncrypted: encryptToken(PAGE_TOKEN),
        connectionStatus: 'CONNECTED',
      },
    });
    return user;
  }

  it('inserts Media rows from the live Graph API and reports the sync count', async () => {
    const user = await seedConnectedWorkspace();
    const { signToken } = await import('@/lib/auth');
    const token = await signToken({ userId: user.id, email: user.email, role: user.role, sessionVersion: 0 });

    const response = await fetch(`${BASE_URL}/api/media?sync=true`, { headers: { Cookie: `auth_token=${token}` } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.syncedCount).toBe(4);
    expect(body.cached).toBe(false);
    expect(body.reauthorizationRequired).toBe(false);
    expect(body.connectionStatus).toBe('CONNECTED');

    const rows = await prisma.media.findMany({ orderBy: { instagramMediaId: 'asc' } });
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({ instagramMediaId: 'media-2-2', mediaType: 'CAROUSEL_ALBUM' });
    expect(rows[0].caption).toBe('Mock reel 1');

    // A second sync is idempotent (upsert, not duplicate rows).
    const again = await fetch(`${BASE_URL}/api/media?sync=true`, { headers: { Cookie: `auth_token=${token}` } });
    expect((await again.json()).syncedCount).toBe(4);
    expect(await prisma.media.count()).toBe(4);
  });

  it('serves cached media and flags reauthorization when Graph returns code 190', async () => {
    const user = await seedConnectedWorkspace();
    const { signToken } = await import('@/lib/auth');
    const token = await signToken({ userId: user.id, email: user.email, role: user.role, sessionVersion: 0 });

    const first = await fetch(`${BASE_URL}/api/media?sync=true`, { headers: { Cookie: `auth_token=${token}` } });
    expect((await first.json()).syncedCount).toBe(4);

    await setMockMediaError(190);
    const failing = await fetch(`${BASE_URL}/api/media?sync=true`, { headers: { Cookie: `auth_token=${token}` } });
    expect(failing.status).toBe(200);
    const body = await failing.json();
    expect(body.cached).toBe(true);
    expect(body.reauthorizationRequired).toBe(true);
    expect(body.syncError).toContain('190');
    expect(body.media).toHaveLength(4); // cache is still served
    expect(body.connectionStatus).toBe('TOKEN_EXPIRED');

    await expect(prisma.metaConnection.findFirstOrThrow()).resolves.toMatchObject({ connectionStatus: 'TOKEN_EXPIRED' });
    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'META_TOKEN_INVALIDATED' } }))
      .resolves.toMatchObject({ userId: user.id });

    // A successful sync after re-authorization clears the expired state.
    await setMockMediaError(null);
    const recovered = await fetch(`${BASE_URL}/api/media?sync=true`, { headers: { Cookie: `auth_token=${token}` } });
    const recoveredBody = await recovered.json();
    expect(recoveredBody.reauthorizationRequired).toBe(false);
    await expect(prisma.metaConnection.findFirstOrThrow()).resolves.toMatchObject({ connectionStatus: 'CONNECTED' });
  });

  it('requires a session', async () => {
    const response = await fetch(`${BASE_URL}/api/media?sync=true`);
    expect(response.status).toBe(401);
  });
});
