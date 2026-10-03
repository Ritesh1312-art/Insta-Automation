/**
 * Comment-to-DM pipeline tests with real quota locking, follow-gate, Meta
 * messaging, and token encryption. Only Prisma (an in-memory double that
 * rejects uncast advisory-lock queries exactly like production) and the
 * network (`fetch` to the Graph API) are substituted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';
import { FakePrismaError, VOID_DESERIALIZATION_MESSAGE } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { encryptToken } from '@/lib/encryption';
import { AutomationEngine, type CommentEventPayload } from './AutomationEngine';

const DAY = 86_400_000;
const ACCESS_TOKEN = 'EAAG-live-page-token-0123456789abcdef';
const IG = 'ig-creator';

type GraphCall = { method: string; path: string; authorization: string | null; body: any };
const graph = {
  calls: [] as GraphCall[],
  handler: null as null | ((call: GraphCall) => Response | Promise<Response>),
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function acceptEverything(call: GraphCall) {
  if (call.method === 'POST' && call.path.endsWith('/messages')) return json({ recipient_id: 'fan', message_id: `mid-${graph.calls.length}` });
  if (call.method === 'POST' && call.path.endsWith('/replies')) return json({ id: `reply-${graph.calls.length}` });
  return json({ error: { code: 100, message: `Unexpected Graph call ${call.method} ${call.path}` } }, 400);
}

const privateReplies = () => graph.calls.filter((call) => call.path === `/v21.0/${IG}/messages`);
const publicReplies = () => graph.calls.filter((call) => call.path.endsWith('/replies'));

function seedWorkspace(flow: Record<string, unknown> = {}, owner: Record<string, unknown> = {}) {
  state.db.seed('user', {
    id: 'creator', email: 'creator@example.test', passwordHash: 'hash', plan: 'FREE', monthlyDmQuota: 30,
    dmsUsedThisMonth: 0, quotaResetAt: new Date(Date.now() + 20 * DAY), ...owner,
  });
  state.db.seed('metaConnection', {
    id: 'connection', userId: 'creator', metaUserId: 'meta-user', instagramAccountId: IG, facebookPageId: 'page-creator',
    instagramUsername: 'creator', accessTokenEncrypted: encryptToken(ACCESS_TOKEN),
  });
  state.db.seed('media', { id: 'media', instagramAccountId: IG, instagramMediaId: 'reel-1', mediaType: 'REEL', timestamp: new Date() });
  state.db.seed('resource', { id: 'resource', userId: 'creator', name: 'Guide', type: 'URL', url: 'https://example.test/guide' });
  return state.db.seed('automation', {
    id: 'flow', userId: 'creator', instagramAccountId: IG, mediaId: 'media', resourceId: 'resource', name: 'Guide flow',
    status: 'ACTIVE', triggerType: 'KEYWORD', matchingMode: 'EXACT', keywords: ['guide'], followGateEnabled: false,
    dmMessageTemplate: 'Hi {{username}}, here it is: {{resource_url}}', publicReplyEnabled: true,
    publicReplyTemplates: ['Check your DMs!'], ...flow,
  });
}

let sequence = 0;
function comment(overrides: Partial<CommentEventPayload> = {}): CommentEventPayload {
  sequence += 1;
  return {
    instagramAccountId: IG, mediaId: 'reel-1', commentId: `comment-${sequence}`, commenterId: `fan-${sequence}`,
    commenterUsername: `fan${sequence}`, commentText: 'guide', rawPayload: {}, ...overrides,
  };
}

const owner = () => state.db.row('user', { id: 'creator' })!;
const flow = () => state.db.row('automation', { id: 'flow' })!;
const runs = () => state.db.rows('automationRun');
const events = () => state.db.rows('webhookEvent');

async function makeDue(eventId: string) {
  await state.db.client.webhookEvent.update({ where: { id: eventId }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
}

let consoleError: ReturnType<typeof vi.spyOn>;
function expectNoTokenAnywhere() {
  expect(JSON.stringify(state.db.snapshot())).not.toContain(ACCESS_TOKEN);
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(ACCESS_TOKEN);
}

beforeEach(() => {
  state.db.reset();
  graph.calls = [];
  graph.handler = null;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: GraphCall = {
      method: init.method ?? 'GET',
      path: url.pathname,
      authorization: new Headers(init.headers).get('authorization'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    };
    graph.calls.push(call);
    return (graph.handler ?? acceptEverything)(call);
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('advisory locks in the automation pipeline', () => {
  it('processes an ACTIVE matching flow, taking every quota lock inside a transaction without void deserialization', async () => {
    seedWorkspace();
    const result = await AutomationEngine.processCommentEvent(comment());
    expect(result).toMatchObject({ status: 'PROCESSED', message: 'Private reply accepted by Meta' });

    const locks = state.db.rawQueries.filter((query) => query.sql.includes('pg_advisory'));
    expect(locks.length).toBeGreaterThanOrEqual(2); // quota check + reservation
    for (const lock of locks) {
      expect(lock.sql).toContain('pg_advisory_xact_lock(hashtextextended($?, 0))::text AS "lockResult"');
      expect(lock.values).toEqual(['quota:creator']);
      expect(lock.transactionId).not.toBeNull();
    }
    expect(state.db.transactions.filter((transaction) => transaction.outcome !== 'committed')).toEqual([]);
    const reservation = state.db.operations.find((entry) => entry.model === 'user' && entry.operation === 'updateMany'
      && entry.args.data?.dmsUsedThisMonth?.increment === 1);
    expect(reservation?.transactionId).toBe(locks.at(-1)!.transactionId);
  });

  it('replays the production P2010 failure: the event gets a visible error instead of hanging, then delivers once on retry', async () => {
    seedWorkspace();
    state.db.beforeRawQuery = () => {
      throw new FakePrismaError('P2010', `Raw query failed. Message: \`${VOID_DESERIALIZATION_MESSAGE}\``, { code: 'N/A', message: VOID_DESERIALIZATION_MESSAGE });
    };
    const failed = await AutomationEngine.processCommentEvent(comment());
    expect(failed.status).toBe('FAILED');
    const [event] = events();
    expect(event).toMatchObject({ status: 'RETRYING', retryCount: 1, processingStartedAt: null });
    expect(event.errorDetails).toContain("Database error P2010: Failed to deserialize column of type 'void'");
    expect(graph.calls).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('[automation] comment event processing failed', expect.objectContaining({ eventId: event.id }));

    state.db.beforeRawQuery = null; // the fixed, cast lock query
    await makeDue(event.id);
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(privateReplies()).toHaveLength(1);
    expect(owner().dmsUsedThisMonth).toBe(1);
    expectNoTokenAnywhere();
  });

  it('recovers comments left stuck in PROCESSING by the previous release', async () => {
    seedWorkspace();
    const stuck = state.db.seed('webhookEvent', {
      eventId: `comment:${IG}:old-comment`, eventType: 'comments', instagramAccountId: IG, mediaId: 'reel-1', commentId: 'old-comment',
      commenterId: 'fan-old', commenterUsername: 'fanold', commentText: 'guide', rawPayload: {}, status: 'PROCESSING',
      processingStartedAt: new Date(Date.now() - 11 * 60_000),
    });
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(state.db.row('webhookEvent', { id: stuck.id })?.status).toBe('PROCESSED');
    expect(privateReplies()).toEqual([expect.objectContaining({ body: expect.objectContaining({ recipient: { comment_id: 'old-comment' } }) })]);
  });
});

describe('comment matching and counters', () => {
  it('counts a matching comment as received and as a trigger, success, and DM charge', async () => {
    seedWorkspace();
    await AutomationEngine.processCommentEvent(comment());
    expect(owner()).toMatchObject({ totalCommentsReceived: 1, dmsUsedThisMonth: 1 });
    expect(flow()).toMatchObject({ totalTriggers: 1, totalSuccess: 1, totalFailed: 0, lastTriggeredAt: expect.any(Date), status: 'ACTIVE' });
  });

  it('ignores the account owner’s own comments by ID or username', async () => {
    seedWorkspace();
    const results = [
      await AutomationEngine.processCommentEvent(comment({ commenterId: IG, commenterUsername: 'someone' })),
      await AutomationEngine.processCommentEvent(comment({ commenterUsername: 'Creator' })),
    ];
    expect(results).toEqual([
      { status: 'IGNORED', message: 'Owner comment ignored' },
      { status: 'IGNORED', message: 'Owner comment ignored' },
    ]);
    expect(graph.calls).toEqual([]);
    expect(flow()).toMatchObject({ totalTriggers: 0, totalSuccess: 0 });
    expect(owner()).toMatchObject({ dmsUsedThisMonth: 0, totalCommentsReceived: 2 }); // received, not triggered
    expect(runs()).toEqual([]);
  });

  it('does not trigger on a different keyword, another post, or a paused flow', async () => {
    seedWorkspace();
    state.db.seed('media', { id: 'other-media', instagramAccountId: IG, instagramMediaId: 'reel-2', mediaType: 'REEL', timestamp: new Date() });
    const noMatch = { status: 'IGNORED', message: 'No active automation matched this comment' };
    await expect(AutomationEngine.processCommentEvent(comment({ commentText: 'hello' }))).resolves.toEqual(noMatch);
    await expect(AutomationEngine.processCommentEvent(comment({ commentText: 'guide please' }))).resolves.toEqual(noMatch);
    await expect(AutomationEngine.processCommentEvent(comment({ mediaId: 'reel-2' }))).resolves.toEqual(noMatch);

    await state.db.client.automation.update({ where: { id: 'flow' }, data: { status: 'PAUSED' } });
    await expect(AutomationEngine.processCommentEvent(comment())).resolves.toEqual(noMatch);

    expect(graph.calls).toEqual([]);
    expect(flow()).toMatchObject({ totalTriggers: 0, totalSuccess: 0, totalFailed: 0 });
    expect(owner().dmsUsedThisMonth).toBe(0);
  });
});

describe('reply processing', () => {
  it('sends the private reply, then the public reply, and records the delivery', async () => {
    seedWorkspace();
    const payload = comment({ commentText: 'GUIDE!', commenterUsername: 'fan_one' });
    const result = await AutomationEngine.processCommentEvent(payload);
    expect(result).toMatchObject({ status: 'PROCESSED', automationRunId: expect.any(String) });

    expect(graph.calls).toEqual([
      {
        method: 'POST', path: `/v21.0/${IG}/messages`, authorization: `Bearer ${ACCESS_TOKEN}`,
        body: { recipient: { comment_id: payload.commentId }, message: { text: 'Hi fan_one, here it is: https://example.test/guide' } },
      },
      { method: 'POST', path: `/v21.0/${payload.commentId}/replies`, authorization: `Bearer ${ACCESS_TOKEN}`, body: { message: 'Check your DMs!' } },
    ]);
    expect(runs()).toEqual([expect.objectContaining({
      status: 'API_ACCEPTED', dmStatus: 'SENT', publicReplyStatus: 'SENT', dmResponseId: 'mid-1', publicReplyId: 'reply-2',
      idempotencyKey: `${IG}:${payload.commentId}:flow`,
    })]);
    expect(events()[0]).toMatchObject({ status: 'PROCESSED', errorDetails: null });
    expect(state.db.row('contact', { igsid: payload.commenterId })).toMatchObject({ followGateStatus: 'DELIVERED', lastAutomationId: 'flow' });
  });

  it('sends the follow-gate welcome as the private reply, charging quota under the lock', async () => {
    seedWorkspace({ followGateEnabled: true });
    const payload = comment();
    const result = await AutomationEngine.processCommentEvent(payload);
    expect(result).toMatchObject({ status: 'PROCESSED', message: 'Access welcome sent' });

    const [welcome, reply] = graph.calls;
    expect(welcome).toMatchObject({ path: `/v21.0/${IG}/messages`, body: { recipient: { comment_id: payload.commentId } } });
    expect(welcome.body.message.attachment.payload.elements[0].buttons).toEqual([
      { type: 'postback', title: 'Send me the Access', payload: 'GET_ACCESS_flow' },
    ]);
    expect(reply).toMatchObject({ path: `/v21.0/${payload.commentId}/replies` });
    expect(state.db.row('automationContactState', { automationId: 'flow', igsid: payload.commenterId })).toMatchObject({ status: 'NEW' });
    expect(owner().dmsUsedThisMonth).toBe(1);
    expect(state.db.rawQueries.filter((query) => query.values[0] === 'quota:creator').every((query) => query.transactionId !== null)).toBe(true);
  });
});

describe('quota locking and reservation', () => {
  it('skips sending when the monthly quota is exhausted', async () => {
    seedWorkspace({}, { dmsUsedThisMonth: 30 });
    const result = await AutomationEngine.processCommentEvent(comment());
    expect(result).toMatchObject({ status: 'IGNORED', message: expect.stringContaining('quota reached') });
    expect(graph.calls).toEqual([]);
    expect(owner().dmsUsedThisMonth).toBe(30);
  });

  it('releases the reservation when Meta rejects the private reply', async () => {
    seedWorkspace();
    graph.handler = (call) => call.path.endsWith('/messages')
      ? json({ error: { code: 100, message: 'Invalid parameter' } }, 400)
      : acceptEverything(call);
    const result = await AutomationEngine.processCommentEvent(comment());
    expect(result.status).toBe('FAILED');
    expect(owner().dmsUsedThisMonth).toBe(0);
    expect(runs()[0]).toMatchObject({ status: 'FAILED', dmStatus: 'FAILED', errorCategory: 'VALIDATION' });
    expect(flow()).toMatchObject({ totalTriggers: 1, totalSuccess: 0, totalFailed: 1 });
    expect(publicReplies()).toEqual([]); // public replies only follow an accepted DM
  });

  it('never sends more DMs than the remaining quota when comments arrive concurrently', async () => {
    seedWorkspace({ publicReplyEnabled: false }, { monthlyDmQuota: 2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => AutomationEngine.processCommentEvent(comment())));
    expect(results.filter((result) => result.status === 'PROCESSED')).toHaveLength(2);
    expect(privateReplies()).toHaveLength(2);
    expect(owner().dmsUsedThisMonth).toBe(2);
    expect(owner().totalCommentsReceived).toBe(5);
  });
});

describe('safe failure handling', () => {
  it('redacts the access token from Meta errors stored on the run and event', async () => {
    seedWorkspace();
    graph.handler = (call) => call.path.endsWith('/messages')
      ? json({ error: { code: 190, message: `Invalid OAuth access token - Cannot parse access token ${ACCESS_TOKEN}` } }, 400)
      : acceptEverything(call);
    await AutomationEngine.processCommentEvent(comment());
    const [run] = runs();
    expect(run).toMatchObject({ status: 'FAILED', errorCategory: 'AUTHENTICATION' });
    expect(run.errorMessage).toContain('[REDACTED]');
    expect(events()[0].errorDetails).toContain('[Meta API 190]');
    expectNoTokenAnywhere();
  });

  it('redacts the token from network errors and schedules a retry', async () => {
    seedWorkspace();
    graph.handler = () => { throw new Error(`connect ECONNRESET graph.facebook.com?access_token=${ACCESS_TOKEN}`); };
    const result = await AutomationEngine.processCommentEvent(comment());
    expect(result.status).toBe('FAILED');
    expect(runs()[0]).toMatchObject({ status: 'RETRYING', errorCategory: 'TRANSIENT', nextRetryAt: expect.any(Date) });
    expect(events()[0]).toMatchObject({ status: 'RETRYING', retryCount: 1 });
    expect(owner().dmsUsedThisMonth).toBe(0);
    expectNoTokenAnywhere();
  });

  it('logs unexpected exceptions without the token and keeps the run retryable', async () => {
    seedWorkspace({ followGateEnabled: true });
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'automationContactState') throw new Error(`write failed while using token ${ACCESS_TOKEN}`);
    };
    const result = await AutomationEngine.processCommentEvent(comment());
    expect(result.status).toBe('FAILED');
    expect(runs()[0]).toMatchObject({ status: 'RETRYING', errorCategory: 'TRANSIENT' });
    expect(runs()[0].errorMessage).toBe('Unexpected processing error: write failed while using token [REDACTED]');
    expect(events()[0]).toMatchObject({ status: 'RETRYING', processingStartedAt: null });
    expect(graph.calls).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('[automation] comment event processing failed', expect.objectContaining({
      automationRunId: runs()[0].id, dmAccepted: false,
    }));
    expectNoTokenAnywhere();
  });
});

describe('idempotency', () => {
  it('ignores a repeated webhook delivery of the same comment', async () => {
    seedWorkspace();
    const payload = comment();
    await expect(AutomationEngine.processCommentEvent(payload)).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(AutomationEngine.processCommentEvent(payload)).resolves.toEqual({
      status: 'IGNORED', message: 'Webhook event is already being processed or completed',
    });
    expect(privateReplies()).toHaveLength(1);
    expect(events()).toHaveLength(1);
    expect(owner()).toMatchObject({ totalCommentsReceived: 1, dmsUsedThisMonth: 1 });
    expect(flow()).toMatchObject({ totalTriggers: 1, totalSuccess: 1 });
  });

  it('sends one DM when the same comment arrives concurrently or through the Page feed subscription', async () => {
    // Disable the per-user delivery rule so the comment-level idempotency key is what blocks the duplicate.
    seedWorkspace({ oneDeliveryPerUser: false });
    const payload = comment();
    await Promise.all([AutomationEngine.processCommentEvent(payload), AutomationEngine.processCommentEvent(payload)]);
    const viaPage = await AutomationEngine.processCommentEvent({ ...payload, instagramAccountId: 'page-creator' });
    expect(viaPage).toEqual({ status: 'IGNORED', message: 'Duplicate comment delivery prevented' });
    expect(privateReplies()).toHaveLength(1);
    expect(runs()).toHaveLength(1);
    expect(owner()).toMatchObject({ totalCommentsReceived: 1, dmsUsedThisMonth: 1 });
  });

  it('resumes a retrying run without double-counting the trigger', async () => {
    seedWorkspace();
    let attempts = 0;
    graph.handler = (call) => {
      if (call.path.endsWith('/messages') && attempts++ === 0) return json({ error: { code: 2, message: 'Service temporarily unavailable' } }, 503);
      return acceptEverything(call);
    };
    await AutomationEngine.processCommentEvent(comment());
    const [event] = events();
    expect(event.status).toBe('RETRYING');
    await makeDue(event.id);
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(runs()).toEqual([expect.objectContaining({ status: 'API_ACCEPTED' })]);
    expect(flow()).toMatchObject({ totalTriggers: 1, totalSuccess: 1, totalFailed: 0 });
    expect(owner().dmsUsedThisMonth).toBe(1);
    expect(publicReplies()).toHaveLength(1);
  });
});
