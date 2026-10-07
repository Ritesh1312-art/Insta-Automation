#!/usr/bin/env node
/**
 * Test entry point.
 *
 *   npm test                  # unit + integration, everything green
 *   npm run test:integration  # integration suites only
 *   npm run test:unit         # vitest alone (no provisioning, integration suites skip)
 *
 * The integration suites need a real environment, which this script builds:
 *
 *   1. a REAL PostgreSQL server (scripts/db-local.cjs, embedded-postgres) with
 *      the migrations applied through `prisma migrate deploy`;
 *   2. local stand-ins for Meta Graph, the Instagram CDN, the Telegram Bot API
 *      and SMTP (scripts/mocks/*.cjs);
 *   3. a built `next start` server on 127.0.0.1:3100 with META_GRAPH_BASE_URL,
 *      TELEGRAM_API_BASE_URL and SMTP_* pointed at those stand-ins;
 *   4. NODE_EXTRA_CA_CERTS for the fake CDN's certificate. Node reads that only
 *      once at TLS initialisation, so it is passed to the child processes.
 *
 * Everything is provisioned on demand, so `npm test` works from a clean clone.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PG_PORT = Number(process.env.PGLOCAL_PORT || 55432);
const PG_USER = process.env.PGLOCAL_USER || 'insta';
const PG_PASSWORD = process.env.PGLOCAL_PASSWORD || 'insta';
const PG_DB = process.env.PGLOCAL_TEST_DB || 'insta_test';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}?schema=public`;

const GRAPH_PORT = Number(process.env.MOCK_GRAPH_PORT || 4010);
const TELEGRAM_PORT = Number(process.env.MOCK_TELEGRAM_PORT || 4020);
const SMTP_PORT = Number(process.env.MOCK_SMTP_PORT || 2525);
const CDN_PORT = Number(process.env.MOCK_CDN_PORT || 4443);
const CDN_HOST = process.env.MOCK_CDN_HOST || 'scontent-xx-1.cdninstagram.com';
const CDN_DIR = process.env.MOCK_CDN_DIR || '/tmp/cdn-mock';
const CDN_BASE_URL = `https://${CDN_HOST}:${CDN_PORT}`;
const APP_PORT = Number(process.env.INTEGRATION_PORT || 3100);
const BASE_URL_LABEL = `http://127.0.0.1:${APP_PORT}`;

// APP_URL must be an HTTPS origin (the app refuses to register a Telegram
// webhook or build a Meta redirect URI otherwise), so the app is told it lives
// at https://instadm.test while the tests connect to it over plain HTTP on the
// loopback address. Nothing in these suites calls back into APP_URL.
const APP_URL = process.env.APP_URL || 'https://instadm.test';
const ADMIN_IDENTIFIER = 'admin@instadm.test';

/** Newest mtime across the files a build depends on; used to detect a stale build. */
function newestSourceMtime() {
  let newest = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  for (const target of ['src', 'prisma', 'public']) walk(path.join(root, target));
  for (const file of ['next.config.js', 'package.json', 'tsconfig.json', 'postcss.config.js', 'tailwind.config.js']) {
    newest = Math.max(newest, fs.statSync(path.join(root, file)).mtimeMs);
  }
  return String(newest);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(' ')} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForPort(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Nothing started listening on 127.0.0.1:${port}`);
}

/**
 * A helper left over from an earlier run would serve stale code or stale
 * environment, so each long-lived process is stamped with a fingerprint of what
 * started it. A mismatching stamp means "kill it and start the current one".
 */
function stampPath(port) {
  return path.join(os.tmpdir(), `insta-harness-${port}.stamp`);
}

function readStamp(port) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stampPath(port), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function pidListeningOn(port) {
  try {
    const output = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' }).stdout || '';
    // The sandbox publishes each port on a second address without a process
    // entry, so scan every matching line and take the first one that names a pid.
    for (const line of output.split('\n')) {
      if (!new RegExp(`:${port}\\s`).test(line)) continue;
      const match = /pid=(\d+)/.exec(line);
      if (match) return Number(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

/** Stops whatever is listening on `port` (unless it belongs to another user's process). */
async function stopPort(port) {
  const pid = pidListeningOn(port);
  if (!pid) return false;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && await portIsOpen(port)) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (await portIsOpen(port)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return true;
}

/** Starts `script` on `port`, restarting it when its fingerprint changed. */
async function ensureHelper({ name, script, args, port, fingerprint, logFile, env }) {
  const stamp = readStamp(port);
  if (await portIsOpen(port)) {
    // Only reuse the listener when the recorded owner is still the one holding
    // the port AND its fingerprint still matches; anything else is replaced.
    const listeningPid = pidListeningOn(port);
    if (stamp && stamp.fingerprint === fingerprint && listeningPid && stamp.pid === listeningPid) {
      return `${name} already running (up to date)`;
    }
    await stopPort(port);
  }
  fs.mkdirSync(path.join(root, '.test-logs'), { recursive: true });
  const log = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: env || process.env,
  });
  child.unref();
  await waitForPort(port);
  fs.writeFileSync(stampPath(port), JSON.stringify({ fingerprint, pid: child.pid, startedAt: new Date().toISOString() }));
  return `${name} started (pid ${child.pid})`;
}

function appEnvironment() {
  return {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: TEST_DATABASE_URL,
    APP_URL,
    // These four must match the values vitest.config.mts hands to the test
    // process: the tests decrypt what the server encrypted and verify the
    // signatures the server checks.
    AUTH_SECRET: '0123456789abcdef0123456789abcdef',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    META_APP_SECRET: 'meta-secret',
    META_VERIFY_TOKEN: 'verify-token',
    CRON_SECRET: 'integration-cron-secret-0123456789',
    SETUP_TOKEN: 'integration-setup-token-0123456789',
    ADMIN_LOGIN_IDENTIFIER: ADMIN_IDENTIFIER,
    META_APP_ID: '1234567890',
    META_GRAPH_API_VERSION: 'v26.0',
    META_GRAPH_BASE_URL: `http://127.0.0.1:${GRAPH_PORT}`,
    META_REDIRECT_URI: `${APP_URL}/api/auth/meta/callback`,
    MOCK_CDN_URL: `https://${CDN_HOST}:${CDN_PORT}`,
    TELEGRAM_API_BASE_URL: `http://127.0.0.1:${TELEGRAM_PORT}`,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(SMTP_PORT),
    SMTP_USER: 'insta',
    SMTP_PASSWORD: 'insta',
    SMTP_FROM: 'InstaDM Auto <no-reply@instadm.test>',
    NODE_EXTRA_CA_CERTS: path.join(CDN_DIR, 'cert.pem'),
  };
}

