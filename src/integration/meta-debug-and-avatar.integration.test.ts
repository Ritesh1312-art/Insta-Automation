/**
 * GROUP A2 + A4 — admin webhook re-subscribe (live mock Graph API) and the
 * authenticated Instagram profile-picture proxy (live mock CDN over HTTPS).
 */
import bcrypt from 'bcryptjs';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_IDENTIFIER,
  ADMIN_PASSWORD,
  BASE_URL,
  IG_ACCOUNT_ID,
  PAGE_ID,
  PAGE_TOKEN,
  Session,
  integrationEnabled,
  readCdnPaths,
  readGraphCalls,
  resetGraphControl,
  setMockAvatarPath,
  truncateAll,
  truncateMockLogs,
  MOCK_GRAPH_LOG,
} from './helpers';

const describeIntegration = integrationEnabled ? describe : describe.skip;
const CDN = process.env.MOCK_CDN_URL || '';

describeIntegration('A2 POST /api/auth/meta/debug (live re-subscribe)', () => {
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

  async function seedAdmin() {
    return prisma.user.create({
      data: {
        email: ADMIN_IDENTIFIER,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
        role: 'ADMIN',
        plan: 'FREE',
        subscriptionStatus: 'ACTIVE',
      },
    });
  }

  async function adminSession() {
    const session = new Session();
    const login = await session.json('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(login.status).toBe(200);
    return session;
  }

  async function seedConnection(token = PAGE_TOKEN) {
    const { encryptToken } = await import('@/lib/encryption');
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    return prisma.metaConnection.create({
      data: {
        userId: admin.id,
        metaUserId: 'meta-user-1',
        instagramAccountId: IG_ACCOUNT_ID,
        facebookPageId: PAGE_ID,
        instagramUsername: 'mock.creator',
        accessTokenEncrypted: encryptToken(token),
        connectionStatus: 'CONNECTED',
      },
    });
  }

  it('re-subscribes the linked Page with the stored page token', async () => {
    await seedAdmin();
    const session = await adminSession();
    await seedConnection();

    const { status, body } = await session.json<{
      success: boolean;
      subscribedFields: { page: string[] };
      subscriptionResults: any[];
    }>('/api/auth/meta/debug', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.subscriptionResults).toHaveLength(1);
    expect(body.subscriptionResults[0]).toMatchObject({ success: true, pageSubscribed: true });
    expect(body.subscribedFields).toEqual({ page: ['feed', 'comments', 'messages', 'messaging_postbacks'] });

    const calls = (await readGraphCalls()).filter((call) => call.path.endsWith('/subscribed_apps'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: `/v26.0/${PAGE_ID}/subscribed_apps`,
      authorization: `Bearer ${PAGE_TOKEN}`,
      query: { subscribed_fields: 'feed,comments,messages,messaging_postbacks' },
    });
  });

  it('flips the connection to TOKEN_EXPIRED and asks for re-authorization on Meta code 190', async () => {
    await seedAdmin();
    const session = await adminSession();
    // The mock rejects any subscription whose bearer token contains "expired"
    // with Meta's real code-190 response.
    const connection = await seedConnection('EAAG-expired-page-token');

    const { status, body } = await session.json<{ subscriptionResults: any[] }>('/api/auth/meta/debug', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.subscriptionResults[0]).toMatchObject({
      success: false,
      pageSubscribed: false,
      requiresReauthorization: true,
      connectionStatus: 'TOKEN_EXPIRED',
    });
    await expect(prisma.metaConnection.findUniqueOrThrow({ where: { id: connection.id } }))
      .resolves.toMatchObject({ connectionStatus: 'TOKEN_EXPIRED' });
    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'META_TOKEN_INVALIDATED' } }))
      .resolves.toMatchObject({ userId: connection.userId });

    // Re-running OAuth with a healthy token restores the subscription.
    const { encryptToken } = await import('@/lib/encryption');
    await prisma.metaConnection.update({
      where: { id: connection.id },
      data: { accessTokenEncrypted: encryptToken(PAGE_TOKEN), connectionStatus: 'CONNECTED' },
    });
    const recovered = await session.json<{ subscriptionResults: any[] }>('/api/auth/meta/debug', { method: 'POST' });
    expect(recovered.body.subscriptionResults[0].success).toBe(true);
  });

  it('reports a connection with no Facebook Page as a failure instead of pretending it worked', async () => {
    await seedAdmin();
    const session = await adminSession();
    const connection = await seedConnection();
    await prisma.metaConnection.update({ where: { id: connection.id }, data: { facebookPageId: null } });

    const { body } = await session.json<{ subscriptionResults: any[] }>('/api/auth/meta/debug', { method: 'POST' });
    expect(body.subscriptionResults[0]).toMatchObject({
      success: false,
      error: 'No Facebook page linked to this connection',
    });
  });

  it('is admin-only', async () => {
    const anonymous = await new Session().json('/api/auth/meta/debug', { method: 'POST' });
    expect(anonymous.status).toBe(401);
  });
});

