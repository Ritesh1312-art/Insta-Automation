/**
 * GROUP C — Telegram payment-approval bot against a fake Bot API:
 *
 *   C1 POST /api/admin/telegram-settings → encrypted token, setWebhook with the
 *      derived secret, GET status shows configured + matching webhook.
 *   C2 a new UPI submission sends the Approve/Reject message with exact
 *      callback_data.
 *   C3 the webhook: correct secret approves/rejects, wrong secret is 401, and a
 *      replayed callback is idempotent.
 */
import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_IDENTIFIER,
  APP_URL,
  ADMIN_PASSWORD,
  BASE_URL,
  Session,
  clearMails,
  integrationEnabled,
  readMails,
  readTelegramCalls,
  resetTelegramMock,
  truncateAll,
  waitFor,
} from './helpers';

const describeIntegration = integrationEnabled ? describe : describe.skip;
const PASSWORD = 'StrongPass123!';
const BOT_TOKEN = '8123456789:AAHtest_token_for_local_bot_api_1234567';
const CHAT_ID = '555123456';

describeIntegration('GROUP C — Telegram settings, notifications and approvals', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let admin: Session;
  let paymentId = '';
  let userId = '';

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
    await resetTelegramMock();
    await clearMails();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    await prisma.user.create({
      data: {
        email: ADMIN_IDENTIFIER,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
        role: 'ADMIN',
        subscriptionStatus: 'ACTIVE',
      },
    });
    admin = new Session();
    expect((await admin.json('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) })).status).toBe(200);

    // A paying user; the approval tests create their own pending submission.
    const session = new Session();
    await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'payer@example.test', password: PASSWORD }),
    });
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: 'payer@example.test' } })).id;
    paymentId = '';
  });

  /** Submits a payment as the payer and returns the created payment id. */
  async function submitPayment(utrNumber: string, planType = 'STANDARD') {
    const session = new Session();
    await session.json('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'payer@example.test', password: PASSWORD }),
    });
    const response = await session.json('/api/payments/direct-upi/submit', {
      method: 'POST',
      body: JSON.stringify({
        planType,
        payerName: 'Payer Name',
        payerUpiId: 'payer@okaxis',
        utrNumber,
      }),
    });
    expect(response.status).toBe(200);
    return (await prisma.directUpiPayment.findFirstOrThrow({ where: { utrNumber } })).id;
  }

  async function configureBot() {
    const response = await admin.json<{ success: boolean; configured: boolean; webhook: { url: string } | null }>(
      '/api/admin/telegram-settings',
      { method: 'POST', body: JSON.stringify({ botToken: BOT_TOKEN, chatId: CHAT_ID }) },
    );
    expect(response.status).toBe(200);
    return response;
  }

  function derivedSecret() {
    return createHmac('sha256', process.env.AUTH_SECRET as string).update('instadm:telegram-webhook:v1').digest('hex');
  }

  it('C1: saves an encrypted token, registers the webhook with the derived secret, and reports status', async () => {
    const save = await configureBot();
    expect(save.body.success).toBe(true);
    expect(save.body.configured).toBe(true);
    expect(save.body.webhook).toEqual({ url: `${APP_URL}/api/webhooks/telegram` });

    const adminRow = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { telegramBotTokenEncrypted: true, telegramChatId: true } });
    expect(adminRow.telegramChatId).toBe(CHAT_ID);
    expect(adminRow.telegramBotTokenEncrypted).toBeTruthy();
    expect(adminRow.telegramBotTokenEncrypted).not.toContain(BOT_TOKEN);
    const { decryptToken } = await import('@/lib/encryption');
    expect(decryptToken(adminRow.telegramBotTokenEncrypted as string)).toBe(BOT_TOKEN);

    const calls = await readTelegramCalls();
    const setWebhook = calls.filter((call) => call.method === 'setWebhook').at(-1);
    expect(setWebhook?.body.url).toBe(`${APP_URL}/api/webhooks/telegram`);
    expect(setWebhook?.body.secret_token).toBe(derivedSecret());
    expect(setWebhook?.body.secret_token).not.toBe(process.env.AUTH_SECRET);
    expect(setWebhook?.body.allowed_updates).toEqual(['message', 'callback_query']);

    const status = await admin.json<any>('/api/admin/telegram-settings');
    expect(status.status).toBe(200);
    const statusCalls = await readTelegramCalls();
    expect(statusCalls.some((call) => call.method === 'getMe')).toBe(true);
    expect(statusCalls.some((call) => call.method === 'getWebhookInfo')).toBe(true);
    expect(status.body).toMatchObject({
      configured: true,
      chatId: CHAT_ID,
      tokenSource: 'database',
      chatIdSource: 'database',
      registeredWebhookUrl: `${APP_URL}/api/webhooks/telegram`,
      webhookUrl: `${APP_URL}/api/webhooks/telegram`,
      webhookMatches: true,
      botId: '8123456789',
      botUsername: 'instdm_mock_bot',
    });

    // The raw token never appears in the status payload.
    expect(JSON.stringify(status.body)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { action: 'TELEGRAM_SETTINGS_UPDATED' } }))).not.toContain(BOT_TOKEN);
  });

  it('C2: a new UPI submission sends the review message with exact Approve/Reject callback data', async () => {
    await configureBot();
    const secondId = await submitPayment('UTR111222333444', 'PREMIUM');

    const sendMessage = await waitFor(async () => {
      const calls = await readTelegramCalls();
      const candidate = calls.filter((call) => call.method === 'sendMessage').at(-1);
      return candidate && JSON.stringify(candidate.body).includes(secondId) ? candidate : null;
    }, 10_000, 'payment notification');

    expect(sendMessage.body.chat_id).toBe(CHAT_ID);
    expect(sendMessage.body.reply_markup.inline_keyboard).toEqual([[
      { text: '✅ Approve', callback_data: `PAY_APPROVE:${secondId}` },
      { text: '❌ Reject', callback_data: `PAY_REJECT:${secondId}` },
    ]]);
    expect(sendMessage.body.text).toContain('New UPI payment pending review');
    expect(sendMessage.body.text).toContain('payer@okaxis');
    expect(sendMessage.body.text).toContain('₹299');
    expect(sendMessage.body.text).toContain('UTR111222333444');
  });

  describe('C3 webhook approvals', () => {
    async function postUpdate(update: unknown, secret: string | null) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) headers['x-telegram-bot-api-secret-token'] = secret;
      // The webhook is a server-to-server endpoint: the test reaches it on the
      // loopback address the app is actually listening on.
      return fetch(`${BASE_URL}/api/webhooks/telegram`, {
        method: 'POST',
        headers,
        body: JSON.stringify(update),
      });
    }

    function callbackUpdate(id: string, data: string) {
      return {
        update_id: 1,
        callback_query: {
          id: `cb-${id}-${Math.random().toString(16).slice(2)}`,
          from: { id: 987654321, username: 'admin_user' },
          message: { message_id: 42, chat: { id: Number(CHAT_ID) } },
          data,
        },
      };
    }

    it('rejects a wrong secret with 401 and leaves the payment pending', async () => {
      await configureBot();
      paymentId = await submitPayment('UTR554433221100');
      const response = await postUpdate(callbackUpdate(paymentId, `PAY_APPROVE:${paymentId}`), 'not-the-secret');
      expect(response.status).toBe(401);
      await expect(prisma.directUpiPayment.findUniqueOrThrow({ where: { id: paymentId } }))
        .resolves.toMatchObject({ status: 'PENDING_REVIEW' });
      await expect(prisma.user.findUniqueOrThrow({ where: { id: userId } })).resolves.toMatchObject({ plan: 'FREE' });

      const missing = await postUpdate(callbackUpdate(paymentId, `PAY_APPROVE:${paymentId}`), null);
      expect(missing.status).toBe(401);
    });

    it('approves: payment VERIFIED, plan activated, user notified, callback answered and message edited', async () => {
      await configureBot();
      paymentId = await submitPayment('UTR554433221100');
      const response = await postUpdate(callbackUpdate(paymentId, `PAY_APPROVE:${paymentId}`), derivedSecret());
      expect(response.status).toBe(200);

      const payment = await waitFor(async () => {
        const row = await prisma.directUpiPayment.findUniqueOrThrow({ where: { id: paymentId } });
        return row.status === 'VERIFIED' ? row : null;
      }, 10_000, 'payment VERIFIED');
      expect(payment.approvedAt).toBeInstanceOf(Date);
      expect(payment.reviewedBy).toBe('telegram:987654321');
      expect(payment.reviewNote).toContain('@admin_user');

      await expect(prisma.user.findUniqueOrThrow({ where: { id: userId } }))
        .resolves.toMatchObject({ plan: 'STANDARD', monthlyDmQuota: 250, subscriptionStatus: 'ACTIVE' });
      await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'UPI_PAYMENT_VERIFIED' } }))
        .resolves.toMatchObject({ details: expect.objectContaining({ source: 'TELEGRAM', reviewedBy: 'telegram:987654321' }) });

      const calls = await readTelegramCalls();
      expect(calls.some((call) => call.method === 'answerCallbackQuery' && call.body.text === 'Plan activated')).toBe(true);
      const edit = calls.filter((call) => call.method === 'editMessageText').at(-1);
      expect(edit?.body.message_id).toBe(42);
      expect(edit?.body.text).toContain('✅ APPROVED');

      const mails = await readMails();
      expect(mails.some((mail) => mail.subject === 'Standard plan activated' && mail.to === 'payer@example.test')).toBe(true);
    });

    it('rejects with the reason recorded and the user keeps the free plan', async () => {
      await configureBot();
      paymentId = await submitPayment('UTR554433221100');
      const response = await postUpdate(callbackUpdate(paymentId, `PAY_REJECT:${paymentId}`), derivedSecret());
      expect(response.status).toBe(200);

      const payment = await waitFor(async () => {
        const row = await prisma.directUpiPayment.findUniqueOrThrow({ where: { id: paymentId } });
        return row.status === 'REJECTED' ? row : null;
      }, 10_000, 'payment REJECTED');
      expect(payment.reviewNote).toContain('Rejected from Telegram by @admin_user');
      expect(payment.approvedAt).toBeNull();
      await expect(prisma.user.findUniqueOrThrow({ where: { id: userId } }))
        .resolves.toMatchObject({ plan: 'FREE', monthlyDmQuota: 30 });
      await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'UPI_PAYMENT_REJECTED' } })).resolves.toBeTruthy();

      const calls = await readTelegramCalls();
      expect(calls.some((call) => call.method === 'answerCallbackQuery' && call.body.text === 'Payment rejected')).toBe(true);
      expect(calls.filter((call) => call.method === 'editMessageText').at(-1)?.body.text).toContain('❌ REJECTED');
      expect((await readMails()).some((mail) => mail.subject === 'UPI payment needs attention')).toBe(true);
    });

    it('is idempotent: replaying the same Approve callback activates the plan once', async () => {
      await configureBot();
      paymentId = await submitPayment('UTR554433221100');
      const update = callbackUpdate(paymentId, `PAY_APPROVE:${paymentId}`);
      const first = await postUpdate(update, derivedSecret());
      expect(first.status).toBe(200);
      await waitFor(async () => (
        (await prisma.directUpiPayment.findUniqueOrThrow({ where: { id: paymentId } })).status === 'VERIFIED' ? true : null
      ), 10_000, 'first approval');

      const replay = await postUpdate({ ...update, update_id: 2 }, derivedSecret());
      expect(replay.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(await prisma.auditLog.count({ where: { action: 'UPI_PAYMENT_VERIFIED' } })).toBe(1);
      const activationMails = (await readMails()).filter((mail) => mail.subject === 'Standard plan activated');
      expect(activationMails).toHaveLength(1);
      const answered = (await readTelegramCalls()).filter((call) => call.method === 'answerCallbackQuery');
      expect(answered.some((call) => call.body.text === 'Payment was already verified')).toBe(true);
    });

    it('ignores an update from an unauthorized chat instead of acting on it', async () => {
      await configureBot();
      paymentId = await submitPayment('UTR554433221100');
      const stranger = {
        update_id: 3,
        callback_query: {
          id: 'cb-stranger',
          from: { id: 111222333, username: 'stranger' },
          message: { message_id: 7, chat: { id: 999999999 } },
          data: `PAY_APPROVE:${paymentId}`,
        },
      };
      const response = await postUpdate(stranger, derivedSecret());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: 'unauthorized_chat' });
      await expect(prisma.directUpiPayment.findUniqueOrThrow({ where: { id: paymentId } }))
        .resolves.toMatchObject({ status: 'PENDING_REVIEW' });
    });
  });
});
