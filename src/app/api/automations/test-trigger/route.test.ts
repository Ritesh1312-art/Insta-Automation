import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({
  db: null as unknown as FakePrismaType,
  session: vi.fn(),
  consumeRateLimit: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireSessionUser: state.session }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: state.consumeRateLimit,
  identityFingerprint: () => 'fingerprint',
  requestFingerprint: () => 'fingerprint',
}));

import { POST } from './route';

function request(body: unknown) {
  return new Request('https://app.example.test/api/automations/test-trigger', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  state.db.reset();
  state.session.mockReset();
  state.consumeRateLimit.mockReset();
  state.consumeRateLimit.mockResolvedValue(true);
  state.session.mockResolvedValue({ userId: 'owner', email: 'owner@example.test', role: 'USER' });
  state.db.seed('user', { id: 'owner', email: 'owner@example.test', passwordHash: 'hash', plan: 'FREE' });
  state.db.seed('metaConnection', { id: 'conn-1', userId: 'owner', metaUserId: 'meta', instagramAccountId: 'ig-owner', instagramUsername: 'creator', accessTokenEncrypted: 'secret' });
  state.db.seed('media', { id: 'media-1', instagramAccountId: 'ig-owner', instagramMediaId: 'ig-media-1', mediaType: 'IMAGE', timestamp: new Date() });
});

function seedAutomation(overrides: Record<string, unknown> = {}) {
  return state.db.seed('automation', {
    userId: 'owner', instagramAccountId: 'ig-owner', name: 'Guide flow', status: 'ACTIVE',
    triggerType: 'KEYWORD', keywords: ['guide'], dmMessageTemplate: 'Here is your guide', ...overrides,
  });
}

describe('automation test-trigger (configuration validation only)', () => {
  it('returns 401 without a session', async () => {
    state.session.mockRejectedValue(new Error('UNAUTHORIZED'));
    expect((await POST(request({ mediaId: 'media-1' }))).status).toBe(401);
  });

  it('rate limits repeated validation requests per user', async () => {
    state.consumeRateLimit.mockResolvedValue(false);
    const response = await POST(request({ mediaId: 'media-1' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('600');
    expect((await response.json()).error).toContain('Too many');
    expect(state.consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RATE_LIMIT_AUTOMATION_TEST_TRIGGER',
      limit: 10,
      windowMs: 10 * 60 * 1000,
    }));
  });

  it('returns 400 for a missing or malformed mediaId and for invalid JSON', async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ mediaId: 42 }))).status).toBe(400);
    const invalidJson = new Request('https://app.example.test/api/automations/test-trigger', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
    }) as never;
    expect((await POST(invalidJson)).status).toBe(400);
  });

  it('returns 404 when the post belongs to another user or a disconnected account', async () => {
    state.db.seed('user', { id: 'other', email: 'other@example.test', passwordHash: 'hash' });
    state.db.seed('metaConnection', { id: 'conn-2', userId: 'other', metaUserId: 'meta2', instagramAccountId: 'ig-other', connectionStatus: 'DISCONNECTED' });
    state.db.seed('media', { id: 'media-2', instagramAccountId: 'ig-other', instagramMediaId: 'ig-media-2', mediaType: 'IMAGE', timestamp: new Date() });
    expect((await POST(request({ mediaId: 'media-2' }))).status).toBe(404);
    expect((await POST(request({ mediaId: 'missing' }))).status).toBe(404);
  });

  it('reports ready=true with an explicit no-message-sent contract for a valid configuration', async () => {
    seedAutomation({ mediaId: 'media-1' });
    const response = await POST(request({ mediaId: 'media-1' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ready: true, automationCount: 1, blockers: [], validationOnly: true });
    expect(body.message).toContain('no Instagram comment, DM, or other message was sent');
    // Validation must not create any automation runs or side effects.
    expect(state.db.rows('automationRun')).toHaveLength(0);
  });

  it('reports blockers instead of ready when the configuration is incomplete', async () => {
    seedAutomation({ mediaId: 'media-1', keywords: [] });
    seedAutomation({ name: 'Resource flow', dmMessageTemplate: 'Download {{resource_url}}', resourceId: null });
    const response = await POST(request({ mediaId: 'media-1' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ready).toBe(false);
    expect(body.blockers).toEqual(expect.arrayContaining(['Guide flow: no keywords', 'Resource flow: resource is missing']));
    expect(body.validationOnly).toBe(true);
  });

  it('reports ready=false when the post has no active automations', async () => {
    const response = await POST(request({ mediaId: 'media-1' }));
    const body = await response.json();
    expect(body).toMatchObject({ ready: false, automationCount: 0, blockers: [], validationOnly: true });
  });

  it('ignores automations owned by other users', async () => {
    state.db.seed('user', { id: 'other', email: 'other@example.test', passwordHash: 'hash' });
    state.db.seed('automation', {
      userId: 'other', instagramAccountId: 'ig-other', name: 'Other flow', status: 'ACTIVE',
      triggerType: 'KEYWORD', keywords: ['guide'], dmMessageTemplate: 'Not yours', mediaId: 'media-1',
    });
    const response = await POST(request({ mediaId: 'media-1' }));
    const body = await response.json();
    expect(body).toMatchObject({ ready: false, automationCount: 0 });
  });
});
