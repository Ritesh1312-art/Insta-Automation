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

export async function sendTelegramMessage(text: string, options: SendOptions = {}) {
  const config = await resolveTelegramConfig();
  if (!config.botToken || !config.chatId) throw new Error('Telegram bot token and chat ID are not configured');
  return telegramApi(config.botToken, 'sendMessage', {
    chat_id: config.chatId,
    text: text.slice(0, 4096),
    ...(options.inlineKeyboard ? { reply_markup: { inline_keyboard: options.inlineKeyboard } } : {}),
  });
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
