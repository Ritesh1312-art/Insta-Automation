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
const commentDms = () => graph.calls.filter((call) => call.body?.recipient?.comment_id);
const directDms = () => graph.calls.filter((call) => call.method === 'POST' && call.body?.recipient?.id);

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

  it('keeps one private reply per comment even when oneDeliveryPerComment is disabled', async () => {
    // Meta allows exactly one private reply per comment (BUSINESS.md), so the
    // flow-level idempotency key enforces the delivery rule regardless of how
    // the optional per-comment flag is set. Disabling per-USER dedup proves the
    // comment-level claim alone blocks the duplicate.
    seedWorkspace({ oneDeliveryPerComment: false, oneDeliveryPerUser: false });
    const payload = comment();
    const first = await AutomationEngine.ingestCommentEvent(payload);
    await expect(AutomationEngine.processWebhookEvent(first.id)).resolves.toMatchObject({ status: 'PROCESSED' });
    const redelivery = await AutomationEngine.ingestCommentEvent(payload);
    expect(redelivery.id).toBe(first.id); // the provider comment id dedupes the delivery itself
    await expect(AutomationEngine.processWebhookEvent(redelivery.id)).resolves.toEqual({
      status: 'IGNORED', message: 'Webhook event is already being processed or completed',
    });
    // A second event row for the same comment (Page feed subscription shape)
    // still cannot send a second DM.
    await expect(AutomationEngine.processCommentEvent({ ...payload, instagramAccountId: 'page-creator' })).resolves.toEqual({
      status: 'IGNORED', message: 'Duplicate comment delivery prevented',
    });
    expect(privateReplies()).toHaveLength(1);
    expect(runs()).toHaveLength(1);
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

function seedMessagingEvent(senderId: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('webhookEvent', {
    eventId: `msg:mid.${senderId}.${Math.random()}`, eventType: 'messaging', instagramAccountId: IG,
    messagingSenderId: senderId, messagingPayload: 'send', interactionType: 'TEXT',
    rawPayload: {}, status: 'RECEIVED', ...overrides,
  });
}

/** Conversation state the follow-gate requires for messaging replies to be actionable. */
function seedGateConversation(igsid: string) {
  state.db.seed('contact', { instagramAccountId: IG, igsid, username: 'fan', lastAutomationId: 'flow', followGateStatus: 'NEW' });
  state.db.seed('automationContactState', { automationId: 'flow', instagramAccountId: IG, igsid, status: 'NEW' });
}

describe('messaging events: dedupe, dispatch, and claim recovery', () => {
  it('routes each due event to its own handler, never the wrong pipeline', async () => {
    seedWorkspace();
    const commentEvent = state.db.seed('webhookEvent', {
      eventId: 'comment:ig-j1', eventType: 'comments', instagramAccountId: IG, mediaId: 'reel-1', commentId: 'j-comment-1',
      commenterId: 'fan-j1', commenterUsername: 'fanj1', commentText: 'guide', rawPayload: {}, status: 'RECEIVED',
    });
    const messagingEvent = seedMessagingEvent('fan-m1');
    seedGateConversation('fan-m1');

    const results = await AutomationEngine.processDueEvents();
    expect(results).toHaveLength(2);

    expect(state.db.row('webhookEvent', { id: commentEvent.id })).toMatchObject({ status: 'PROCESSED' });
    const after = state.db.row('webhookEvent', { id: messagingEvent.id })!;
    expect(after).toMatchObject({ status: 'PROCESSED', errorDetails: null });
    expect(after.errorDetails).not.toBe('Incomplete comment event');

    expect(commentDms()).toEqual([expect.objectContaining({ body: expect.objectContaining({ recipient: { comment_id: 'j-comment-1' } }) })]);
    expect(directDms()).toEqual([expect.objectContaining({ body: expect.objectContaining({ recipient: { id: 'fan-m1' } }) })]);
    // Only the comment path creates AutomationRuns; messaging never does.
    expect(runs()).toHaveLength(1);
    expect(runs()[0].webhookEventId).toBe(commentEvent.id);
  });

  it('refuses cross-type claims so the right handler still sees the event', async () => {
    seedWorkspace();
    seedGateConversation('fan-x1');
    const messagingEvent = seedMessagingEvent('fan-x1', { eventId: 'msg:mid.x1' });
    // The comment path must not claim (and terminalize) a messaging event…
    await expect(AutomationEngine.processWebhookEvent(messagingEvent.id)).resolves.toEqual({
      status: 'IGNORED', message: 'Webhook event is already being processed or completed',
    });
    expect(state.db.row('webhookEvent', { id: messagingEvent.id })).toMatchObject({ status: 'RECEIVED', processingStartedAt: null });
    // …and the messaging path must not consume a comment event.
    const commentEvent = await AutomationEngine.ingestCommentEvent(comment({ commenterId: 'fan-x2' }));
    await expect(AutomationEngine.processMessagingEvent(commentEvent.id)).resolves.toEqual({
      status: 'IGNORED', message: 'Messaging event already claimed',
    });
    expect(state.db.row('webhookEvent', { id: commentEvent.id })).toMatchObject({ status: 'RECEIVED' });
    expect(graph.calls).toEqual([]);

    // Both remain processable by their own handler.
    await expect(AutomationEngine.processMessagingEvent(messagingEvent.id)).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(AutomationEngine.processWebhookEvent(commentEvent.id)).resolves.toMatchObject({ status: 'PROCESSED' });
  });

  it('dedupes a repeated provider delivery by mid while keeping two identical texts apart', async () => {
    // oneDeliveryPerUser off, so the ONLY dedupe left is the provider-event identity itself.
    seedWorkspace({ oneDeliveryPerUser: false });
    seedGateConversation('fan-m2');
    const ingest = (providerEventId: string | null, occurredAt?: number) => AutomationEngine.ingestMessagingEvent({
      instagramAccountId: IG, senderId: 'fan-m2', postbackPayload: 'send', interactionType: 'TEXT', providerEventId, occurredAt, rawPayload: {},
    });

    const first = await ingest('mid.$one');
    const redelivery = await ingest('mid.$one');
    expect(redelivery.id).toBe(first.id);
    expect(events().filter((event) => event.eventType === 'messaging')).toHaveLength(1);

    // A second, genuinely separate message with identical text must be its own event.
    const second = await ingest('mid.$two');
    expect(second.id).not.toBe(first.id);
    expect(events().filter((event) => event.eventType === 'messaging')).toHaveLength(2);

    await expect(AutomationEngine.processMessagingEvent(first.id)).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(AutomationEngine.processMessagingEvent(second.id)).resolves.toMatchObject({ status: 'PROCESSED' });
    expect(directDms()).toHaveLength(2);

    // A third copy of mid.$one dedupes to the already-processed event: no new DM.
    const again = await ingest('mid.$one');
    expect(again.id).toBe(first.id);
    await expect(AutomationEngine.processMessagingEvent(again.id)).resolves.toEqual({
      status: 'IGNORED', message: 'Messaging event already claimed',
    });
    expect(directDms()).toHaveLength(2);
    expect(events().filter((event) => event.eventType === 'messaging')).toHaveLength(2);
  });

  it('falls back to a timestamped content fingerprint when the provider sends no mid', async () => {
    const ingest = (occurredAt?: number) => AutomationEngine.ingestMessagingEvent({
      instagramAccountId: IG, senderId: 'fan-m3', postbackPayload: 'send', interactionType: 'TEXT', providerEventId: null, occurredAt, rawPayload: {},
    });
    const earlier = await ingest(1_700_000_000_000);
    const later = await ingest(1_700_000_099_000);
    const replay = await ingest(1_700_000_099_000);
    expect(later.id).not.toBe(earlier.id); // same text, different moment -> distinct events
    expect(replay.id).toBe(later.id); // redelivery of the same event -> deduped
    expect(events()).toHaveLength(2);
  });

  it('absorbs the unique-constraint race when two copies of one delivery are ingested concurrently', async () => {
    const insert = state.db.seed('webhookEvent', {
      eventId: 'msg:mid.$race', eventType: 'messaging', instagramAccountId: IG, messagingSenderId: 'fan-r',
      messagingPayload: 'send', interactionType: 'TEXT', rawPayload: {}, status: 'RECEIVED',
    });
    state.db.beforeOperation = (entry) => {
      // Replay the losing side of a Postgres upsert race on the unique eventId.
      if (entry.model === 'webhookEvent' && entry.operation === 'upsert') {
        throw new FakePrismaError('P2002', 'Unique constraint failed on the fields: (eventId)', { target: ['eventId'] });
      }
    };
    await expect(AutomationEngine.ingestMessagingEvent({
      instagramAccountId: IG, senderId: 'fan-r', postbackPayload: 'send', interactionType: 'TEXT', providerEventId: 'mid.$race', rawPayload: {},
    })).resolves.toMatchObject({ id: insert.id, status: 'RECEIVED' });
    expect(events()).toHaveLength(1);
  });

  it('claims a messaging event exactly once while concurrent deliveries race', async () => {
    seedWorkspace({ oneDeliveryPerUser: false });
    seedGateConversation('fan-m4');
    const event = seedMessagingEvent('fan-m4', { eventId: 'msg:mid.$claim' });
    const results = await Promise.all([
      AutomationEngine.processMessagingEvent(event.id),
      AutomationEngine.processMessagingEvent(event.id),
    ]);
    expect(results.filter((result) => result.status === 'PROCESSED')).toHaveLength(1);
    expect(results.filter((result) => result.message === 'Messaging event already claimed')).toHaveLength(1);
    expect(directDms()).toHaveLength(1);
  });

  it('recovers a stale PROCESSING messaging event but never steals a fresh claim', async () => {
    seedWorkspace();
    seedGateConversation('fan-m5');
    const stuck = seedMessagingEvent('fan-m5', { eventId: 'msg:mid.stuck', status: 'PROCESSING', processingStartedAt: new Date(Date.now() - 11 * 60_000) });
    const fresh = seedMessagingEvent('fan-m5', { eventId: 'msg:mid.fresh', status: 'PROCESSING', processingStartedAt: new Date(Date.now() - 60_000) });
    await expect(AutomationEngine.processMessagingEvent(stuck.id)).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(AutomationEngine.processMessagingEvent(fresh.id)).resolves.toEqual({
      status: 'IGNORED', message: 'Messaging event already claimed',
    });
    expect(directDms()).toHaveLength(1);
  });

  it('processes due RETRYING messaging events only after their backoff elapses', async () => {
    seedWorkspace();
    seedGateConversation('fan-m6');
    const retrying = seedMessagingEvent('fan-m6', { eventId: 'msg:mid.retry', status: 'RETRYING', retryCount: 1, nextRetryAt: new Date(Date.now() + 60_000) });
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([]);
    await makeDue(retrying.id);
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(state.db.row('webhookEvent', { id: retrying.id })).toMatchObject({ status: 'PROCESSED', nextRetryAt: null, processingStartedAt: null });
  });

  it('retries a pre-send failure with bounded backoff, and never replays an ambiguous Meta send', async () => {
    // Per-user dedup off so the ambiguous delivery attempt is not short-circuited
    // by the "already delivered" guard before it can reach Meta.
    seedWorkspace({ oneDeliveryPerUser: false });
    seedGateConversation('fan-m7');

    // 1) A database failure before any DM is sent is retryable.
    const preSend = seedMessagingEvent('fan-m7', { eventId: 'msg:mid.pre' });
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'automationContactState') throw new Error('connection pool timeout');
    };
    await expect(AutomationEngine.processMessagingEvent(preSend.id)).resolves.toMatchObject({ status: 'FAILED' });
    let after = state.db.row('webhookEvent', { id: preSend.id })!;
    expect(after).toMatchObject({ status: 'RETRYING', retryCount: 1, processedAt: null, processingStartedAt: null });
    expect(after.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    expect(directDms()).toHaveLength(0); // the failure happened before Meta was ever called

    state.db.beforeOperation = null;
    await makeDue(preSend.id);
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(directDms()).toHaveLength(1);
    expect(owner().dmsUsedThisMonth).toBe(1);

    // 2) A network error after the DM was handed to Meta is ambiguous: replaying
    //    it could double-send the user's DM, so the event stays terminal FAILED.
    graph.handler = (call) => {
      if (call.method === 'POST' && call.body?.recipient?.id) throw new Error('socket hang up after Meta may have accepted the request');
      return acceptEverything(call);
    };
    const ambiguous = seedMessagingEvent('fan-m7', { eventId: 'msg:mid.amb' });
    await expect(AutomationEngine.processMessagingEvent(ambiguous.id)).resolves.toMatchObject({ status: 'FAILED' });
    after = state.db.row('webhookEvent', { id: ambiguous.id })!;
    expect(after).toMatchObject({ status: 'FAILED', retryCount: 1, nextRetryAt: null });
    expect(after.errorDetails).toContain('socket hang up');

    // Exactly one send attempt was made for the ambiguous event (template POST
    // + plain-text fallback POST, both outcome-unknown), and the cron must not
    // pick the event up to replay it.
    expect(directDms()).toHaveLength(3); // pre-send success + the two ambiguous POSTs
    await expect(AutomationEngine.processDueEvents()).resolves.toEqual([]);
    expect(directDms()).toHaveLength(3); // the ambiguous send was never retried
    expect(owner().dmsUsedThisMonth).toBe(1); // the failed send released its quota reservation
    expectNoTokenAnywhere();
  });

  it('stops scheduling messaging retries once the bounded attempt budget is spent', async () => {
    seedWorkspace();
    seedGateConversation('fan-m8');
    const exhausted = seedMessagingEvent('fan-m8', { eventId: 'msg:mid.max', status: 'RETRYING', retryCount: 5, nextRetryAt: new Date(Date.now() - 1_000) });
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'automationContactState') throw new Error('connection pool timeout');
    };
    await expect(AutomationEngine.processMessagingEvent(exhausted.id)).resolves.toMatchObject({ status: 'FAILED' });
    expect(state.db.row('webhookEvent', { id: exhausted.id })).toMatchObject({
      status: 'FAILED', retryCount: 6, nextRetryAt: null,
    });
  });
});

