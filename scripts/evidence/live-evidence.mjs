#!/usr/bin/env node
/**
 * `node scripts/evidence/live-evidence.mjs`
 *
 * Drives one complete, real scenario against the running application (started
 * by scripts/run-tests.mjs, listening on 127.0.0.1:3100) with the real
 * PostgreSQL database and the local stand-ins for Meta Graph, the Instagram
 * CDN, the Telegram Bot API and SMTP. Every step prints the HTTP response and
 * the resulting database rows, so the output can be pasted as evidence.
 *
 * It writes nothing except the fixtures it creates, and it prints no secrets.
 */
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';

const BASE = process.env.INTEGRATION_BASE_URL || 'http://127.0.0.1:3100';
const GRAPH = process.env.META_GRAPH_BASE_URL || 'http://127.0.0.1:4010';
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const META_APP_SECRET = process.env.META_APP_SECRET || 'meta-secret';
const AUTH_SECRET = process.env.AUTH_SECRET || '0123456789abcdef0123456789abcdef';
const ADMIN_IDENTIFIER = process.env.ADMIN_LOGIN_IDENTIFIER || 'admin@instadm.test';
const ADMIN_PASSWORD = 'AdminPassw0rd!';
const PASSWORD = 'StrongPass123!';
const IG = 'ig-mock-1';

const db = new Client({ connectionString: DATABASE_URL });
const CLIENT_IP = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let cookie = '';

function step(title) {
  console.log(`\n=== ${title}`);
}

function show(label, value) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Origin', BASE);
  // A fresh client address per run, so this script never shares a rate-limit
  // bucket with the integration suites (or with an earlier evidence run).
  headers.set('x-forwarded-for', CLIENT_IP);
  if (cookie) headers.set('Cookie', cookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(new URL(path, BASE), { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const entry of setCookie) {
    const pair = entry.split(';')[0];
    if (pair.startsWith('auth_token=')) cookie = pair;
  }
  let body = null;
  const text = await response.text();
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: response.status, body, headers: response.headers };
}

async function metaWebhook(payload) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', META_APP_SECRET).update(raw, 'utf8').digest('hex')}`;
  return api('/api/webhooks/meta', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: raw });
}

const commentPayload = (commentId, text) => ({
  object: 'instagram',
  entry: [{ id: IG, time: Date.now(), changes: [{ field: 'comments', value: {
    id: commentId, text, media: { id: 'media-1-1' },
    from: { id: 'fan-evidence', username: 'fan.evidence' }, recipient_id: IG,
  } }] }],
});

const postbackPayload = (payload) => ({
  object: 'instagram',
  entry: [{ id: IG, time: Date.now(), messaging: [{
    sender: { id: 'fan-evidence' }, recipient: { id: IG }, timestamp: Date.now(),
    postback: { mid: `mid-${Math.random()}`, payload },
  }] }],
});

const textPayload = (text) => ({
  object: 'instagram',
  entry: [{ id: IG, time: Date.now(), messaging: [{
    sender: { id: 'fan-evidence' }, recipient: { id: IG }, timestamp: Date.now(),
    message: { mid: `mid-${Math.random()}`, text },
  }] }],
});

