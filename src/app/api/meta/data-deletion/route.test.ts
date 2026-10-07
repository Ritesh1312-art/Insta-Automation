/**
 * Regression tests for `POST /api/meta/data-deletion`, the callback Meta calls
 * when someone removes the app from their Facebook/Instagram account.
 *
 * Requirements these tests pin down:
 *  - the request must carry a valid signed_request (HMAC-SHA256) or nothing happens;
 *  - deletion covers exactly the Meta-linked data declared by the schema's
 *    `onDelete: Cascade` relations for the connection(s) of that Meta user;
 *  - processing is idempotent: Meta retries reuse the same confirmation code and
 *    keep the stored counts consistent with what was really deleted;
 *  - a failure is persisted as FAILED (the status page must not claim a
 *    deletion that did not happen) and answered 5xx so Meta retries;
 *  - secrets from the callback body or the database never reach the logs.
 *
 * The signed request is produced here the same way Meta signs it; the database
 * is a real in-memory Prisma double that emulates the foreign-key cascades.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));

vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { POST } from './route';

const APP_SECRET = process.env.META_APP_SECRET!;
const REQUESTING_META_USER = 'meta-user-deleting';
const OTHER_META_USER = 'meta-user-other';

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function signedRequest(userId: string, secret = APP_SECRET) {
  const encoded = base64url(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: Math.floor(Date.now() / 1000) }));
  const signature = createHmac('sha256', secret).update(encoded).digest();
  return `${base64url(signature)}.${encoded}`;
}

function jsonRequest(body: unknown) {
  return new NextRequest('https://app.example.test/api/meta/data-deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function formRequest(value: string) {
  return new NextRequest('https://app.example.test/api/meta/data-deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ signed_request: value }).toString(),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

/** A workspace with one connection and one row in every cascading table. */
function seedWorkspace(metaUserId: string, suffix: string, userId = `user-${suffix}`) {
  const instagramAccountId = `ig-${suffix}`;
  state.db.seed('user', { id: userId, email: `${suffix}@example.test`, passwordHash: 'hash' });
  state.db.seed('metaConnection', {
    userId,
    metaUserId,
    instagramAccountId,
    facebookPageId: `page-${suffix}`,
    instagramUsername: `${suffix}_creator`,
    accessTokenEncrypted: `encrypted-token-${suffix}`,
  });
  state.db.seed('media', { instagramAccountId, instagramMediaId: `media-${suffix}`, mediaType: 'REEL', timestamp: new Date() });
  const automation = state.db.seed('automation', {
    userId, instagramAccountId, name: `${suffix} flow`, keywords: ['guide'], dmMessageTemplate: 'here', status: 'ACTIVE',
  });
  const event = state.db.seed('webhookEvent', {
    instagramAccountId, eventType: 'comments', rawPayload: { comment: 'hi' }, status: 'PROCESSED',
  });
  state.db.seed('automationRun', {
    automationId: automation.id, webhookEventId: event.id, idempotencyKey: `key-${suffix}`, status: 'API_ACCEPTED',
  });
  state.db.seed('contact', { instagramAccountId, igsid: `igsid-${suffix}`, followGateStatus: 'DELIVERED' });
  state.db.seed('automationContactState', { automationId: automation.id, instagramAccountId, igsid: `igsid-${suffix}` });
  return instagramAccountId;
}

