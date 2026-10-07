/**
 * GROUPS A5–A9 + D — the whole comment → follow-gate → resource pipeline,
 * driven by signed Meta webhooks through the real HTTP server, with the mock
 * Graph API recording every outbound call and PostgreSQL holding the state.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  IG_ACCOUNT_ID,
  PAGE_ID,
  PAGE_TOKEN,
  Session,
  commentWebhook,
  integrationEnabled,
  postbackWebhook,
  readGraphCalls,
  signMetaBody,
  resetGraphControl,
  setMockFollowing,
  textWebhook,
  truncateAll,
  truncateMockLogs,
  waitFor,
  MOCK_GRAPH_LOG,
} from './helpers';

const describeIntegration = integrationEnabled ? describe : describe.skip;
const FAN = 'fan-igsid-1';
const MEDIA_ID = 'reel-live-1';
const OTHER_USER = 'fan-igsid-2';

describeIntegration('follow-gate pipeline over signed webhooks', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let encryptToken: typeof import('@/lib/encryption').encryptToken;
  let automationId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ prisma } = await import('@/lib/prisma'));
    ({ encryptToken } = await import('@/lib/encryption'));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await resetGraphControl();
    truncateMockLogs(MOCK_GRAPH_LOG);
    await setMockFollowing(true);

    const user = await prisma.user.create({
      data: {
        id: 'creator-1',
        email: 'creator@example.test',
        passwordHash: 'hash',
        plan: 'FREE',
        monthlyDmQuota: 30,
        quotaResetAt: new Date(Date.now() + 20 * 86_400_000),
      },
    });
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
    await prisma.media.create({
      data: {
        instagramAccountId: IG_ACCOUNT_ID,
        instagramMediaId: MEDIA_ID,
        mediaType: 'REEL',
        timestamp: new Date(),
      },
    });
    const resource = await prisma.resource.create({
      data: { userId: user.id, name: 'Free guide', type: 'URL', url: 'https://example.com/guide' },
    });
    const automation = await prisma.automation.create({
      data: {
        userId: user.id,
        instagramAccountId: IG_ACCOUNT_ID,
        mediaId: (await prisma.media.findFirstOrThrow()).id,
        resourceId: resource.id,
        name: 'Guide flow',
        status: 'ACTIVE',
        keywords: ['guide'],
        triggerType: 'KEYWORD',
        followGateEnabled: true,
        dmMessageTemplate: 'Hi {{username}}, here is your guide: {{resource_url}}',
        publicReplyEnabled: true,
        publicReplyTemplates: ['@{{username}} just sent it to your DMs! 📩'],
      },
    });
    automationId = automation.id;
  });

  async function sendComment(commentId: string, text = 'guide') {
    const raw = JSON.stringify(commentWebhook({
      instagramAccountId: IG_ACCOUNT_ID, mediaId: MEDIA_ID, commentId, commenterId: FAN, text,
    }));
    const response = await new Session().fetch('/api/webhooks/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signMetaBody(raw) },
      body: raw,
    });
    expect(response.status).toBe(200);
    return response;
  }

  async function sendPostback(payload: string) {
    const raw = JSON.stringify(postbackWebhook({ instagramAccountId: IG_ACCOUNT_ID, senderId: FAN, payload }));
    const response = await new Session().fetch('/api/webhooks/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signMetaBody(raw) },
      body: raw,
    });
    expect(response.status).toBe(200);
    return response;
  }

  async function sendText(text: string) {
    const raw = JSON.stringify(textWebhook({ instagramAccountId: IG_ACCOUNT_ID, senderId: FAN, text }));
    const response = await new Session().fetch('/api/webhooks/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signMetaBody(raw) },
      body: raw,
    });
    expect(response.status).toBe(200);
    return response;
  }

  const runFor = (commentId: string) =>
    prisma.automationRun.findUniqueOrThrow({ where: { idempotencyKey: `${IG_ACCOUNT_ID}:${commentId}:${automationId}` } });

  const stateFor = () =>
    prisma.automationContactState.findUniqueOrThrow({
      where: { automationId_igsid: { automationId, igsid: FAN } },
    });

  it('A5/A6/A8: comment → welcome DM with GET_ACCESS button → public reply, quota counted once', async () => {
    await sendComment('comment-a8');

    const run = await waitFor(async () => {
      const candidate = await prisma.automationRun.findFirst({ where: { automationId } });
      return candidate?.status === 'API_ACCEPTED' ? candidate : null;
    }, 15_000, 'automation run to be API_ACCEPTED');

    expect(run).toMatchObject({ dmStatus: 'SENT', publicReplyStatus: 'SENT', dmResponseId: 'mid-mock-1' });
    expect(run.publicReplyId).toBe('reply-mock-1');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'creator-1' } });
    expect(user.dmsUsedThisMonth).toBe(1); // reserved once for the welcome DM
    expect(user.totalCommentsReceived).toBe(1);
    const automation = await prisma.automation.findUniqueOrThrow({ where: { id: automationId } });
    expect(automation).toMatchObject({ totalTriggers: 1, totalSuccess: 1, totalFailed: 0 });

    await expect(prisma.contact.findUniqueOrThrow({
      where: { instagramAccountId_igsid: { instagramAccountId: IG_ACCOUNT_ID, igsid: FAN } },
    })).resolves.toMatchObject({ followGateStatus: 'NEW', promptSentAt: null });
    await expect(stateFor()).resolves.toMatchObject({ status: 'NEW' });

    const calls = await readGraphCalls();
    const message = calls.find((call) => call.path === `/v26.0/${IG_ACCOUNT_ID}/messages`);
    expect(message?.authorization).toBe(`Bearer ${PAGE_TOKEN}`);
    const body = JSON.parse(message?.body || '{}');
    expect(body.recipient).toEqual({ comment_id: 'comment-a8' }); // A5: private reply
    expect(JSON.stringify(body.message)).toContain(`GET_ACCESS_${automationId}`);

    const publicReply = calls.find((call) => call.path === '/v26.0/comment-a8/replies');
    expect(publicReply).toBeTruthy();
    // D: the {{username}} placeholder is rendered with the commenter handle.
    expect(JSON.parse(publicReply?.body || '{}').message).toBe('@fan.account just sent it to your DMs! 📩');

    await expect(prisma.webhookEvent.findFirstOrThrow({ where: { commentId: 'comment-a8' } }))
      .resolves.toMatchObject({ status: 'PROCESSED' });
  });

  it('A7/A9: a fresh follow check on every retry — not following stays FOLLOW_ASKED, following unlocks once', async () => {
    await sendComment('comment-a7');
    await waitFor(() => prisma.automationRun.findFirst({ where: { automationId, status: 'API_ACCEPTED' } }), 15_000, 'welcome DM');

    // A7: not following -> UNLOCKED is never set; the prompt asks for a follow.
    await setMockFollowing(false);
    await sendPostback(`GET_ACCESS_${automationId}`);
    await waitFor(async () => ((await stateFor()).status === 'FOLLOW_ASKED' ? true : null), 10_000, 'FOLLOW_ASKED after postback');
    await expect(prisma.contact.findUniqueOrThrow({
      where: { instagramAccountId_igsid: { instagramAccountId: IG_ACCOUNT_ID, igsid: FAN } },
    })).resolves.toMatchObject({ followGateStatus: 'FOLLOW_ASKED', promptSentAt: null });

    const afterAsk = await readGraphCalls();
    const followAsk = afterAsk.filter((call) => call.path === `/v26.0/${IG_ACCOUNT_ID}/messages`).at(-1);
    expect(followAsk?.body).toContain("I've followed");
    expect(followAsk?.body).toContain('Follow Me');
    expect(followAsk?.body).toContain(`CONFIRM_FOLLOW_${automationId}`);

    // A9: still not following on the retry -> checked again, still FOLLOW_ASKED.
    await sendText("I've followed");
    await waitFor(async () => {
      const checks = await prisma.auditLog.count({ where: { action: 'FOLLOW_RELATIONSHIP_CHECK' } });
      return checks >= 2 ? checks : null;
    }, 10_000, 'a second live follow check');
    const stillAsked = await stateFor();
    expect(stillAsked.status).toBe('FOLLOW_ASKED');
    expect(stillAsked.followPromptCount).toBe(2);
    expect(await prisma.contact.findFirstOrThrow({ where: { igsid: FAN } })).toMatchObject({ promptSentAt: null });

    // A7: now the account really follows -> delivery, state DELIVERED.
    await setMockFollowing(true);
    await sendText('done');
    await waitFor(async () => ((await stateFor()).status === 'DELIVERED' ? true : null), 10_000, 'DELIVERED after following');

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { instagramAccountId_igsid: { instagramAccountId: IG_ACCOUNT_ID, igsid: FAN } },
    });
    expect(contact.followGateStatus).toBe('DELIVERED');
    expect(contact.promptSentAt).toBeInstanceOf(Date);
    expect(contact.claimedFollowAt).toBeInstanceOf(Date);

    const checks = await prisma.auditLog.findMany({ where: { action: 'FOLLOW_RELATIONSHIP_CHECK' }, orderBy: { createdAt: 'asc' } });
    expect(checks.map((row) => (row.details as any).following)).toEqual([false, false, true]);
    expect(checks.map((row) => (row.details as any).source)).toEqual(['button', 'text', 'text']);

    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'FOLLOW_GATE_VERIFIED' } }))
      .resolves.toMatchObject({ details: expect.objectContaining({ method: 'text', igsid: FAN }) });

    // The A8 delivery promise: the resource text with both placeholders resolved.
    const deliverBody = (await readGraphCalls())
      .filter((call) => call.path === `/v26.0/${IG_ACCOUNT_ID}/messages`)
      .at(-1)?.body || '';
    expect(deliverBody).toContain('Hi fan.account, here is your guide: https://example.com/guide');

    const messages = async () => (await readGraphCalls()).filter((call) => call.path === `/v26.0/${IG_ACCOUNT_ID}/messages`);
    const resourceMessages = async () => (await messages()).filter((call) => (call.body || '').includes('here is your guide')).length;
    expect(await resourceMessages()).toBe(1);

    // One delivery per user: a second "done" must not send anything again.
    const messagesBefore = (await messages()).length;
    await sendText('done again');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect((await messages()).length).toBe(messagesBefore);
    expect(await resourceMessages()).toBe(1);
    // totalSuccess counts every Meta send this flow accepted: the welcome DM and
    // the one resource delivery (unchanged behaviour, verified here explicitly).
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: automationId } })).totalSuccess).toBe(2);
  });

  it('A9: a typed button token is ignored, and the third retry hits the prompt cap', async () => {
    await sendComment('comment-cap');
    await waitFor(() => prisma.automationRun.findFirst({ where: { automationId, status: 'API_ACCEPTED' } }), 15_000, 'welcome DM');
    await setMockFollowing(false);

    // Currently no state row exists for a manual text, so the copied token is
    // rejected exactly like a copied button payload.
    await sendPostback(`GET_ACCESS_${automationId}`); // creates the state row
    await waitFor(async () => ((await stateFor()).status === 'FOLLOW_ASKED' ? true : null), 10_000, 'FOLLOW_ASKED');

    // Retries 2 and 3 are still answered…
    await sendText("i've followed");
    await waitFor(async () => ((await stateFor()).followPromptCount === 2 ? true : null), 10_000, 'prompt #2');
    await sendText('followed');
    await waitFor(async () => ((await stateFor()).followPromptCount === 3 ? true : null), 10_000, 'prompt #3');

    // …the 4th is refused by the cap, so quota is not spent forever.
    const messageCalls = async () => (await readGraphCalls()).filter((call) => call.path.endsWith('/messages')).length;
    const before = await messageCalls();
    await sendText('done');
    await waitFor(async () => (
      (await prisma.auditLog.count({ where: { action: 'MESSAGING_IGNORED' } })) >= 1 ? true : null
    ), 10_000, 'IGNORED audit entry');
    const ignored = await prisma.auditLog.findFirstOrThrow({ where: { action: 'MESSAGING_IGNORED' } });
    expect((ignored.details as any).outcome).toContain('Follow prompt limit reached (3)');
    await expect(stateFor()).resolves.toMatchObject({ followPromptCount: 3 });
    // No further DM was sent (the follow check itself is still performed, which
    // is what keeps the next retry honest if the account follows meanwhile).
    expect(await messageCalls()).toBe(before);

    // A copied/typed postback token is never trusted as a postback.
    await sendText(`GET_ACCESS_${automationId}`);
    await waitFor(async () => (
      (await prisma.auditLog.count({ where: { action: 'MESSAGING_IGNORED' } })) >= 2 ? true : null
    ), 10_000, 'second IGNORED audit entry');
    const latest = await prisma.auditLog.findFirstOrThrow({ where: { action: 'MESSAGING_IGNORED' }, orderBy: { createdAt: 'desc' } });
    expect((latest.details as any).outcome).toBe('Button tokens are accepted only from signed postback events');
  });

  it('A9: an unknown sender postback is rejected and a different user is never delivered to', async () => {
    const raw = JSON.stringify(postbackWebhook({ instagramAccountId: IG_ACCOUNT_ID, senderId: OTHER_USER, payload: `GET_ACCESS_${automationId}` }));
    const response = await new Session().fetch('/api/webhooks/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signMetaBody(raw) },
      body: raw,
    });
    expect(response.status).toBe(200);

    await waitFor(async () => (
      (await prisma.auditLog.count({ where: { action: { in: ['MESSAGING_IGNORED', 'MESSAGING_PROCESSED'] } } })) >= 1 ? true : null
    ), 10_000, 'messaging audit entry');
    await expect(prisma.automationRun.count()).resolves.toBe(0);
    expect(await prisma.contact.count({ where: { igsid: OTHER_USER } })).toBe(0);
  });

  it('A5: a Meta rejection releases the reserved quota instead of charging for it', async () => {
    await fetch(`${process.env.META_GRAPH_BASE_URL}/v26.0/__control/messaging-error?code=1`);
    await sendComment('comment-fail');

    await waitFor(async () => {
      const event = await prisma.webhookEvent.findFirst({ where: { commentId: 'comment-fail' } });
      return event && ['FAILED', 'RETRYING'].includes(event.status) ? event : null;
    }, 15_000, 'failed webhook event');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'creator-1' } });
    expect(user.dmsUsedThisMonth).toBe(0); // the reservation was released
    const run = await runFor('comment-fail');
    expect(run.dmStatus).toBe('FAILED');
    expect(run.status).toBe('RETRYING'); // transient errors stay retryable
    await expect(prisma.automation.findUniqueOrThrow({ where: { id: automationId } }))
      .resolves.toMatchObject({ totalFailed: 0 });
    await fetch(`${process.env.META_GRAPH_BASE_URL}/v26.0/__control/messaging-error`);
  });
});

describeIntegration('webhook signature enforcement (A1/A8 prerequisite)', () => {
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
  });

  it('rejects an unsigned or wrongly signed webhook', async () => {
    const payload = JSON.stringify(commentWebhook({
      instagramAccountId: IG_ACCOUNT_ID, mediaId: MEDIA_ID, commentId: 'forged', commenterId: FAN, text: 'guide',
    }));
    const unsigned = await fetch(`${BASE_URL}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(unsigned.status).toBe(401);

    const wrongKey = await fetch(`${BASE_URL}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signMetaBody(payload, 'wrong-secret') },
      body: payload,
    });
    expect(wrongKey.status).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });
});
