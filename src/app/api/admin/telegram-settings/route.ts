import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/encryption';
import { isAuthError, requireAdmin } from '@/lib/require-admin';
import {
  configureTelegramWebhook,
  isValidTelegramBotToken,
  isValidTelegramChatId,
  resolveTelegramConfig,
  sendTelegramMessage,
} from '@/lib/telegram';

export const dynamic = 'force-dynamic';

async function statusPayload() {
  const config = await resolveTelegramConfig();
  return {
    configured: Boolean(config.botToken && config.chatId),
    botTokenConfigured: Boolean(config.botToken),
    chatId: config.chatId,
    tokenSource: config.tokenSource,
    chatIdSource: config.chatIdSource,
    envOverrides: {
      botToken: config.tokenSource === 'env',
      chatId: config.chatIdSource === 'env',
    },
    webhookUrl: process.env.APP_URL
      ? `${process.env.APP_URL.replace(/\/$/, '')}/api/webhooks/telegram`
      : null,
  };
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await statusPayload());
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ error: 'Unable to load Telegram settings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const action = body.action === 'TEST' ? 'TEST' : 'SAVE';

    if (action === 'TEST') {
      await sendTelegramMessage('✅ InstaDM Auto Telegram approval bot is connected. Payment review alerts will appear in this chat.');
      return NextResponse.json({ success: true, message: 'Test message sent', ...(await statusPayload()) });
    }

    const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';
    if (botToken && !isValidTelegramBotToken(botToken)) {
      return NextResponse.json({ error: 'Enter a valid BotFather bot token' }, { status: 400 });
    }
    if (chatId && !isValidTelegramChatId(chatId)) {
      return NextResponse.json({ error: 'Telegram chat ID must contain only digits (a group ID can start with -)' }, { status: 400 });
    }

    const data: { telegramBotTokenEncrypted?: string; telegramChatId?: string } = {};
    if (botToken) data.telegramBotTokenEncrypted = encryptToken(botToken);
    if (chatId) data.telegramChatId = chatId;
    if (Object.keys(data).length) {
      // Keep one deterministic fallback regardless of which ADMIN saves settings.
      await prisma.user.updateMany({ where: { role: 'ADMIN' }, data });
      await prisma.auditLog.create({
        data: {
          userId: admin.userId,
          action: 'TELEGRAM_SETTINGS_UPDATED',
          details: { tokenUpdated: Boolean(botToken), chatIdUpdated: Boolean(chatId) },
        },
      });
    }

    const config = await resolveTelegramConfig();
    if (!config.botToken || !config.chatId) {
      return NextResponse.json({ error: 'Bot token and chat ID are both required (dashboard or environment)' }, { status: 400 });
    }

    let webhook: { url: string } | null = null;
    let webhookError: string | null = null;
    try {
      webhook = await configureTelegramWebhook();
    } catch (error) {
      webhookError = error instanceof Error ? error.message : 'Unable to register webhook';
    }

    return NextResponse.json({
      success: true,
      message: webhook ? 'Telegram settings saved and webhook registered' : 'Telegram settings saved; webhook registration needs attention',
      webhook,
      webhookError,
      ...(await statusPayload()),
    });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const message = error instanceof Error ? error.message : 'Unable to save Telegram settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
