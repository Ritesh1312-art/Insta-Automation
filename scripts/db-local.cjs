#!/usr/bin/env node
/**
 * Provisions a REAL PostgreSQL server inside the sandbox using the prebuilt
 * binaries shipped by `embedded-postgres` (@embedded-postgres/linux-x64).
 *
 *   node scripts/db-local.cjs start   # start (and initdb on first run)
 *   node scripts/db-local.cjs stop
 *   node scripts/db-local.cjs status
 *
 * Environment:
 *   PGLOCAL_DIR   data directory      (default /tmp/insta-pgdata)
 *   PGLOCAL_PORT  TCP port            (default 55432)
 *   PGLOCAL_USER  superuser role      (default insta)
 *   PGLOCAL_PASSWORD                  (default insta)
 *   PGLOCAL_DB    database to create  (default insta_local)
 *
 * This exists because the sandbox has no system PostgreSQL. `prisma migrate
 * deploy` is then run unmodified against this server — see VERIFICATION_LOG.md.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const DIR = process.env.PGLOCAL_DIR || '/tmp/insta-pgdata';
const PORT = Number(process.env.PGLOCAL_PORT || 55432);
const USER = process.env.PGLOCAL_USER || 'insta';
const PASSWORD = process.env.PGLOCAL_PASSWORD || 'insta';
const DB = process.env.PGLOCAL_DB || 'insta_local';

function binDir() {
  // The prebuilt binaries live in the platform package, not in the wrapper.
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'bin'),
    path.join(__dirname, '..', 'node_modules', 'embedded-postgres', 'native', 'bin'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'postgres'))) return candidate;
  }
  throw new Error(`Cannot locate embedded PostgreSQL binaries. Looked in:\n  ${candidates.join('\n  ')}`);
}

function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`PostgreSQL did not start listening on ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/** The platform package ships only postgres/pg_ctl/initdb, so drive SQL over pg. */
async function psql(database, sql) {
  const { Client } = require('pg');
  const client = new Client({ host: '127.0.0.1', port: PORT, user: USER, password: PASSWORD, database });
  await client.connect();
  try {
    const result = await client.query(sql);
    return result.rows.length ? String(result.rows[0][result.fields[0].name]) : '';
  } finally {
    await client.end();
  }
}

function portIsOpen(port, timeoutMs = 1_500) {
  return waitForPort(port, timeoutMs).then(() => true, () => false);
}

async function start() {
  const bin = binDir();
  if (await portIsOpen(PORT)) {
    console.log(`postgres: already listening on 127.0.0.1:${PORT}`);
  } else {
    await launch(bin);
  }

  const exists = await psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${DB}'`);
  if (exists !== '1') {
    await psql('postgres', `CREATE DATABASE "${DB}"`);
    console.log(`postgres: created database ${DB}`);
  }
  console.log(`DATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=public`);
}

async function launch(bin) {
  if (!fs.existsSync(path.join(DIR, 'PG_VERSION'))) {
    const pwFile = path.join(require('node:os').tmpdir(), `insta-initdb-${process.pid}.pw`);
    fs.writeFileSync(pwFile, `${PASSWORD}\n`, { mode: 0o600 });
    const initdb = spawnSync(path.join(bin, 'initdb'), ['-D', DIR, '-U', USER, `--pwfile=${pwFile}`, '-E', 'UTF8'], {
      encoding: 'utf8',
    });
    fs.rmSync(pwFile, { force: true });
    if (initdb.status !== 0) throw new Error(initdb.stderr || 'initdb failed');
    console.log(`initdb: created cluster at ${DIR}`);
  }

  const log = fs.openSync(path.join(DIR, 'server.log'), 'a');
  const child = spawn(path.join(bin, 'postgres'), ['-D', DIR, '-p', String(PORT), '-h', '127.0.0.1', '-k', '/tmp'], {
    stdio: ['ignore', log, log],
    detached: true,
    env: { ...process.env, PGPASSWORD: PASSWORD },
  });
  child.unref();
  fs.writeFileSync(path.join(DIR, 'postgres.pid'), String(child.pid));

  await waitForPort(PORT);
  console.log(`postgres: listening on 127.0.0.1:${PORT} (pid ${child.pid})`);
}

function stop() {
  const bin = binDir();
  const result = spawnSync(path.join(bin, 'pg_ctl'), ['-D', DIR, '-m', 'fast', 'stop'], { encoding: 'utf8' });
  if (result.status !== 0) console.error(result.stderr || 'pg_ctl stop failed (is it running?)');
  else console.log('postgres: stopped');
}

const command = process.argv[2] || 'start';
if (command === 'start') {
  start().catch((error) => { console.error(error.message || error); process.exit(1); });
} else if (command === 'stop') {
  stop();
} else if (command === 'status') {
  waitForPort(PORT, 2_000)
    .then(() => console.log(`127.0.0.1:${PORT} - accepting connections`))
    .catch(() => { console.log(`127.0.0.1:${PORT} - no server`); process.exit(1); });
} else {
  console.error('Usage: node scripts/db-local.cjs <start|stop|status>');
  process.exit(1);
}
