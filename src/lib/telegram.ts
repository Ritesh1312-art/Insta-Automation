import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';

type DirectUpiPaymentRecord = {
  id: string;
  userEmail: string;
  payerName: string;
  payerUpiId: string;
  planType: string;
  amount: number;
  utrNumber: string;
  status: string;
  createdAt: Date;
};

const WEBHOOK_PURPOSE = 'instadm:telegram-webhook:v1';
const PAIRING_PURPOSE = 'instadm:telegram-pairing:v1';

export type TelegramConfig = {
  botToken: string;
  chatId: string;
  tokenSource: 'env' | 'database' | 'missing';
  chatIdSource: 'env' | 'database' | 'missing';
};

type InlineButton = { text: string; callback_data: string };
type SendOptions = { inlineKeyboard?: InlineButton[][] };

function requireAuthSecret() {
  const secret = process.env.AUTH_SECRET || '';
  if (secret.length < 32) throw new Error('AUTH_SECRET must be configured with at least 32 characters');
  return secret;
}

export function getTelegramWebhookSecret() {
  return createHmac('sha256', requireAuthSecret()).update(WEBHOOK_PURPOSE).digest('hex');
}

export function verifyTelegramWebhookSecret(received: string | null) {
  if (!received) return false;
  try {
    const expected = Buffer.from(getTelegramWebhookSecret());
    const actual = Buffer.from(received);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function isValidTelegramBotToken(value: string) {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export function isValidTelegramChatId(value: string) {
  return /^-?\d+$/.test(value.trim());
}

/**
 * A BotFather token is `<bot_user_id>:<secret>`. The numeric prefix IS the bot's
 * own Telegram user ID, exposed here only so the dashboard can display which bot
 * a stored token belongs to without ever revealing the token itself.
 */
export function botIdFromToken(botToken: string): string {
  return (botToken.split(':')[0] || '').trim();
}

/** Six-digit code the admin sends to the bot to bind their real personal chat. */
export function telegramPairingCode(): string {
  const digest = createHmac('sha256', requireAuthSecret()).update(PAIRING_PURPOSE).digest('hex');
  return (parseInt(digest.slice(0, 8), 16) % 1_000_000).toString().padStart(6, '0');
}

export class TelegramDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramDestinationError';
  }
}

/**
 * Human-actionable guidance for the destination errors Telegram returns, so the
 * dashboard explains the fix instead of surfacing a raw API string.
 */
export function explainTelegramSendError(message: string, config: TelegramConfig): string {
  const code = telegramPairingCode();
  // Telegram rewords this rejection over time. TDLib maps USER_IS_BOT to
  // "Bots can't send messages to bots" historically and to
  // "The bot can't send messages to the bot" since 2026-05, which the Bot API
  // then prefixes as "Forbidden: ...". Match every variant so the actionable
  // guidance below is shown instead of the raw API string.
  if (/can't send messages to (?:bots|the bot)/i.test(message)) {
    return `Telegram rejected the destination: the configured chat ID (${config.chatId}) is the bot's own account, so the bot is messaging itself. Open a direct chat with your bot in Telegram, send "/id ${code}", and the bot will save your real personal chat ID automatically. The chat ID currently comes from ${config.chatIdSource === 'env' ? 'the TELEGRAM_CHAT_ID environment variable, which must be updated or removed in Vercel' : 'the dashboard/database and will be updated for you'}.`;
  }
  if (/chat not found/i.test(message)) {
    return `Telegram could not find chat ${config.chatId}. Open a direct chat with your bot, press Start, then send "/id ${code}" so the bot can record the correct chat ID.`;
  }
  if (/bot was blocked by the user/i.test(message)) {
    return 'The admin has blocked this bot in Telegram. Unblock it, press Start, then send the test again.';
  }
  if (/bot is not a member/i.test(message) || /bot was kicked/i.test(message)) {
    return `The bot is not a member of chat ${config.chatId}. Add the bot to that group (or use a direct chat) and try again.`;
  }
  return message;
}

export async function resolveTelegramConfig(): Promise<TelegramConfig> {
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const envChatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  let databaseToken = '';
  let databaseChatId = '';

  if (!envToken || !envChatId) {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { telegramBotTokenEncrypted: true, telegramChatId: true },
    });
    databaseChatId = admin?.telegramChatId?.trim() || '';
    if (admin?.telegramBotTokenEncrypted) {
      try {
        databaseToken = decryptToken(admin.telegramBotTokenEncrypted).trim();
      } catch {
        databaseToken = '';
      }
    }
  }

  return {
    botToken: envToken || databaseToken,
    chatId: envChatId || databaseChatId,
    tokenSource: envToken ? 'env' : databaseToken ? 'database' : 'missing',
    chatIdSource: envChatId ? 'env' : databaseChatId ? 'database' : 'missing',
  };
}

