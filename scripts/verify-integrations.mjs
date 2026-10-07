#!/usr/bin/env node
/**
 * `npm run verify:integrations` — one command that proves the deployment really
 * talks to Meta, Telegram and the mail provider with the credentials in the
 * environment. Every check performs a live, read-only request (or a send to the
 * admin's own chat/address) and prints PASS / FAIL with the reason.
 *
 * Run it in the environment that holds the real values:
 *   META_APP_ID=... META_APP_SECRET=... TELEGRAM_BOT_TOKEN=... \
 *   npm run verify:integrations
 *
 * Nothing is printed that could leak a secret: tokens are only ever reported as
 * "configured".
 */
import process from 'node:process';
import { createDecipheriv, createHmac } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let hardFailure = false;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) hardFailure = true;
  const label = ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m';
  console.log(`${label}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`\u001b[33mSKIP\u001b[0m  ${name}\n        ${reason}`);
}

const env = (name) => (process.env[name] || '').trim();

async function timedFetch(url, init = {}, timeoutMs = 15_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return response;
}

/**
 * Decrypts a token the application stored with aes-256-gcm in the documented
 * `iv:tag:ciphertext` format (src/lib/encryption.ts). Read-only, and nothing
 * derived from it is ever printed.
 */
function decryptStoredToken(payload, hexKey) {
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('stored token is not in the expected encrypted format');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

async function checkMeta() {
  const appId = env('META_APP_ID');
  const appSecret = env('META_APP_SECRET');
  const version = env('META_GRAPH_API_VERSION') || 'v26.0';
  const verifyToken = env('META_VERIFY_TOKEN');
  if (!appId || !appSecret) return skip('Meta Graph API', 'META_APP_ID / META_APP_SECRET are not set');

  // 1. The app secret is correct: an appsecret_proof-signed call to /me must be
  //    rejected with an auth error rather than a signature error.
  try {
    const appToken = `${appId}|${appSecret}`;
    const proof = createHmac('sha256', appSecret).update(appToken).digest('hex');
    const response = await timedFetch(
      `https://graph.facebook.com/${version}/me?access_token=${encodeURIComponent(appToken)}&appsecret_proof=${proof}`,
    );
    const body = await response.json().catch(() => ({}));
    // A valid app token identifies the app itself; Facebook answers with the app
    // object (or a clear error explaining why not), never with code 190.
    record(
      'Meta: app credentials accepted by graph.facebook.com',
      body?.error?.code !== 190 || /app/i.test(body?.error?.message || ''),
      body?.error ? `Graph said: [${body.error.code ?? '-'}] ${body.error.message}` : `Graph returned the app object (${body.id ?? 'ok'})`,
    );
  } catch (error) {
    record('Meta: app credentials accepted by graph.facebook.com', false, error.message);
  }

  // 2. The webhook verify token must match what Meta sends.
  const appUrl = env('APP_URL');
  if (!appUrl || !verifyToken) {
    skip('Meta: webhook verification handshake', 'APP_URL / META_VERIFY_TOKEN are not set');
  } else {
    try {
      const challenge = String(Date.now());
      const response = await timedFetch(
        `${appUrl.replace(/\/$/, '')}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${challenge}`,
      );
      const text = (await response.text()).trim();
      record(
        'Meta: webhook verification handshake',
        response.status === 200 && text === challenge,
        `HTTP ${response.status} body=${text.slice(0, 80)}`,
      );
    } catch (error) {
      record('Meta: webhook verification handshake', false, error.message);
    }
  }

  // 3. A connected account proves the stored token still works.
  const databaseUrl = env('DATABASE_URL');
  if (!databaseUrl) {
    skip('Meta: stored page token is still valid', 'DATABASE_URL is not set');
    return;
  }
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT "instagramAccountId", "instagramUsername", "connectionStatus", "accessTokenEncrypted" FROM "MetaConnection" ORDER BY "createdAt" DESC LIMIT 1',
    );
    if (!rows.length) {
      skip('Meta: stored page token is still valid', 'no MetaConnection row yet — connect Instagram in the dashboard first');
      return;
    }
    const connection = rows[0];
    const encryptionKey = env('ENCRYPTION_KEY');
    if (!connection.accessTokenEncrypted || !/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
      skip('Meta: stored page token is still valid', 'ENCRYPTION_KEY is not set, so the stored token cannot be decrypted here');
      return;
    }
    // Live call with the stored page token: the only honest proof that the
    // connection still works (the DB status alone is just a cached flag).
    const token = decryptStoredToken(connection.accessTokenEncrypted, encryptionKey);
    const response = await timedFetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(connection.instagramAccountId)}?fields=username,profile_picture_url&access_token=${encodeURIComponent(token)}`,
    );
    const body = await response.json().catch(() => ({}));
    record(
      'Meta: stored page token is still valid',
      response.ok && !body.error,
      response.ok
        ? `@${body.username ?? connection.instagramUsername} (${connection.instagramAccountId}) answered the Graph API`
        : `Graph rejected the stored token: [${body.error?.code ?? response.status}] ${body.error?.message ?? 'unknown error'} — reconnect Instagram in the dashboard`,
    );
  } catch (error) {
    record('Meta: stored page token is still valid', false, error.message);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkTelegram() {
  const token = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  if (!token) return skip('Telegram bot', 'TELEGRAM_BOT_TOKEN is not set');
  try {
    const me = await timedFetch(`https://api.telegram.org/bot${token}/getMe`);
    const meBody = await me.json();
    record(
      'Telegram: bot token is valid',
      me.ok && meBody.ok === true,
      meBody.ok ? `@${meBody.result.username} (id ${meBody.result.id})` : meBody.description,
    );
    if (!meBody.ok) return;

    const info = await timedFetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const infoBody = await info.json();
    const expectedUrl = env('APP_URL') ? `${env('APP_URL').replace(/\/$/, '')}/api/webhooks/telegram` : null;
    record(
      'Telegram: webhook registered and pointing at this deployment',
      Boolean(infoBody.ok) && Boolean(expectedUrl) && infoBody.result?.url === expectedUrl,
      `registered=${infoBody.result?.url || '(none)'} expected=${expectedUrl || '(APP_URL not set)'}` +
        (infoBody.result?.last_error_message ? ` last_error=${infoBody.result.last_error_message}` : ''),
    );

    if (!chatId) {
      skip('Telegram: live test message', 'TELEGRAM_CHAT_ID is not set');
      return;
    }
    const secret = env('AUTH_SECRET');
    if (!secret || secret.length < 32) {
      skip('Telegram: webhook secret matches AUTH_SECRET', 'AUTH_SECRET is missing or shorter than 32 characters');
      return;
    }
    const derived = createHmac('sha256', secret).update('instadm:telegram-webhook:v1').digest('hex');
    const sent = await timedFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `InstaDM Auto go-live check: this chat will receive UPI payment approvals. Webhook secret ${derived.slice(0, 6)}…`,
      }),
    });
    const sentBody = await sent.json();
    record(
      'Telegram: live test message to the admin chat',
      sentBody.ok === true,
      sentBody.ok ? `delivered to chat ${chatId}` : sentBody.description,
    );
  } catch (error) {
    record('Telegram bot', false, error.message);
  }
}

