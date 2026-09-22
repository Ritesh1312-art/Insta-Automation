import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { PaymentReviewError, reviewDirectUpiPayment } from '@/lib/payment-review';
import {
  answerTelegramCallback,
  editTelegramMessage,
  isValidTelegramChatId,
  paymentReviewKeyboard,
  paymentTelegramText,
  resolveTelegramConfig,
  sendTelegramMessage,
  sendTelegramMessageTo,
  telegramPairingCode,
  verifyTelegramWebhookSecret,
} from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TelegramUpdate = {
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string };
    from?: { id: number | string; username?: string; is_bot?: boolean };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number | string; username?: string };
    message?: { message_id: number; chat: { id: number | string } };
  };
};

function updateChatId(update: TelegramUpdate) {
  return String(update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? '');
}

export async function POST(req: NextRequest) {
  if (!verifyTelegramWebhookSecret(req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
  }

  try {
    const update = await req.json() as TelegramUpdate;
    const config = await resolveTelegramConfig();
    const chatId = updateChatId(update);
    const text = update.message?.text?.trim() || '';

    /**
     * Recovery path for a misconfigured chat ID (the confirmed production fault).
     * It must run BEFORE the authorized-chat check, otherwise the admin can never
     * correct a wrong chat ID from Telegram. It is safe because it requires a
     * secret pairing code derived from AUTH_SECRET, the request has already
     * passed Telegram's webhook-secret check, and it only ever binds the chat
     * that proves knowledge of the code. Sent from a human chat, never a bot.
     */
    const pairing = text.match(/^\/id(?:@\w+)?\s+(\d{6})\b/);
    if (pairing && chatId && update.message?.from && !update.message.from.is_bot) {
      const supplied = Buffer.from(pairing[1]);
      const expected = Buffer.from(telegramPairingCode());
      const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!valid) {
        await sendTelegramMessageTo(chatId, 'That pairing code is not valid. Copy the code shown on the InstaDM Auto settings page.').catch(() => undefined);
        return NextResponse.json({ ok: true, ignored: 'bad_pairing_code' });
      }
      if (!isValidTelegramChatId(chatId)) {
        return NextResponse.json({ ok: true, ignored: 'unusable_chat_id' });
      }
      if (config.chatIdSource === 'env') {
        await sendTelegramMessageTo(chatId, [
          `This chat ID is ${chatId}.`,
          '',
          'TELEGRAM_CHAT_ID is set as an environment variable, so it overrides the dashboard and I cannot change it from here.',
          'Set TELEGRAM_CHAT_ID to the value above in your Vercel project settings (or remove it to manage the chat ID from the dashboard), then redeploy.',
        ].join('\n')).catch(() => undefined);
        return NextResponse.json({ ok: true, paired: false, reason: 'env_override' });
      }
      await prisma.user.updateMany({ where: { role: 'ADMIN' }, data: { telegramChatId: chatId } });
      await prisma.auditLog.create({
        data: { action: 'TELEGRAM_CHAT_PAIRED', details: { chatId, via: 'telegram_pairing_command' } },
      }).catch(() => undefined);
      await sendTelegramMessageTo(chatId, [
        '✅ Paired. This chat is now the InstaDM Auto admin chat.',
        `Chat ID: ${chatId}`,
        '',
        'Payment approval alerts will arrive here. Use /pending to list UPI submissions awaiting review.',
      ].join('\n')).catch(() => undefined);
      return NextResponse.json({ ok: true, paired: true });
    }

    if (!config.botToken || !config.chatId || chatId !== config.chatId) {
      if (update.callback_query?.id) {
        await answerTelegramCallback(update.callback_query.id, 'This chat is not authorized.', true).catch(() => undefined);
      }
      return NextResponse.json({ ok: true, ignored: 'unauthorized_chat' });
    }

    const command = text.split(/\s+/)[0].toLowerCase();
    if (command === '/start') {
      await sendTelegramMessage([
        'InstaDM Auto payment approval bot is ready.',
        '',
        'Commands:',
        '/pending — show pending UPI submissions',
        '/id <code> — re-bind the admin chat using the code from Settings',
        '',
        'Always verify the UTR and amount in your bank app before tapping Approve.',
      ].join('\n'));
      return NextResponse.json({ ok: true });
    }

    if (command === '/pending') {
      const payments = await prisma.directUpiPayment.findMany({
        where: { status: 'PENDING_REVIEW' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      if (!payments.length) {
        await sendTelegramMessage('✅ No UPI payments are waiting for review.');
      } else {
        await sendTelegramMessage(`${payments.length} pending payment${payments.length === 1 ? '' : 's'} (showing up to 10):`);
        for (const payment of payments) {
          await sendTelegramMessage(paymentTelegramText(payment), {
            inlineKeyboard: paymentReviewKeyboard(payment.id),
          });
        }
      }
      return NextResponse.json({ ok: true });
    }

    const callback = update.callback_query;
    const match = callback?.data?.match(/^PAY_(APPROVE|REJECT):([0-9a-f-]{36})$/i);
    if (callback && match && callback.message) {
      const decision = match[1].toUpperCase() === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
      const paymentId = match[2];
      const actor = callback.from.username ? `@${callback.from.username}` : String(callback.from.id);
      try {
        const payment = await reviewDirectUpiPayment({
          paymentId,
          decision,
          reviewedBy: `telegram:${callback.from.id}`,
          reviewNote: `${decision === 'VERIFIED' ? 'Approved' : 'Rejected'} from Telegram by ${actor}`,
          source: 'TELEGRAM',
        });
        const resultText = decision === 'VERIFIED'
          ? `✅ APPROVED\n\n${paymentTelegramText(payment)}\n\nReviewed by ${actor}`
          : `❌ REJECTED\n\n${paymentTelegramText(payment)}\n\nReviewed by ${actor}`;
        await answerTelegramCallback(
          callback.id,
          decision === 'VERIFIED' ? 'Plan activated' : 'Payment rejected',
        ).catch(() => undefined);
        await editTelegramMessage(chatId, callback.message.message_id, resultText).catch(async (error) => {
          console.error('Unable to edit Telegram review message:', error);
          await sendTelegramMessage(resultText).catch(() => undefined);
        });
      } catch (error) {
        const message = error instanceof PaymentReviewError ? error.message : 'Review failed';
        await answerTelegramCallback(callback.id, message, true);
      }
      return NextResponse.json({ ok: true });
    }

    if (update.message?.text) {
      await sendTelegramMessage('Unknown command. Use /pending to review UPI payments.');
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook processing failed:', error);
    // Return 200 after signature verification so malformed updates are not retried forever.
    return NextResponse.json({ ok: true, error: 'Update could not be processed' });
  }
}
