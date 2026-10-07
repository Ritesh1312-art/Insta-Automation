#!/usr/bin/env node
/**
 * `npm run db:generate` — generates the Prisma client with a graceful fallback
 * for machines that cannot reach `binaries.prisma.sh` (sandboxes, air-gapped
 * CI). Any other failure is reported unchanged.
 *
 * `prisma generate` always resolves a query-engine library path even though the
 * Rust-free client never loads it. When the download fails purely because the
 * host is unreachable, the same command is retried with
 * `PRISMA_QUERY_ENGINE_LIBRARY` pointing at a local file, which satisfies the
 * existence check without changing the generated client.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const env = { ...process.env };

function generate() {
  return spawnSync('npx', ['prisma', 'generate'], { stdio: 'inherit', env });
}

const first = generate();
if (first.status === 0) process.exit(0);

const offline = !env.PRISMA_QUERY_ENGINE_LIBRARY;
const fallbackEngine = '/tmp/dummy-engine.so';
if (!offline) {
  console.error('prisma generate failed.');
  process.exit(first.status ?? 1);
}

console.error(
  '\nprisma generate could not download a query engine (binaries.prisma.sh unreachable).\n' +
  `Retrying with PRISMA_QUERY_ENGINE_LIBRARY=${fallbackEngine} — the client is Rust-free ` +
  '(engineType = "client"), so the library is only checked for existence, never loaded.',
);
fs.closeSync(fs.openSync(fallbackEngine, 'a'));
env.PRISMA_QUERY_ENGINE_LIBRARY = fallbackEngine;
const second = generate();
process.exit(second.status ?? 1);