describeIntegration('A4 GET /api/meta/profile-picture (proxy over real HTTPS CDN)', () => {
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
  });

  /** A connected workspace whose Meta account reports `avatarPath` as its picture. */
  async function seedUserWithAvatar(avatarPath: string) {
    await setMockAvatarPath(avatarPath);
    const user = await prisma.user.create({
      data: { email: 'avatar@example.test', passwordHash: 'hash', plan: 'FREE', monthlyDmQuota: 30 },
    });
    const { encryptToken } = await import('@/lib/encryption');
    await prisma.metaConnection.create({
      data: {
        userId: user.id,
        metaUserId: 'meta-user-1',
        instagramAccountId: IG_ACCOUNT_ID,
        instagramUsername: 'mock.creator',
        accessTokenEncrypted: encryptToken(PAGE_TOKEN),
        connectionStatus: 'CONNECTED',
      },
    });
    const { signToken } = await import('@/lib/auth');
    return signToken({ userId: user.id, email: user.email, role: user.role, sessionVersion: 0 });
  }

  function authenticatedFetch(path: string, token: string | null) {
    return fetch(`${BASE_URL}${path}`, token ? { headers: { Cookie: `auth_token=${token}` } } : undefined);
  }

  it('resolves the picture through Graph, proxies the bytes and caches the URL', async () => {
    const token = await seedUserWithAvatar('/cdn/avatar.png');
    const response = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(70);
    // PNG magic number proves real image bytes, not an error page.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // The freshly resolved URL is cached on the connection row.
    await expect(prisma.metaConnection.findFirstOrThrow())
      .resolves.toMatchObject({ profilePictureUrl: `${CDN}/cdn/avatar.png` });

    // Both hops really happened: Graph first, then the CDN object.
    const graphCalls = await readGraphCalls();
    expect(graphCalls.some((call) => call.path === `/v26.0/${IG_ACCOUNT_ID}` && call.query.fields === 'profile_picture_url')).toBe(true);
    expect(await readCdnPaths()).toContain('/cdn/avatar.png');
  });

  it('returns 401 without a session and 404 without a connected account', async () => {
    const anonymous = await authenticatedFetch('/api/meta/profile-picture', null);
    expect(anonymous.status).toBe(401);

    const { signToken } = await import('@/lib/auth');
    const stranger = await prisma.user.create({ data: { email: 'nobody@example.test', passwordHash: 'hash' } });
    const strangerToken = await signToken({ userId: stranger.id, email: stranger.email, role: 'USER', sessionVersion: 0 });
    const missing = await authenticatedFetch('/api/meta/profile-picture', strangerToken);
    expect(missing.status).toBe(404);
  });

  it('maps an upstream 404 to 404 and a non-image body to 502', async () => {
    const token = await seedUserWithAvatar('/cdn/missing.png');
    const missing = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(missing.status).toBe(404);
    expect(await readCdnPaths()).toContain('/cdn/missing.png');

    await setMockAvatarPath('/cdn/not-an-image.txt');
    const wrongType = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(wrongType.status).toBe(502);
  });

  it('rejects an oversized body instead of streaming it to the client', async () => {
    const token = await seedUserWithAvatar('/cdn/too-large.png');
    const response = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Unable to load Instagram profile picture' });
    // The proxy refused the body, so nothing close to 6 MB left the server.
    expect(Number(response.headers.get('content-length') || 0)).toBeLessThan(1_000);
  });

  it('refuses a redirect that leaves the CDN allowlist, without contacting the target', async () => {
    const token = await seedUserWithAvatar('/cdn/evil-redirect.png');
    const foreign = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(foreign.status).toBe(502);
    await expect(foreign.json()).resolves.toEqual({ error: 'Unable to load Instagram profile picture' });

    // A redirect aimed at the cloud metadata service is refused the same way.
    await setMockAvatarPath('/cdn/metadata-redirect.png');
    const metadata = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(metadata.status).toBe(502);

    // Only the redirecting objects were ever requested: the off-allowlist
    // targets were never contacted.
    const requested = await readCdnPaths();
    expect(requested).toContain('/cdn/evil-redirect.png');
    expect(requested).toContain('/cdn/metadata-redirect.png');
    expect(requested).not.toContain('/not-a-cdn.png');
    expect(requested.every((entry) => entry.startsWith('/cdn/'))).toBe(true);
  });

  it('follows one allowlisted redirect to another CDN edge', async () => {
    const token = await seedUserWithAvatar('/cdn/redirect.png');
    const response = await authenticatedFetch('/api/meta/profile-picture', token);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const requested = await readCdnPaths();
    expect(requested).toContain('/cdn/redirect.png');
    expect(requested).toContain('/cdn/avatar.png'); // the followed hop
  });
});