async function telegramApi<T = Record<string, unknown>>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!isValidTelegramBotToken(botToken)) throw new Error('Telegram bot token is missing or invalid');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram ${method} failed`);
  }
  return result.result as T;
}

export type TelegramBotIdentity = { id: number; username?: string; first_name?: string; is_bot?: boolean };

/** Confirms which bot the stored token belongs to. Never returns the token. */
export async function getTelegramBotIdentity(botToken: string) {
  return telegramApi<TelegramBotIdentity>(botToken, 'getMe', {});
}

export type TelegramWebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  ip_address?: string;
};

/** Reads the webhook Telegram actually has registered, not the one the UI guesses. */
export async function getTelegramWebhookInfo(botToken: string) {
  return telegramApi<TelegramWebhookInfo>(botToken, 'getWebhookInfo', {});
}

export async function sendTelegramMessage(text: string, options: SendOptions = {}) {
  const config = await resolveTelegramConfig();
  if (!config.botToken || !config.chatId) throw new Error('Telegram bot token and chat ID are not configured');
  return sendTelegramMessageTo(config.chatId, text, options);
}

/**
 * Sends to an explicit chat ID. The configured chat ID is passed straight to the
 * Telegram sendMessage API; any destination error Telegram actually returns is
 * translated into human-actionable guidance below.
 */
export async function sendTelegramMessageTo(chatId: string, text: string, options: SendOptions = {}) {
  const config = await resolveTelegramConfig();
  if (!config.botToken) throw new Error('Telegram bot token is not configured');
  try {
    return await telegramApi(config.botToken, 'sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...(options.inlineKeyboard ? { reply_markup: { inline_keyboard: options.inlineKeyboard } } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telegram sendMessage failed';
    throw new TelegramDestinationError(explainTelegramSendError(message, { ...config, chatId }));
  }
}

export async function answerTelegramCallback(callbackQueryId: string, text: string, showAlert = false) {
  const config = await resolveTelegramConfig();
  if (!config.botToken) return;
  await telegramApi(config.botToken, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 200),
    show_alert: showAlert,
  });
}

export async function editTelegramMessage(chatId: string, messageId: number, text: string) {
  const config = await resolveTelegramConfig();
  if (!config.botToken) return;
  await telegramApi(config.botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4096),
  });
}

export async function configureTelegramWebhook() {
  const config = await resolveTelegramConfig();
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (!config.botToken || !config.chatId) throw new Error('Telegram bot token and chat ID are not configured');
  if (!/^https:\/\//.test(appUrl)) throw new Error('APP_URL must be an HTTPS URL before the Telegram webhook can be registered');

  await telegramApi(config.botToken, 'setWebhook', {
    url: `${appUrl}/api/webhooks/telegram`,
    secret_token: getTelegramWebhookSecret(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  return { url: `${appUrl}/api/webhooks/telegram` };
}

export function paymentTelegramText(payment: Pick<DirectUpiPaymentRecord, 'id' | 'userEmail' | 'payerName' | 'payerUpiId' | 'planType' | 'amount' | 'utrNumber' | 'status' | 'createdAt'>) {
  const heading = payment.status === 'VERIFIED'
    ? 'UPI payment approved'
    : payment.status === 'REJECTED'
      ? 'UPI payment rejected'
      : 'New UPI payment pending review';
  return [
    heading,
    '',
    `Customer: ${payment.userEmail}`,
    `Payer: ${payment.payerName} (${payment.payerUpiId})`,
    `Plan: ${payment.planType}`,
    `Amount: ₹${payment.amount}`,
    `UTR: ${payment.utrNumber}`,
    `Submitted: ${payment.createdAt.toISOString()}`,
    `Payment ID: ${payment.id}`,
    '',
    'Verify the UTR and amount in your bank app before approving.',
  ].join('\n');
}

export function paymentReviewKeyboard(paymentId: string): InlineButton[][] {
  return [[
    { text: '✅ Approve', callback_data: `PAY_APPROVE:${paymentId}` },
    { text: '❌ Reject', callback_data: `PAY_REJECT:${paymentId}` },
  ]];
}

export async function notifyTelegramPaymentSubmitted(payment: DirectUpiPaymentRecord) {
  try {
    const config = await resolveTelegramConfig();
    if (!config.botToken || !config.chatId) return false;
    await sendTelegramMessage(paymentTelegramText(payment), {
      inlineKeyboard: paymentReviewKeyboard(payment.id),
    });
    return true;
  } catch (error) {
    console.error('Telegram payment notification failed:', error instanceof Error ? error.message : error);
    return false;
  }
}
