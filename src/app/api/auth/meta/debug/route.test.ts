/**
 * Regression tests for `POST /api/auth/meta/debug` — the admin-only webhook
 * re-subscribe action behind Settings → "Meta webhook subscription".
 *
 * Production defect: the handler ran the two `subscribed_apps` calls, returned a
 * per-connection boolean, and forgot the result. Nothing was persisted, so the
 * stored connection kept whatever status it had (a healthy `CONNECTED` /
 * `SUBSCRIBED`) even after every subscribe call failed, and the dashboard went
 * on showing no warning. A partially successful run was also indistinguishable
 * from a full success in the response.
 *
 * These tests pin down: authorization is unchanged, successes, partial
 * successes and failures each persist the matching `webhookStatus`, and Graph or
 * decryption failures never leak tokens into the response or the logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  subscribeObject: vi.fn(),
}));

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));

vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});
vi.mock('@/lib/require-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/require-admin')>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/services/meta/MetaAuthService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/meta/MetaAuthService')>()),
  MetaAuthService: { subscribeObject: mocks.subscribeObject },
}));

import { POST } from './route';
import { encryptToken } from '@/lib/encryption';

const ACCESS_TOKEN = 'EAAG-resubscribe-token-0123456789abcdef';

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

function seedConnection(overrides: Record<string, unknown> = {}) {
  return state.db.seed('metaConnection', {
    userId: 'admin-user',
    metaUserId: 'meta-1',
    instagramAccountId: 'ig-1',
    facebookPageId: 'page-1',
    instagramUsername: 'creator_one',
    accessTokenEncrypted: encryptToken(ACCESS_TOKEN),
    connectionStatus: 'CONNECTED',
    webhookStatus: 'UNKNOWN',
    ...overrides,
  });
}

beforeEach(() => {
  state.db.reset();
  mocks.requireAdmin.mockReset();
  mocks.requireAdmin.mockResolvedValue({ userId: 'admin-user', email: 'admin@example.test', role: 'ADMIN' });
  mocks.subscribeObject.mockReset();
  mocks.subscribeObject.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin Meta webhook re-subscribe', () => {
  it('keeps the existing authorization behaviour for anonymous and non-admin callers', async () => {
    seedConnection();
    mocks.requireAdmin.mockRejectedValue(new Error('UNAUTHORIZED'));
    const unauthorized = await POST();
    expect(unauthorized.status).toBe(401);
    expect(await json(unauthorized)).toEqual({ error: 'Authentication required' });

    mocks.requireAdmin.mockRejectedValue(new Error('FORBIDDEN'));
    const forbidden = await POST();
    expect(forbidden.status).toBe(403);
    expect(await json(forbidden)).toEqual({ error: 'Admin only' });

    expect(mocks.subscribeObject).not.toHaveBeenCalled();
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })!.webhookStatus).toBe('UNKNOWN');
  });

  it('persists SUBSCRIBED and reports a full success when both targets accept', async () => {
    seedConnection();

    const response = await POST();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary).toMatchObject({ total: 1, subscribed: 1, partial: 0, failed: 0 });
    expect(body.subscriptionResults).toEqual([
      expect.objectContaining({ status: 'SUBSCRIBED', success: true, pageSubscribed: true, instagramSubscribed: true, persisted: true }),
    ]);
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })).toMatchObject({
      webhookStatus: 'SUBSCRIBED',
      // Re-subscribing webhooks must not pretend the token state changed.
      connectionStatus: 'CONNECTED',
    });
  });

  it('persists PARTIAL when only one target accepts', async () => {
    seedConnection();
    mocks.subscribeObject
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error(`Instagram unsubscribe failed for ${ACCESS_TOKEN}`));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const body = await json(await POST());

    expect(body.summary).toMatchObject({ total: 1, subscribed: 0, partial: 1, failed: 0 });
    expect(body.subscriptionResults[0]).toMatchObject({
      status: 'PARTIAL', success: false, pageSubscribed: true, instagramSubscribed: false, persisted: true,
      errors: ['Subscription failed'],
    });
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })).toMatchObject({ webhookStatus: 'PARTIAL' });
    // Redaction: neither the response nor the logs may echo the Graph error.
    expect(JSON.stringify(body)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(ACCESS_TOKEN);
  });

  it('persists FAILED when both targets reject', async () => {
    seedConnection();
    mocks.subscribeObject.mockRejectedValue(new Error('Graph rejected the Page token'));

    const body = await json(await POST());

    expect(body.summary).toMatchObject({ total: 1, subscribed: 0, partial: 0, failed: 1 });
    expect(body.subscriptionResults[0]).toMatchObject({ status: 'FAILED', success: false, persisted: true });
    expect(JSON.stringify(body)).not.toContain('Graph rejected the Page token');
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })).toMatchObject({ webhookStatus: 'FAILED' });
  });

  it('records FAILED for connections without a linked Facebook Page', async () => {
    seedConnection({ facebookPageId: null });

    const body = await json(await POST());

    expect(body.subscriptionResults[0]).toMatchObject({
      status: 'FAILED', success: false, error: 'No Facebook page linked to this connection', persisted: true,
    });
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })).toMatchObject({ webhookStatus: 'FAILED' });
    expect(mocks.subscribeObject).not.toHaveBeenCalled();
  });

  it('records FAILED (not a crash) when the stored token cannot be decrypted', async () => {
    seedConnection({ accessTokenEncrypted: 'not-an-encrypted-token' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const body = await json(await POST());

    expect(body.subscriptionResults[0]).toMatchObject({ status: 'FAILED', success: false, errors: ['Subscription failed'] });
    expect(JSON.stringify(body)).not.toContain('not-an-encrypted-token');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('not-an-encrypted-token');
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })).toMatchObject({ webhookStatus: 'FAILED' });
  });

  it('reports a failure to persist instead of claiming the subscription is stored', async () => {
    seedConnection();
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'metaConnection' && entry.operation === 'update') throw new Error('database unavailable');
    };

    const body = await json(await POST());

    expect(body.subscriptionResults[0]).toMatchObject({
      status: 'FAILED', success: false, persisted: false, errors: ['Unable to persist webhook status'],
    });
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-1' })).toMatchObject({ webhookStatus: 'UNKNOWN' });
  });

  it('handles several connections in one run with per-connection statuses', async () => {
    seedConnection({ instagramAccountId: 'ig-ok', facebookPageId: 'page-ok', instagramUsername: 'ok_account' });
    seedConnection({ instagramAccountId: 'ig-partial', facebookPageId: 'page-partial', instagramUsername: 'partial_account' });
    mocks.subscribeObject.mockImplementation(async (objectId: string) => {
      if (objectId === 'ig-partial') throw new Error('Graph rejected the Instagram object');
      return { success: true };
    });

    const body = await json(await POST());

    expect(body.summary).toMatchObject({ total: 2, subscribed: 1, partial: 1, failed: 0 });
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-ok' })).toMatchObject({ webhookStatus: 'SUBSCRIBED' });
    expect(state.db.row('metaConnection', { instagramAccountId: 'ig-partial' })).toMatchObject({ webhookStatus: 'PARTIAL' });
  });
});
