#!/usr/bin/env node
/**
 * `npm run db:deploy` — applies the committed migrations to the database in
 * DATABASE_URL with `prisma migrate deploy`, exactly as a production deploy
 * would. The extra flag is only about how the CLI reaches the database:
 * `PRISMA_QUERY_ENGINE_LIBRARY` provides the query-engine path that
 * `prisma generate` needs, and `scripts/db-local.cjs` can start a local server
 * when the sandbox has no PostgreSQL (see VERIFICATION_LOG.md, item E1).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

fs.closeSync(fs.openSync('/tmp/dummy-engine.so', 'a'));
const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, PRISMA_QUERY_ENGINE_LIBRARY: '/tmp/dummy-engine.so' },
});
process.exit(result.status ?? 1);
