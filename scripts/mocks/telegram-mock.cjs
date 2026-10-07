#!/usr/bin/env node
/**
 * Local stand-in for the Telegram Bot API (https://api.telegram.org).
 *
 *   node scripts/mocks/telegram-mock.cjs [port]   # default 4020
 *
 * Implemented methods: getMe, setWebhook, getWebhookInfo, deleteWebhook,
 * sendMessage, editMessageText, answerCallbackQuery.
 * Every call is appended to /tmp/telegram-mock-requests.jsonl so tests can
 * assert the exact payload (including the inline-keyboard callback_data and
 * the webhook secret_token) the application sent.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.argv[2] || process.env.MOCK_TELEGRAM_PORT || 4020);
const LOG = process.env.MOCK_TELEGRAM_LOG || '/tmp/telegram-mock-requests.jsonl';
const BOT_ID = Number(process.env.MOCK_BOT_ID || 8123456789);

const state = { webhook: null, messages: [], callbacks: [] };

function log(entry) {
  fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

function json(response, body, status = 200) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const body = await readBody(request);
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch { /* ignore */ }
  const method = url.pathname.split('/').filter(Boolean).pop();

  log({ method, path: url.pathname, body: payload });

  switch (method) {
    case 'getMe':
      return json(response, {
        ok: true,
        result: { id: BOT_ID, is_bot: true, first_name: 'InstaDM Mock', username: 'instdm_mock_bot' },
      });
    case 'setWebhook':
      state.webhook = { url: payload.url, secret_token: payload.secret_token, allowed_updates: payload.allowed_updates };
      return json(response, { ok: true, result: true, description: 'Webhook was set' });
    case 'getWebhookInfo':
      return json(response, {
        ok: true,
        result: state.webhook
          ? { url: state.webhook.url, has_custom_certificate: false, pending_update_count: 0 }
          : { url: '', has_custom_certificate: false, pending_update_count: 0 },
      });
    case 'deleteWebhook':
      state.webhook = null;
      return json(response, { ok: true, result: true });
    case 'sendMessage':
      state.messages.push(payload);
      return json(response, {
        ok: true,
        result: {
          message_id: state.messages.length,
          chat: { id: payload.chat_id },
          text: payload.text,
          ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
        },
      });
    case 'editMessageText':
      return json(response, { ok: true, result: { message_id: payload.message_id, text: payload.text } });
    case 'answerCallbackQuery':
      state.callbacks.push(payload);
      return json(response, { ok: true, result: true });
    case '__state':
      return json(response, state);
    case '__reset':
      state.webhook = null;
      state.messages = [];
      state.callbacks = [];
      return json(response, { ok: true });
    default:
      return json(response, { ok: false, description: `Unsupported method ${method}` });
  }
});

fs.mkdirSync(path.dirname(LOG), { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`telegram-mock listening on http://127.0.0.1:${PORT} (log ${LOG})`);
});
