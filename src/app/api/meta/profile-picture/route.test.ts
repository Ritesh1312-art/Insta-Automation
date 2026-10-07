import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptToken } from '@/lib/encryption';
import { metaGraphApiVersion, metaGraphBaseUrl } from '@/lib/meta-graph';

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    metaConnection: {
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
  },
}));

import { GET } from './route';

const SAMPLE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function graphJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function imageResponse(
  bytes: Uint8Array = SAMPLE_JPEG,
  headers: Record<string, string> = { 'Content-Type': 'image/jpeg' },
  status = 200,
) {
  return new Response(new Uint8Array(bytes), { status, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUser.mockResolvedValue({
    userId: 'user-owner',
    email: 'owner@example.com',
    role: 'USER',
  });
  mocks.findFirst.mockResolvedValue({
    id: 'conn-1',
    userId: 'user-owner',
    instagramAccountId: 'ig-account-123',
    instagramUsername: 'creator_studio',
    profilePictureUrl: 'https://scontent.cdninstagram.com/v/t51.2885-19/expired.jpg?oe=111111',
    accessTokenEncrypted: encryptToken('secret-page-access-token-xyz'),
    connectionStatus: 'CONNECTED',
  });
  mocks.update.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/meta/profile-picture', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    mocks.requireSessionUser.mockRejectedValue(new Error('UNAUTHORIZED'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the user has no connected Instagram account or photo', async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const noConnection = await GET();
    expect(noConnection.status).toBe(404);
    await expect(noConnection.json()).resolves.toEqual({ error: 'Profile picture not found' });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-owner', connectionStatus: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Connected account exists, but Graph API reports no profile_picture_url
    fetchMock.mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123' }));
    const noPhoto = await GET();
    expect(noPhoto.status).toBe(404);
    await expect(noPhoto.json()).resolves.toEqual({ error: 'Profile picture not found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired stored URL through Meta Graph API and updates MetaConnection.profilePictureUrl', async () => {
    const freshCdnUrl = 'https://scontent.cdninstagram.com/v/t51.2885-19/fresh-avatar.jpg?efg=eyJ0eXBlIjoxfQ&oe=999999';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: freshCdnUrl }))
      .mockResolvedValueOnce(imageResponse(SAMPLE_JPEG, { 'Content-Type': 'image/jpeg; charset=binary' }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest(
      'https://app.example.com/api/meta/profile-picture?url=https://evil.example/ssrf.jpg',
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${metaGraphBaseUrl()}/${metaGraphApiVersion()}/ig-account-123?fields=profile_picture_url`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer secret-page-access-token-xyz' },
      cache: 'no-store',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(freshCdnUrl);
    expect(fetchMock.mock.calls[1][1]?.headers).not.toHaveProperty('Authorization');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('evil.example');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('expired.jpg');

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { profilePictureUrl: freshCdnUrl },
    });
  });

  it('proxies valid image bytes with a short private cache policy', async () => {
    const freshCdnUrl = 'https://scontent.cdninstagram.com/v/t51.2885-19/current-avatar.png';
    mocks.findFirst.mockResolvedValueOnce({
      id: 'conn-1',
      userId: 'user-owner',
      instagramAccountId: 'ig-account-123',
      profilePictureUrl: freshCdnUrl,
      accessTokenEncrypted: encryptToken('secret-page-access-token-xyz'),
      connectionStatus: 'CONNECTED',
    });
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: freshCdnUrl }))
      .mockResolvedValueOnce(imageResponse(pngBytes, { 'Content-Type': 'image/png' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(pngBytes.byteLength));
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('private');
    expect(cacheControl).toMatch(/max-age=\d+/);
    expect(cacheControl).not.toContain('public');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects non-image and oversized upstream responses with 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const freshCdnUrl = 'https://scontent.cdninstagram.com/v/t51.2885-19/avatar.jpg';

    // 1. Non-image Content-Type (text/html)
    const fetchHtml = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: freshCdnUrl }))
      .mockResolvedValueOnce(
        new Response('<html>Forbidden</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      );
    vi.stubGlobal('fetch', fetchHtml);
    const htmlResponse = await GET();
    expect(htmlResponse.status).toBe(502);
    await expect(htmlResponse.json()).resolves.toEqual({ error: 'Unable to load Instagram profile picture' });

    // 2. Unsafe SVG Content-Type (image/svg+xml)
    const fetchSvg = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: freshCdnUrl }))
      .mockResolvedValueOnce(
        new Response('<svg><script>alert(1)</script></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );
    vi.stubGlobal('fetch', fetchSvg);
    const svgResponse = await GET();
    expect(svgResponse.status).toBe(502);

    // 3. Oversized Content-Length header
    const fetchOversizedHeader = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: freshCdnUrl }))
      .mockResolvedValueOnce(
        imageResponse(SAMPLE_JPEG, {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(6 * 1024 * 1024),
        }),
      );
    vi.stubGlobal('fetch', fetchOversizedHeader);
    const oversizedHeaderResponse = await GET();
    expect(oversizedHeaderResponse.status).toBe(502);
    await expect(oversizedHeaderResponse.json()).resolves.toEqual({
      error: 'Unable to load Instagram profile picture',
    });

    // 4. Oversized streaming body without Content-Length header
    const oversizedBytes = new Uint8Array(5 * 1024 * 1024 + 1024);
    const fetchOversizedStream = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: freshCdnUrl }))
      .mockResolvedValueOnce(
        new Response(oversizedBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      );
    vi.stubGlobal('fetch', fetchOversizedStream);
    const oversizedStreamResponse = await GET();
    expect(oversizedStreamResponse.status).toBe(502);
  });

  it('never exposes or logs access tokens, CDN query strings, database URLs, or secrets', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const sensitiveToken = 'EAABsSensitivePageToken987654321';
    const sensitiveQuery = 'oh=super_secret_cdn_sig_123&oe=6789ABCD';
    const sensitiveDbUrl = 'postgresql://prod_user:super_secret_db_pass@db.internal:5432/prod';
    const cdnUrlWithSecrets = `https://scontent.cdninstagram.com/v/t51.2885-19/pic.jpg?${sensitiveQuery}`;

    mocks.findFirst.mockResolvedValue({
      id: 'conn-1',
      userId: 'user-owner',
      instagramAccountId: 'ig-account-123',
      profilePictureUrl: cdnUrlWithSecrets,
      accessTokenEncrypted: encryptToken(sensitiveToken),
      connectionStatus: 'CONNECTED',
    });

    // Upstream failure throwing an Error containing token, CDN query string, and DB URL
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(graphJsonResponse({ id: 'ig-account-123', profile_picture_url: cdnUrlWithSecrets }))
      .mockRejectedValueOnce(
        new Error(`CDN failed for ${cdnUrlWithSecrets} token=${sensitiveToken} db=${sensitiveDbUrl}`),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();
    const bodyText = await response.text();

    expect(response.status).toBe(502);
    expect(bodyText).not.toContain(sensitiveToken);
    expect(bodyText).not.toContain(sensitiveQuery);
    expect(bodyText).not.toContain(sensitiveDbUrl);
    expect(bodyText).not.toContain(process.env.ENCRYPTION_KEY!);

    // Also test database exception containing DATABASE_URL
    mocks.findFirst.mockRejectedValueOnce(new Error(`Connection failed: ${sensitiveDbUrl}`));
    const dbFailureResponse = await GET();
    const dbFailureText = await dbFailureResponse.text();
    expect(dbFailureResponse.status).toBe(502);
    expect(dbFailureText).not.toContain(sensitiveDbUrl);

    const allLogs = JSON.stringify([
      errorSpy.mock.calls,
      warnSpy.mock.calls,
      logSpy.mock.calls,
    ]);
    expect(allLogs).not.toContain(sensitiveToken);
    expect(allLogs).not.toContain(sensitiveQuery);
    expect(allLogs).not.toContain(sensitiveDbUrl);
    expect(allLogs).not.toContain(process.env.ENCRYPTION_KEY!);
    expect(allLogs).not.toContain(process.env.AUTH_SECRET!);
  });
});