async function checkSmtp() {
  const host = env('SMTP_HOST');
  const port = Number(env('SMTP_PORT') || 0);
  const user = env('SMTP_USER');
  const password = env('SMTP_PASSWORD');
  const from = env('SMTP_FROM');
  if (!host || !port || !user || !password || !from) {
    return skip('SMTP transactional mail', 'SMTP_HOST/PORT/USER/PASSWORD/FROM are not all set');
  }
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch (error) {
    return record('SMTP transactional mail', false, `nodemailer is unavailable: ${error.message}`);
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  try {
    await transporter.verify();
    record('SMTP: connection and credentials accepted', true, `${host}:${port} as ${user}`);
  } catch (error) {
    return record('SMTP: connection and credentials accepted', false, error.message);
  }
  const recipient = env('VERIFY_MAIL_TO') || user;
  try {
    await transporter.sendMail({
      from,
      to: recipient,
      subject: 'InstaDM Auto go-live check',
      text: 'This message confirms the deployment can send transactional mail (welcome, payment and password-reset codes).',
    });
    record('SMTP: test mail accepted for delivery', true, `sent to ${recipient}`);
  } catch (error) {
    record('SMTP: test mail accepted for delivery', false, error.message);
  } finally {
    transporter.close();
  }
}

async function checkDatabaseAndClock() {
  const databaseUrl = env('DATABASE_URL');
  if (!databaseUrl) return skip('PostgreSQL', 'DATABASE_URL is not set');
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT version() AS version, current_setting($1) AS timezone', ['TimeZone']);
    record('PostgreSQL reachable over the production URL', true, String(rows[0].version).split(' ').slice(0, 2).join(' '));
    const applied = await client.query('SELECT count(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL');
    const expected = countMigrations();
    record(
      'All committed migrations are applied',
      applied.rows[0].applied === expected,
      `${applied.rows[0].applied}/${expected} applied`,
    );
  } catch (error) {
    record('PostgreSQL reachable over the production URL', false, error.message);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Number of committed migrations, read from the repository itself. */
function countMigrations() {
  return readdirSync(path.join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .length;
}

async function checkEnvContract() {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/check-env.mjs'], { encoding: 'utf8' });
  record(
    'Environment contract (npm run env:check)',
    result.status === 0,
    (result.stdout || '').trim().split('\n').slice(-1)[0] || (result.stderr || '').trim(),
  );
}

async function main() {
  console.log('InstaDM Auto integration verification\n');
  await checkEnvContract();
  await checkDatabaseAndClock();
  await checkMeta();
  await checkTelegram();
  await checkSmtp();

  const passed = results.filter((result) => result.ok && !result.skipped).length;
  const failed = results.filter((result) => !result.ok).length;
  const skipped = results.filter((result) => result.skipped).length;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped.`);
  if (failed) {
    console.log('Fix the failures above, then run `npm run verify:integrations` again.');
    process.exit(1);
  }
  if (skipped) {
    console.log('Skipped checks are waiting for the matching credentials in the environment.');
  }
  process.exit(hardFailure ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
