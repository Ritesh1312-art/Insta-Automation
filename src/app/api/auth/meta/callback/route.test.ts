/**
 * Regression tests for `GET /api/auth/meta/callback`.
 *
 * Production defect: a successful OAuth token exchange whose webhook
 * `subscribed_apps` call failed was stored as `connectionStatus: 'ERROR'`.
 * The dashboard renders ERROR as "token invalid/expired — reconnect", so a
 * creator with a perfectly valid token was told to reconnect Instagram
 * whenever Meta rejected a subscription.
 *
 * The callback now keeps the token/connection state truthful (CONNECTED after a
 * successful exchange) and records the subscription outcome separately on
 * `webhookStatus`, which the dashboard reads through `GET /api/stats`.
 *
 * Meta itself is replaced (`MetaAuthService.handleOAuthCallback`), the media
 * sync service is stubbed, and everything else — OAuth state verification,
 * encryption, Prisma writes, audit logging — is the real code path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const mocks = vi.hoisted(() => ({
  handleOAuthCallback: vi.fn(),
  fetchMedia: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
}));

vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});
vi.mock('@/services/meta/MetaAuthService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/meta/MetaAuthService')>()),
  MetaAuthService: { handleOAuthCallback: mocks.handleOAuthCallback },
}));
vi.mock('@/services/meta/InstagramMediaService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/meta/InstagramMediaService')>()),
  InstagramMediaService: { fetchMedia: mocks.fetchMedia },
}));

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));

import { GET } from './route';
import { createOAuthState } from '@/lib/auth';
import { encryptToken } from '@/lib/encryption';

const ACCESS_TOKEN = 'EAAG-callback-token-0123456789abcdef';
const ACCOUNT_ID = 'ig-callback';

function account(overrides: Record<string, unknown> = {}) {
  return {
    metaUserId: 'meta-user-callback',
    instagramAccountId: ACCOUNT_ID,
    instagramUsername: 'callback_creator',
    profilePictureUrl: 'https://cdn.example.test/pic.jpg',
    facebookPageId: 'page-callback',
    accessToken: ACCESS_TOKEN,
    expiresInSeconds: 5_000_000,
    webhookSubscriptionWarnings: [] as string[],
    webhookSubscription: { page: true, instagram: true },
    ...overrides,
  };
}

async function callbackRequest(options: { state?: string; code?: string } = {}) {
  const state = options.state ?? await createOAuthState('user-1');
  const code = options.code ?? 'auth-code';
  const url = `https://app.example.test/api/auth/meta/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`;
  return new NextRequest(url);
}

function redirectLocation(response: Response) {
  const location = response.headers.get('location');
  expect(location, 'callback must always redirect back to the dashboard').toBeTruthy();
  return location!;
}

beforeEach(() => {
  state.db.reset();
  mocks.handleOAuthCallback.mockReset();
  mocks.fetchMedia.mockReset();
  mocks.fetchMedia.mockResolvedValue([]);
  mocks.handleOAuthCallback.mockResolvedValue(account());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Meta OAuth callback', () => {
  it('stores a healthy connection with SUBSCRIBED webhooks and no warning', async () => {
    mocks.fetchMedia.mockResolvedValue([
      { id: 'media-1', media_type: 'REEL', media_product_type: 'REELS', caption: 'hello', timestamp: new Date().toISOString() },
    ]);

    const response = await GET(await callbackRequest());
    const location = new URL(redirectLocation(response));

    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/dashboard');
    expect(location.searchParams.get('connected')).toBe('true');
    expect(location.searchParams.get('synced')).toBe('1');
    expect(location.searchParams.has('webhookWarning')).toBe(false);

    const connection = state.db.row('metaConnection', { instagramAccountId: ACCOUNT_ID })!;
    expect(connection).toMatchObject({ userId: 'user-1', connectionStatus: 'CONNECTED', webhookStatus: 'SUBSCRIBED' });
    expect(state.db.rows('auditLog').filter((log) => log.action === 'META_WEBHOOK_SUBSCRIPTION_WARNING')).toEqual([]);
    expect(state.db.row('media', { instagramMediaId: 'media-1' })).toMatchObject({ instagramAccountId: ACCOUNT_ID });
    // The encrypted token never leaves the server, not even in the redirect.
    expect(location.toString()).not.toContain(ACCESS_TOKEN);
  });

  it('keeps the connection CONNECTED and records PARTIAL when one subscribe target fails', async () => {
    mocks.handleOAuthCallback.mockResolvedValue(account({
      webhookSubscriptionWarnings: ['Instagram subscription unavailable for EAAG-partial-0123456789abcdef'],
      webhookSubscription: { page: true, instagram: false },
    }));

    const response = await GET(await callbackRequest());
    const location = new URL(redirectLocation(response));

    expect(location.searchParams.get('webhookWarning')).toBe('true');
    expect(location.searchParams.get('connected')).toBe('true');

    const connection = state.db.row('metaConnection', { instagramAccountId: ACCOUNT_ID })!;
    expect(connection.connectionStatus).toBe('CONNECTED'); // never 'ERROR' for a webhook gap
    expect(connection.webhookStatus).toBe('PARTIAL');

    const warning = state.db.rows('auditLog').find((log) => log.action === 'META_WEBHOOK_SUBSCRIPTION_WARNING');
    expect(warning?.details).toMatchObject({ status: 'PARTIAL' });
    // Graph errors can echo request parameters, so the stored warning is redacted.
    expect(JSON.stringify(warning?.details)).not.toContain('EAAG-partial-0123456789abcdef');
  });

  it('records FAILED when both subscribe targets fail', async () => {
    mocks.handleOAuthCallback.mockResolvedValue(account({
      webhookSubscriptionWarnings: ['Page subscription unavailable', 'Instagram subscription unavailable'],
      webhookSubscription: { page: false, instagram: false },
    }));

    await GET(await callbackRequest());

    expect(state.db.row('metaConnection', { instagramAccountId: ACCOUNT_ID }))
      .toMatchObject({ connectionStatus: 'CONNECTED', webhookStatus: 'FAILED' });
  });

  it('derives the webhook status from the warning count when the service reports no per-target result', async () => {
    mocks.handleOAuthCallback.mockResolvedValue(account({
      webhookSubscription: undefined,
      webhookSubscriptionWarnings: ['Page subscription unavailable'],
    }));
    await GET(await callbackRequest());
    expect(state.db.row('metaConnection', { instagramAccountId: ACCOUNT_ID })).toMatchObject({ webhookStatus: 'PARTIAL' });

    state.db.reset();
    mocks.handleOAuthCallback.mockResolvedValue(account({
      webhookSubscription: undefined,
      webhookSubscriptionWarnings: ['Page subscription unavailable', 'Instagram subscription unavailable'],
    }));
    await GET(await callbackRequest());
    expect(state.db.row('metaConnection', { instagramAccountId: ACCOUNT_ID })).toMatchObject({ webhookStatus: 'FAILED' });
  });

  it('refuses an Instagram account connected to another workspace without storing the token', async () => {
    state.db.seed('metaConnection', {
      userId: 'someone-else',
      metaUserId: 'meta-someone-else',
      instagramAccountId: ACCOUNT_ID,
      instagramUsername: 'other_creator',
      accessTokenEncrypted: encryptToken('EAAG-other-workspace-token-0123456789'),
      connectionStatus: 'CONNECTED',
    });

    const response = await GET(await callbackRequest());
    const location = new URL(redirectLocation(response));

    expect(location.searchParams.get('error')).toBe('meta_connection_failed');
    const connection = state.db.row('metaConnection', { instagramAccountId: ACCOUNT_ID })!;
    expect(connection.userId).toBe('someone-else');
    expect(connection.webhookStatus).toBe('UNKNOWN');
    expect(location.toString()).not.toContain(ACCESS_TOKEN);
  });

  it('rejects an invalid OAuth state without recording anything or storing a connection', async () => {
    const response = await GET(await callbackRequest({ state: 'not-a-valid-state' }));

    const location = new URL(redirectLocation(response));
    expect(location.searchParams.get('error')).toBe('meta_connection_failed');
    expect(state.db.rows('metaConnection')).toEqual([]);
    // Without a verified state there is no user to attribute an audit entry to.
    expect(state.db.rows('auditLog')).toEqual([]);
  });

  it('rejects a callback with no authorization code without storing a connection', async () => {
    const response = await GET(await callbackRequest({ code: '' }));
    const location = new URL(redirectLocation(response));

    expect(location.searchParams.get('error')).toBe('meta_connection_failed');
    expect(location.toString()).not.toContain('auth-code');
    expect(state.db.rows('metaConnection')).toEqual([]);
    expect(state.db.rows('metaConnection')).not.toContainEqual(expect.objectContaining({ accessTokenEncrypted: expect.anything() }));
    // Only the redacted failure marker is written, never the code or a token.
    expect(state.db.rows('auditLog')).toEqual([
      expect.objectContaining({ action: 'META_AUTH_CALLBACK_ERROR', details: { reason: 'meta_oauth_callback_failed' } }),
    ]);
  });

  it('redirects to the generic failure state and never logs the raw exchange error', async () => {
    mocks.handleOAuthCallback.mockRejectedValue(new Error(`token exchange failed for ${ACCESS_TOKEN}`));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(await callbackRequest());
    expect(new URL(redirectLocation(response)).searchParams.get('error')).toBe('meta_connection_failed');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(ACCESS_TOKEN);
  });
});