async function rows(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await db.connect();

  step('0. Reset the test fixtures so every number below is from this run');
  const databaseName = new URL(DATABASE_URL).pathname.slice(1);
  if (!/test/i.test(databaseName)) {
    throw new Error(`Refusing to run: ${databaseName} does not look like a test database (this script clears its tables).`);
  }
  for (const table of ['AuditLog', 'DirectUpiPayment', 'AutomationRun', 'WebhookEvent', 'Contact', 'AutomationContactState', 'Automation', 'Resource', 'Media', 'MetaConnection', 'User']) {
    await db.query(`DELETE FROM "${table}"`);
  }
  for (const log of ['/tmp/maildrop/index.jsonl', '/tmp/graph-mock-requests.jsonl', '/tmp/telegram-mock-requests.jsonl']) {
    writeFileSync(log, '');
  }
  show('row counts after the reset', await rows(`SELECT
    (SELECT count(*)::int FROM "User") AS users,
    (SELECT count(*)::int FROM "MetaConnection") AS connections,
    (SELECT count(*)::int FROM "AuditLog") AS audit_rows`));

  step('1. Register a workspace user (B1: welcome mail)');
  const suffix = Date.now();
  const email = `evidence-${suffix}@example.test`;
  const register = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD, name: 'Evidence User' }) });
  show('POST /api/auth/register', { status: register.status, body: register.body });
  await sleep(500);
  const mails = readFileSync('/tmp/maildrop/index.jsonl', 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const welcome = mails.filter((mail) => mail.to === email).at(-1);
  show('captured welcome mail', welcome && {
    to: welcome.to,
    subject: welcome.subject,
    mentions_free_plan: /Free plan/.test(welcome.body),
    mentions_30_dms: /30 DMs/.test(welcome.body),
  });

  step('2. A1: Meta OAuth callback (code → token → subscribe_apps → initial media sync)');
  const oauthUrl = await api('/api/auth/meta/url');
  show('GET /api/auth/meta/url', { status: oauthUrl.status, host: new URL(oauthUrl.body.url).origin, scope: new URL(oauthUrl.body.url).searchParams.get('scope') });
  const state = new URL(oauthUrl.body.url).searchParams.get('state');
  const callback = await api(`/api/auth/meta/callback?code=GOOD_CODE&state=${encodeURIComponent(state)}`);
  show('GET /api/auth/meta/callback', { status: callback.status, location: callback.headers.get('location') });
  show('MetaConnection row', await rows(
    `SELECT "instagramAccountId", "instagramUsername", "facebookPageId", "connectionStatus",
            left("accessTokenEncrypted", 20) || '…' AS ciphertext_prefix,
            "accessTokenEncrypted" LIKE '%' || $1 || '%' AS contains_plaintext_token
       FROM "MetaConnection"`, ['EAAG-mock-page-access-token-0123456789']));
  show('Media rows', await rows(`SELECT "instagramMediaId", "mediaType" FROM "Media" ORDER BY "instagramMediaId"`));

  const badState = await api('/api/auth/meta/callback?code=GOOD_CODE&state=forged.state.value');
  show('forged state callback', { status: badState.status, location: badState.headers.get('location') });

  step('3. A4: profile picture proxied from the (fake) Instagram CDN over HTTPS');
  const avatar = await api('/api/meta/profile-picture');
  show('GET /api/meta/profile-picture', { status: avatar.status, contentType: avatar.headers.get('content-type'), body: avatar.body });
  const cachedAvatar = await api('/api/meta/profile-picture');
  show('cached row now used', { status: cachedAvatar.status, contentType: cachedAvatar.headers.get('content-type') });

  step('4. A2: admin webhook re-subscribe (POST /api/auth/meta/debug)');
  cookie = '';
  // The admin account is created with the shipped CLI, exactly as a deployment
  // would (npm run admin:create).
  const adminCli = spawnSync('npx', ['tsx', 'scripts/create-admin.ts', '--email', ADMIN_IDENTIFIER, '--password', ADMIN_PASSWORD, '--reset'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: DATABASE_URL },
  });
  show('npm run admin:create', { exit: adminCli.status, stdout: adminCli.stdout.trim().split('\n')[0] });
  const adminLogin = await api('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) });
  show('POST /api/auth/admin-login', { status: adminLogin.status, body: adminLogin.body });
  const resubscribe = await api('/api/auth/meta/debug', { method: 'POST' });
  show('POST /api/auth/meta/debug', resubscribe.body);

  step('5. A8/A9: comment webhook → welcome DM → follow gate → resource delivery');
  cookie = '';
  const userLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) });
  show('POST /api/auth/login', { status: userLogin.status, body: userLogin.body });
  const resource = await api('/api/resources', { method: 'POST', body: JSON.stringify({ name: 'Evidence guide', type: 'URL', url: 'https://example.com/guide' }) });
  show('POST /api/resources', { status: resource.status, body: resource.body });
  const media = await rows(`SELECT "id", "instagramMediaId" FROM "Media" ORDER BY "instagramMediaId" LIMIT 1`);
  const automation = await api('/api/automations', { method: 'POST', body: JSON.stringify({
    name: 'Evidence flow', mediaId: media[0].id, resourceId: resource.body.resource?.id, status: 'ACTIVE',
    keywords: ['evidence'], triggerType: 'KEYWORD', matchingMode: 'EXACT', followGateEnabled: true,
    dmMessageTemplate: 'Hi {{username}}, here is your guide: {{resource_url}}',
    publicReplyEnabled: true, publicReplyTemplates: ['@{{username}} check your DMs!'],
  }) });
  show('POST /api/automations', { status: automation.status, body: automation.body });
  const automationId = automation.body.automation?.id;

  const comment = await metaWebhook(commentPayload('evidence-comment-1', 'evidence'));
  show('POST /api/webhooks/meta (comment)', { status: comment.status, body: comment.body });
  await sleep(1500);
  show('WebhookEvent row', await rows(
    `SELECT "status", "errorDetails" FROM "WebhookEvent" ORDER BY "createdAt" DESC LIMIT 1`));
  show('AutomationRun row', await rows(
    `SELECT "status", "dmStatus", "publicReplyStatus", "dmResponseId", "publicReplyId" FROM "AutomationRun" ORDER BY "createdAt" DESC LIMIT 1`));
  show('AutomationContactState row', await rows(
    `SELECT "status", "followPromptCount" FROM "AutomationContactState" WHERE "automationId" = $1`, [automationId]));
  show('User counters', await rows(
    `SELECT "email", "dmsUsedThisMonth", "totalCommentsReceived" FROM "User" WHERE "email" = $1`, [email]));

  await fetch(`${GRAPH}/v26.0/__control/following?value=false`);
  const gatePostback = await metaWebhook(postbackPayload(`GET_ACCESS_${automationId}`));
  show('POST /api/webhooks/meta (GET_ACCESS postback, not following)', { status: gatePostback.status, body: gatePostback.body });
  await sleep(1200);
  show('AutomationContactState row', await rows(
    `SELECT "status", "followPromptCount" FROM "AutomationContactState" WHERE "automationId" = $1`, [automationId]));
  show('live follow checks', await rows(
    `SELECT "action", "details"->>'following' AS following, "details"->>'source' AS source
       FROM "AuditLog" WHERE "action" = 'FOLLOW_RELATIONSHIP_CHECK' ORDER BY "createdAt"`));

  await fetch(`${GRAPH}/v26.0/__control/following?value=true`);
  const confirm = await metaWebhook(textPayload('done'));
  show('POST /api/webhooks/meta ("done" text, following=true)', { status: confirm.status, body: confirm.body });
  await sleep(1200);
  show('AutomationContactState row', await rows(
    `SELECT "status", "deliveredAt" IS NOT NULL AS delivered FROM "AutomationContactState" WHERE "automationId" = $1`, [automationId]));
  show('Contact row', await rows(
    `SELECT "followGateStatus", "promptSentAt" IS NOT NULL AS prompt_sent_at_set FROM "Contact" WHERE "igsid" = 'fan-evidence'`));
  show('FOLLOW_GATE_VERIFIED audit row', await rows(
    `SELECT "details"->>'method' AS method, "details"->>'igsid' AS igsid FROM "AuditLog" WHERE "action" = 'FOLLOW_GATE_VERIFIED'`));

  const messages = readFileSync('/tmp/graph-mock-requests.jsonl', 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line))
    .filter((call) => call.path === `/v26.0/${IG}/messages`)
    .map((call) => JSON.parse(call.body).message);
  show('DMs the mock Graph API received', messages.map((message) => JSON.stringify(message).slice(0, 110)));
  const replies = readFileSync('/tmp/graph-mock-requests.jsonl', 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line))
    .filter((call) => call.path.endsWith('/replies'))
    .map((call) => JSON.parse(call.body).message);
  show('public replies (template rendered)', replies);

  step('6. C1/C2: Telegram settings and the UPI review notification');
  cookie = '';
  const adminLoginAgain = await api('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) });
  show('POST /api/auth/admin-login', { status: adminLoginAgain.status, body: adminLoginAgain.body });
  const telegramSettings = await api('/api/admin/telegram-settings', { method: 'POST', body: JSON.stringify({
    botToken: '8123456789:AAHtest_token_for_local_bot_api_1234567', chatId: '555123456',
  }) });
  show('POST /api/admin/telegram-settings', {
    status: telegramSettings.status, configured: telegramSettings.body.configured, webhook: telegramSettings.body.webhook,
    webhookMatches: telegramSettings.body.webhookMatches, botUsername: telegramSettings.body.botUsername,
  });
  show('Admin row (token encrypted?)', await rows(
    `SELECT "telegramChatId", left("telegramBotTokenEncrypted", 16) || '…' AS ciphertext_prefix,
            "telegramBotTokenEncrypted" LIKE '%8123456789:AAH%' AS contains_plaintext_token
       FROM "User" WHERE "role" = 'ADMIN'`));
  const setWebhook = readFileSync('/tmp/telegram-mock-requests.jsonl', 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line)).filter((call) => call.method === 'setWebhook').at(-1);
  show('setWebhook the mock Bot API received', { url: setWebhook.body.url, secret_token_is_derived: setWebhook.body.secret_token.length === 64, allowed_updates: setWebhook.body.allowed_updates });

  cookie = '';
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) });
  const utr = `EVID${createHmac('sha256', String(suffix)).digest('hex').slice(0, 16)}`.toUpperCase();
  const submit = await api('/api/payments/direct-upi/submit', { method: 'POST', body: JSON.stringify({
    planType: 'STANDARD', payerName: 'Evidence Payer', payerUpiId: 'evidence@okaxis', utrNumber: utr,
  }) });
  show('POST /api/payments/direct-upi/submit', { status: submit.status, body: submit.body });
  await sleep(800);
  const paymentRow = await rows(`SELECT "id", "planType", "amount", "status" FROM "DirectUpiPayment" WHERE "utrNumber" = $1`, [utr]);
  show('DirectUpiPayment row', paymentRow);
  const reviewMessage = readFileSync('/tmp/telegram-mock-requests.jsonl', 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line))
    .filter((call) => call.method === 'sendMessage' && JSON.stringify(call.body).includes(paymentRow[0].id))
    .at(-1);
  show('Telegram review message', { text: reviewMessage.body.text.split('\n').slice(0, 8), inline_keyboard: reviewMessage.body.reply_markup.inline_keyboard });

  step('7. C3: Telegram webhook approval (derived secret, then replay)');
  const secret = createHmac('sha256', AUTH_SECRET).update('instadm:telegram-webhook:v1').digest('hex');
  const callbackUpdate = {
    update_id: 9001,
    callback_query: {
      id: 'cb-evidence', from: { id: 987654321, username: 'admin_user' },
      message: { message_id: 42, chat: { id: 555123456 } },
      data: `PAY_APPROVE:${paymentRow[0].id}`,
    },
  };
  const badSecret = await fetch(`${BASE}/api/webhooks/telegram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' }, body: JSON.stringify(callbackUpdate) });
  show('wrong secret', { status: badSecret.status, body: await badSecret.text() });
  const approve = await fetch(`${BASE}/api/webhooks/telegram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(callbackUpdate) });
  show('correct secret', { status: approve.status, body: await approve.text() });
  await sleep(1200);
  show('DirectUpiPayment row', await rows(`SELECT "status", "reviewedBy", "reviewNote" FROM "DirectUpiPayment" WHERE "utrNumber" = $1`, [utr]));
  show('User plan after approval', await rows(`SELECT "email", "plan", "monthlyDmQuota", "subscriptionStatus" FROM "User" WHERE "email" = $1`, [email]));
  const replay = await fetch(`${BASE}/api/webhooks/telegram`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ ...callbackUpdate, update_id: 9002 }) });
  show('replayed callback', { status: replay.status, body: await replay.text() });
  await sleep(500);
  show('audit + mail counts after replay', {
    verifiedAuditRows: (await rows(`SELECT count(*)::int AS n FROM "AuditLog" WHERE "action" = 'UPI_PAYMENT_VERIFIED'`))[0].n,
    planActivatedMails: readFileSync('/tmp/maildrop/index.jsonl', 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((mail) => mail.subject === 'Standard plan activated' && mail.to === email).length,
  });

  step('8. B2/B3/B4: payment mails and the password-recovery OTP');
  show('payment mails captured', readFileSync('/tmp/maildrop/index.jsonl', 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line))
    .filter((mail) => ['UPI payment submitted for review', 'Standard plan activated'].includes(mail.subject) && mail.to === email)
    .map((mail) => ({ to: mail.to, subject: mail.subject })));

  const otpRequest = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ action: 'REQUEST_OTP', email }) });
  show('POST /api/auth/forgot (REQUEST_OTP)', { status: otpRequest.status, body: otpRequest.body });
  await sleep(800);
  const otpMail = readFileSync('/tmp/maildrop/index.jsonl', 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line)).filter((mail) => mail.subject === 'InstaDM Auto password reset code' && mail.to === email).at(-1);
  const decodedBody = otpMail.body
    .split(/\r?\n/)
    .filter((line) => !/^--/.test(line.trim()))
    .join('\n')
    .replace(/=\r?\n/g, '');
  const otp = /code is[:\s]*(\d{6})/i.exec(decodedBody)[1];
  show('OTP found only in the mail body', { otp, subject: otpMail.subject });
  show('AuditLog OTP row (hash only)', await rows(
    `SELECT "action", left("details"->>'otpHash', 7) || '…' AS hash_prefix,
            position($1 in "details"::text) = 0 AS plaintext_code_absent
       FROM "AuditLog" WHERE "action" = 'PASSWORD_RESET_OTP' ORDER BY "createdAt" DESC LIMIT 1`, [otp]));
  const wrongOtp = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ action: 'VERIFY_AND_RESET', email, otp: '000000', newPassword: 'RotatedPass456!' }) });
  show('wrong OTP', { status: wrongOtp.status, body: wrongOtp.body });
  const reset = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ action: 'VERIFY_AND_RESET', email, otp, newPassword: 'RotatedPass456!' }) });
  show('correct OTP', { status: reset.status, body: reset.body });
  const reused = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ action: 'VERIFY_AND_RESET', email, otp, newPassword: 'AnotherPass789!' }) });
  show('reused OTP', { status: reused.status, body: reused.body });
  cookie = '';
  const newLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'RotatedPass456!' }) });
  show('login with the new password', { status: newLogin.status, body: newLogin.body });

  step('9. A3: media sync (live) and the code-190 reauthorization path');
  cookie = '';
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'RotatedPass456!' }) });
  const sync = await api('/api/media?sync=true');
  show('GET /api/media?sync=true', { status: sync.status, syncedCount: sync.body.syncedCount, cached: sync.body.cached, reauthorizationRequired: sync.body.reauthorizationRequired });
  await fetch(`${GRAPH}/v26.0/__control/media-error?code=190`);
  const failedSync = await api('/api/media?sync=true');
  show('same call while Graph returns code 190', {
    status: failedSync.status, cached: failedSync.body.cached,
    reauthorizationRequired: failedSync.body.reauthorizationRequired,
    syncError: failedSync.body.syncError, mediaStillServed: failedSync.body.media?.length,
  });
  show('MetaConnection row', await rows(`SELECT "connectionStatus" FROM "MetaConnection"`));
  await fetch(`${GRAPH}/v26.0/__control/media-error`);

  console.log('\nEvidence collection finished.');
}

main()
  .catch((error) => {
    console.error('Evidence run failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => undefined);
  });