async function main() {
  const onlyIntegration = process.argv.includes('--integration');

  console.log('[1/6] starting PostgreSQL');
  run(process.execPath, ['scripts/db-local.cjs', 'start'], {
    env: { ...process.env, PGLOCAL_DB: PG_DB },
  });

  console.log('[2/6] generating the Prisma client');
  fs.closeSync(fs.openSync('/tmp/dummy-engine.so', 'a'));
  run('npx', ['prisma', 'generate'], {
    env: { ...process.env, PRISMA_QUERY_ENGINE_LIBRARY: '/tmp/dummy-engine.so' },
  });

  console.log('[3/6] applying migrations to the test database');
  run('npx', ['prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      PRISMA_QUERY_ENGINE_LIBRARY: '/tmp/dummy-engine.so',
    },
  });

  console.log('[4/6] starting local stand-ins for third-party services');
  const mocks = [
    { name: 'graph   ', script: 'scripts/mocks/graph-mock.cjs', args: [String(GRAPH_PORT)], port: GRAPH_PORT },
    { name: 'telegram', script: 'scripts/mocks/telegram-mock.cjs', args: [String(TELEGRAM_PORT)], port: TELEGRAM_PORT },
    { name: 'smtp    ', script: 'scripts/mocks/smtp-mock.cjs', args: [String(SMTP_PORT)], port: SMTP_PORT },
    { name: 'cdn     ', script: 'scripts/mocks/cdn-mock.cjs', args: [String(CDN_PORT)], port: CDN_PORT },
  ];
  for (const mock of mocks) {
    const mockEnv = { ...process.env, MOCK_CDN_URL: CDN_BASE_URL };
    const fingerprint = `${mock.script}:${fs.statSync(path.join(root, mock.script)).mtimeMs}:${JSON.stringify({ MOCK_CDN_URL: CDN_BASE_URL })}`;
    const status = await ensureHelper({
      ...mock,
      fingerprint,
      logFile: path.join(root, '.test-logs', `${path.basename(mock.script, '.cjs')}.log`),
      // The Graph mock advertises CDN URLs, so it has to know where the fake
      // CDN lives (otherwise it hands out an unreachable http://127.0.0.1 URL).
      env: mockEnv,
    });
    console.log(`  ${mock.name} ${status}`);
  }

  const appEnv = appEnvironment();
  const env = { ...appEnv, TEST_DATABASE_URL, INTEGRATION_BASE_URL: BASE_URL_LABEL, APP_URL };

  console.log('[5/6] building and starting the application (next start)');
  const buildStamp = path.join(root, '.test-logs', 'build.stamp');
  const sourceFingerprint = newestSourceMtime();
  const built = fs.existsSync(path.join(root, '.next', 'BUILD_ID'))
    ? (fs.existsSync(buildStamp) ? fs.readFileSync(buildStamp, 'utf8').trim() : '')
    : 'missing';
  if (!process.env.SKIP_BUILD && built !== sourceFingerprint) {
    run('npx', ['next', 'build'], { env: appEnv });
    fs.writeFileSync(buildStamp, sourceFingerprint);
  } else if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
    run('npx', ['next', 'build'], { env: appEnv });
    fs.writeFileSync(buildStamp, sourceFingerprint);
  }
  // The stamp covers the build and every environment value the server reads, so
  // a running server is only reused when it is running the same code and config.
  const fingerprint = `next:${fs.readFileSync(path.join(root, '.next', 'BUILD_ID'), 'utf8').trim()}:${JSON.stringify(appEnv)}`;
  const status = await ensureHelper({
    name: 'application',
    script: path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
    args: ['start', '-H', '127.0.0.1', '-p', String(APP_PORT)],
    port: APP_PORT,
    fingerprint,
    logFile: path.join(root, '.test-logs', 'next-start.log'),
    env: appEnv,
  });
  console.log(`  ${status} -> ${BASE_URL_LABEL}`);

  console.log('[6/6] running vitest');
  const args = ['vitest', 'run', '--no-file-parallelism'];
  if (onlyIntegration) {
    args.push('src/integration', 'src/services/automation/automation-pipeline.integration.test.ts');
  }
  const result = spawnSync('npx', args, { cwd: root, stdio: 'inherit', env });
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