describe('follow-gate action validation', () => {
  it('rejects copied button payloads that have no conversation state, then honors the same token once the gate DM was sent', async () => {
    seedWorkspace({ followGateEnabled: true });
    // Contact exists but no automationContactState row: a pasted button token must not run.
    state.db.seed('contact', { instagramAccountId: IG, igsid: 'fan-g1', username: 'fan', lastAutomationId: 'flow', followGateStatus: 'FOLLOW_ASKED' });
    const copied = seedMessagingEvent('fan-g1', {
      eventId: 'msg:mid.copy', messagingPayload: 'CONFIRM_FOLLOW_flow', interactionType: 'POSTBACK',
    });
    await expect(AutomationEngine.processMessagingEvent(copied.id)).resolves.toMatchObject({
      status: 'IGNORED', message: 'Unknown or copied button payload',
    });
    expect(directDms()).toHaveLength(0);
    expect(state.db.row('webhookEvent', { id: copied.id })?.status).toBe('IGNORED');

    // With a real access-welcome state, the same postback is honored. The live
    // follow check says "not following", so the user gets the prompt back
    // instead of the resource.
    state.db.seed('automationContactState', { automationId: 'flow', instagramAccountId: IG, igsid: 'fan-g1', status: 'NEW' });
    const genuine = seedMessagingEvent('fan-g1', {
      eventId: 'msg:mid.genuine', messagingPayload: 'GET_ACCESS_flow', interactionType: 'POSTBACK',
    });
    await expect(AutomationEngine.processMessagingEvent(genuine.id)).resolves.toMatchObject({
      status: 'PROCESSED', message: 'Follow not detected; follow prompt sent',
    });
    expect(directDms()).toHaveLength(1);
    expect(state.db.row('automationContactState', { automationId: 'flow', igsid: 'fan-g1' })).toMatchObject({ status: 'NEW' });
  });

  it('delivers once for a genuine confirmation and blocks the second claim instead of re-DMing', async () => {
    seedWorkspace({ followGateEnabled: true });
    graph.handler = (call) => call.method === 'GET'
      ? json({ username: 'fan', is_user_follow_business: true })
      : acceptEverything(call);
    seedGateConversation('fan-g2');
    const confirm = seedMessagingEvent('fan-g2', {
      eventId: 'msg:mid.confirm', messagingPayload: 'CONFIRM_FOLLOW_flow', interactionType: 'QUICK_REPLY',
    });
    await expect(AutomationEngine.processMessagingEvent(confirm.id)).resolves.toMatchObject({
      status: 'PROCESSED', message: 'Live follow verified; resource delivered',
    });
    expect(state.db.row('automationContactState', { automationId: 'flow', igsid: 'fan-g2' })).toMatchObject({ status: 'DELIVERED' });
    expect(state.db.row('contact', { instagramAccountId: IG, igsid: 'fan-g2' })).toMatchObject({ followGateStatus: 'DELIVERED' });

    // A second legitimate message cannot re-deliver: the per-user delivery rule
    // (and, behind it, the spent claim) blocks a duplicate resource DM.
    const replay = seedMessagingEvent('fan-g2', { eventId: 'msg:mid.again', messagingPayload: 'CONFIRM_FOLLOW_flow', interactionType: 'QUICK_REPLY' });
    await expect(AutomationEngine.processMessagingEvent(replay.id)).resolves.toMatchObject({
      status: 'IGNORED', message: 'Resource already delivered to this user for this flow',
    });
    expect(directDms()).toHaveLength(1);
    expect(owner().dmsUsedThisMonth).toBe(1);
    expectNoTokenAnywhere();
  });

  it('ignores plain-text chatter and never reaches Meta for it', async () => {
    seedWorkspace();
    seedGateConversation('fan-g3');
    const chatter = seedMessagingEvent('fan-g3', {
      eventId: 'msg:mid.chatter', messagingPayload: 'hmm interesting, tell me more about your holiday photos!',
      interactionType: 'TEXT',
    });
    await expect(AutomationEngine.processMessagingEvent(chatter.id)).resolves.toMatchObject({
      status: 'IGNORED', message: 'Messaging event is not a follow-gate action',
    });
    expect(graph.calls).toEqual([]);
  });
});