beforeEach(() => {
  state.db.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Meta data deletion callback', () => {
  it('rejects a body without a signed_request and deletes nothing', async () => {
    seedWorkspace(REQUESTING_META_USER, 'target');

    for (const request of [jsonRequest({}), jsonRequest('not json'), jsonRequest({ signed_request: 42 })]) {
      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: 'Invalid signed request' });
    }
    expect(state.db.rows('metaConnection')).toHaveLength(1);
    expect(state.db.rows('metaDataDeletionRequest')).toEqual([]);
  });

  it('rejects a forged signature and deletes nothing', async () => {
    seedWorkspace(REQUESTING_META_USER, 'target', 'user-target');

    const response = await POST(jsonRequest({ signed_request: signedRequest(REQUESTING_META_USER, 'wrong-app-secret') }));

    expect(response.status).toBe(403);
    expect(state.db.rows('metaConnection')).toHaveLength(1);
    expect(state.db.rows('metaDataDeletionRequest')).toEqual([]);
  });

  it('deletes the Meta-linked data of the requesting Meta user and returns a confirmation code', async () => {
    const instagramAccountId = seedWorkspace(REQUESTING_META_USER, 'target');
    seedWorkspace(OTHER_META_USER, 'other');
    seedWorkspace(REQUESTING_META_USER, 'target-second');

    const response = await POST(jsonRequest({ signed_request: signedRequest(REQUESTING_META_USER) }));
    const body = await json(response);

    expect(response.status).toBe(200);
    // Meta's contract: the response must contain a status URL and a code.
    expect(body.confirmation_code).toEqual(expect.any(String));
    expect(body.url).toBe(`https://app.example.test/data-deletion?confirmation=${body.confirmation_code}`);

    // Only this Meta user's two connections went away; the other Meta user's stayed.
    expect(state.db.rows('metaConnection').map((row) => row.instagramAccountId)).toEqual(['ig-other']);
    // ...together with everything that hangs off them through the schema cascades.
    expect(state.db.rows('media').map((row) => row.instagramMediaId)).toEqual(['media-other']);
    expect(state.db.rows('automation').map((row) => row.name)).toEqual(['other flow']);
    expect(state.db.rows('automationRun').map((row) => row.idempotencyKey)).toEqual(['key-other']);
    expect(state.db.rows('contact').map((row) => row.igsid)).toEqual(['igsid-other']);
    expect(state.db.rows('automationContactState').map((row) => row.igsid)).toEqual(['igsid-other']);
    expect(state.db.rows('webhookEvent').map((row) => row.instagramAccountId)).toEqual(['ig-other']);
    expect(state.db.rows('contact').some((row) => row.instagramAccountId === instagramAccountId)).toBe(false);

    const record = state.db.row('metaDataDeletionRequest', { metaUserId: REQUESTING_META_USER })!;
    expect(record).toMatchObject({
      confirmationCode: body.confirmation_code,
      status: 'COMPLETED',
      deletedConnections: 2,
      deletedMedia: 2,
      deletedAutomations: 2,
      deletedContacts: 2,
      deletedWebhookEvents: 2,
    });
    expect(record.completedAt).toBeInstanceOf(Date);
  });

  it('accepts a form-encoded callback exactly like Meta sends it', async () => {
    seedWorkspace(REQUESTING_META_USER, 'target');

    const response = await POST(formRequest(signedRequest(REQUESTING_META_USER)));
    expect(response.status).toBe(200);
    expect(state.db.row('metaConnection', { metaUserId: REQUESTING_META_USER })).toBeUndefined();
    expect(state.db.rows('metaDataDeletionRequest')).toHaveLength(1);
  });

  it('is idempotent: a retry reuses the confirmation code and never double-counts', async () => {
    seedWorkspace(REQUESTING_META_USER, 'target');

    const first = await json(await POST(jsonRequest({ signed_request: signedRequest(REQUESTING_META_USER) })));
    const second = await json(await POST(jsonRequest({ signed_request: signedRequest(REQUESTING_META_USER) })));

    expect(second.confirmation_code).toBe(first.confirmation_code);
    expect(second.url).toBe(first.url);
    expect(state.db.rows('metaDataDeletionRequest')).toHaveLength(1);
    expect(state.db.row('metaDataDeletionRequest', { metaUserId: REQUESTING_META_USER })).toMatchObject({
      status: 'COMPLETED',
      deletedConnections: 1,
      deletedMedia: 1,
      deletedAutomations: 1,
    });
  });

  it('records a Meta user with nothing stored as a completed request with zero counts', async () => {
    const body = await json(await POST(jsonRequest({ signed_request: signedRequest('meta-user-without-data') })));

    expect(state.db.row('metaDataDeletionRequest', { metaUserId: 'meta-user-without-data' })).toMatchObject({
      status: 'COMPLETED',
      confirmationCode: body.confirmation_code,
      deletedConnections: 0,
      deletedMedia: 0,
      deletedAutomations: 0,
    });
  });

  it('persists FAILED, answers 5xx, and can complete on Meta\u2019s retry', async () => {
    seedWorkspace(REQUESTING_META_USER, 'target');
    const signed = signedRequest(REQUESTING_META_USER);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The failure text deliberately embeds the signed request and a token shape.
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'metaConnection' && entry.operation === 'deleteMany') {
        throw new Error(`delete failed for ${signed} and EAAG-raw-token-0123456789abcdef`);
      }
    };

    const failed = await POST(jsonRequest({ signed_request: signed }));
    const failedBody = await json(failed);
    const logged = JSON.stringify(errorSpy.mock.calls);

    expect(failed.status).toBe(500);
    expect(failedBody).toEqual({ error: 'Unable to process deletion request' });
    expect(logged).not.toContain(signed);
    expect(logged).not.toContain('EAAG-raw-token-0123456789abcdef');
    // The data is still there and the stored status says so.
    expect(state.db.rows('metaConnection')).toHaveLength(1);
    expect(state.db.row('metaDataDeletionRequest', { metaUserId: REQUESTING_META_USER })).toMatchObject({ status: 'FAILED' });

    // Meta retries the same callback; now the delete succeeds.
    state.db.beforeOperation = null;
    const retried = await json(await POST(jsonRequest({ signed_request: signed })));

    expect(state.db.rows('metaConnection')).toEqual([]);
    const record = state.db.row('metaDataDeletionRequest', { metaUserId: REQUESTING_META_USER })!;
    expect(record).toMatchObject({ status: 'COMPLETED', errorDetails: null, confirmationCode: retried.confirmation_code });
  });
});
