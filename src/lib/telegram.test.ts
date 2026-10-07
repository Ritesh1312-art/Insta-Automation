import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), decryptToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst: mocks.admin } } }));
vi.mock('@/lib/encryption', () => ({ decryptToken: mocks.decryptToken }));

import {
  botIdFromToken,
  configureTelegramWebhook,
  explainTelegramSendError,
  getTelegramBotIdentity,
  getTelegramWebhookSecret,
  isValidTelegramBotToken,
  isValidTelegramChatId,
  paymentReviewKeyboard,
  paymentTelegramText,
  redactTelegramToken,
  resolveTelegramConfig,
  sendTelegramMessageTo,
  TelegramDestinationError,
  telegramPairingCode,
  verifyTelegramWebhookSecret,
} from './telegram';

const token = '123456:abcdefghijklmnopqrstuvwxyz_123456';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_SECRET', 'telegram-auth-secret-0123456789abcdef');
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Telegram configuration and signatures', () => {
  it('derives stable secrets/codes and validates identifiers without exposing the token', () => {
    const secret = getTelegramWebhookSecret();
    expect(secret).toHaveLength(64);
    expect(verifyTelegramWebhookSecret(secret)).toBe(true);
    expect(verifyTelegramWebhookSecret(`${secret}x`)).toBe(false);
    expect(telegramPairingCode()).toMatch(/^\d{6}$/);
    expect(isValidTelegramBotToken(token)).toBe(true);
    expect(isValidTelegramBotToken('bad')).toBe(false);
    expect(isValidTelegramChatId('-1001234')).toBe(true);
    expect(botIdFromToken(token)).toBe('123456');
  });

  it('prefers environment values and falls back to encrypted admin settings', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    await expect(resolveTelegramConfig()).resolves.toMatchObject({
      botToken: token, chatId: '98765', tokenSource: 'env', chatIdSource: 'env',
    });
    expect(mocks.admin).not.toHaveBeenCalled();

    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    mocks.admin.mockResolvedValue({ telegramBotTokenEncrypted: 'cipher', telegramChatId: '-1001' });
    mocks.decryptToken.mockReturnValue(token);
    await expect(resolveTelegramConfig()).resolves.toMatchObject({
      botToken: token, chatId: '-1001', tokenSource: 'database', chatIdSource: 'database',
    });
  });

  it('turns Telegram destination failures into actionable pairing guidance', () => {
    const config = { botToken: token, chatId: '123456', tokenSource: 'env' as const, chatIdSource: 'env' as const };
    expect(explainTelegramSendError("Forbidden: bot can't send messages to bots", config)).toContain('/id');
    expect(explainTelegramSendError('Bad Request: chat not found', config)).toContain('press Start');
    expect(explainTelegramSendError('Forbidden: bot was blocked by the user', config)).toContain('Unblock');
  });
});

describe('Telegram API integration', () => {
  it('calls getMe and registers a secret-verified HTTPS webhook', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    vi.stubEnv('APP_URL', 'https://app.example.com/');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 123456, is_bot: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getTelegramBotIdentity(token)).resolves.toMatchObject({ id: 123456, is_bot: true });
    await expect(configureTelegramWebhook()).resolves.toEqual({ url: 'https://app.example.com/api/webhooks/telegram' });
    const webhookBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(webhookBody).toMatchObject({
      url: 'https://app.example.com/api/webhooks/telegram',
      secret_token: getTelegramWebhookSecret(),
      allowed_updates: ['message', 'callback_query'],
    });
  });

  it('truncates messages and wraps Telegram API destination errors safely', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, description: 'Bad Request: chat not found',
    }), { status: 400 })));
    await expect(sendTelegramMessageTo('missing-chat', 'x'.repeat(5000))).rejects.toThrow('press Start');
  });

  it('formats payment amounts from paise and scopes callback IDs', () => {
    const text = paymentTelegramText({
      id: 'payment-1', userEmail: 'user@example.com', payerName: 'Payer', payerUpiId: 'payer@upi',
      planType: 'PREMIUM', amount: 29_900, utrNumber: '123456789012', status: 'PENDING_REVIEW',
      createdAt: new Date('2026-09-29T00:00:00.000Z'),
    });
    expect(text).toContain('₹299');
    expect(text).not.toContain('₹29900');
    expect(paymentReviewKeyboard('payment-1')).toEqual([[
      { text: '✅ Approve', callback_data: 'PAY_APPROVE:payment-1' },
      { text: '❌ Reject', callback_data: 'PAY_REJECT:payment-1' },
    ]]);
  });
});

describe('Telegram bot token redaction', () => {
  it('redacts the token from URLs, bare tokens, and API paths', () => {
    const withUrl = redactTelegramToken(`request to https://api.telegram.org/bot${token}/sendMessage failed`, token);
    expect(withUrl).not.toContain(token);
    expect(withUrl).toContain('api.telegram.org/bot[REDACTED]/sendMessage');
    expect(redactTelegramToken(`echo ${token} please`, token)).not.toContain(token);
    expect(redactTelegramToken('no secrets here', token)).toBe('no secrets here');
    // Empty token must not shred the text.
    expect(redactTelegramToken('plain message', '')).toBe('plain message');
  });

  it('never leaks the token when fetch rejects with a URL-bearing network error', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    // Undici-style failure: the message embeds the full request URL, which
    // contains the bot token in its path.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new TypeError(`fetch failed: https://api.telegram.org/bot${token}/sendMessage`),
    ));
    const error = await sendTelegramMessageTo('98765', 'hello').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramDestinationError);
    const message = (error as Error).message;
    expect(message).toContain('request failed');
    expect(message).not.toContain(token);
    expect(message).not.toContain('api.telegram.org/bot123456');
  });

  it('never leaks the token when fetch rejects with a non-Error value', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(`socket hangup ${token}`));
    const error = await sendTelegramMessageTo('98765', 'hello').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramDestinationError);
    expect((error as Error).message).not.toContain(token);
  });

  it('redacts the token from Telegram API error descriptions', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, description: `Unauthorized: session ${token} is invalid`,
    }), { status: 401 })));
    const error = await getTelegramBotIdentity(token).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).toContain('[REDACTED]');
  });

  it('reports unreadable responses without echoing the body', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', {
      status: 502, headers: { 'content-type': 'text/html' },
    })));
    await expect(getTelegramBotIdentity(token)).rejects.toThrow('unreadable response (HTTP 502)');
  });

  it('still surfaces the human-actionable guidance for known destination errors', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, description: "Forbidden: bot can't send messages to bots",
    }), { status: 403 })));
    const error = await sendTelegramMessageTo('123456', 'hello').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramDestinationError);
    expect((error as Error).message).toContain('/id');
    expect((error as Error).message).not.toContain(token);
  });

  it('keeps the bot token in the URL path and out of the request body', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '98765');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendTelegramMessageTo('98765', 'hello');
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).not.toContain(token);
  });
});