describe('comment payload retention', () => {
  it('stores only the actionable comment fields, not the full webhook body', async () => {
    seedWorkspace();
    const payload = comment({ commentText: 'guide' });
    const row = await AutomationEngine.ingestCommentEvent({ ...payload, rawPayload: { entry: [{ secretConversation: 'never-store-me' }] } });
    expect(row.rawPayload).toEqual({ eventId: row.eventId, eventType: 'comments' });
    expect(JSON.stringify(state.db.snapshot())).not.toContain('never-store-me');
  });
});

describe('messaging payload retention and audit hygiene', () => {
  it('stores only the actionable prefix, never the raw webhook body or secrets', async () => {
    seedWorkspace();
    const longText = 'y'.repeat(500);
    const event = await AutomationEngine.ingestMessagingEvent({
      instagramAccountId: IG, senderId: 'fan-p1', postbackPayload: longText, interactionType: 'TEXT',
      providerEventId: 'mid.$long', rawPayload: { privateConversation: 'z'.repeat(400) },
    });
    expect(event.messagingPayload).toBe('y'.repeat(160));
    expect(event.rawPayload).toEqual({ eventId: event.eventId });

    await expect(AutomationEngine.processMessagingEvent(event.id)).resolves.toMatchObject({
      status: 'IGNORED', message: 'Messaging event is not a follow-gate action',
    });

    const audit = state.db.rows('auditLog').at(-1)!;
    expect(audit.action).toBe('MESSAGING_IGNORED');
    expect(audit.details.payload).toBe('y'.repeat(160));
    expect(JSON.stringify(audit.details)).not.toContain('z'.repeat(50));
    expect(JSON.stringify(state.db.snapshot())).not.toContain('z'.repeat(50)); // the raw webhook body was never persisted
    expectNoTokenAnywhere();
  });
});
