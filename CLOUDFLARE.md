# Deploy on Cloudflare (not Vercel)

Yes: put Meta, database, UPI, and auth secrets in **Cloudflare Workers variables**. Never commit them.

## 1. Database

Use hosted Postgres (Neon or Supabase). Copy the pooled `DATABASE_URL`.

Cloudflare Workers cannot run a local Postgres. Prisma talks to that remote URL.

## 2. Connect GitHub → Cloudflare Workers

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → connect this GitHub repo.
2. Framework preset: **Next.js (OpenNext)**.
3. Build command:

```bash
npm ci && npm run env:check && npm run db:deploy && npm run cf:build
```

4. Deploy command (if asked): `npx wrangler deploy`
5. Root directory: repo root.

Or from your laptop after `npx wrangler login`:

```bash
npm ci
npm run env:check
npm run db:deploy
npm run cf:deploy
```

Never use `prisma db push` in production; `db:deploy` applies the checked-in migration history.


## Local verification of the built worker

```bash
npm run cf:build
npx wrangler@latest dev --local --ip 127.0.0.1 --port 8787
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/login         # 200
curl -s http://127.0.0.1:8787/api/health                                      # {"status":"ok","database":"reachable"}
```

`/login`, static assets and every route (including the CSRF proxy) work in local
mode. `/api/health` needs database round-trips, so it only reports `ok` where
`workerd` is allowed to generate Wasm — Prisma's client engine is a Wasm module.
A sandbox whose `workerd` refuses Wasm code generation
(`WebAssembly.Module(): Wasm code generation disallowed by embedder`, which
reproduces with an empty 8-byte module) will answer
`{"status":"degraded","database":"unreachable"}`; the same build answers `ok` on
a real Worker. Verify the deployed worker with:

```bash
curl -s https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/api/health
```

## 3. Variables — add TWICE

Cloudflare has **Build** variables and **Runtime / Worker** secrets. Add the same keys to both.

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Neon/Supabase Postgres URL |
| `APP_URL` | `https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev` or custom domain |
| `AUTH_SECRET` | 32+ random chars |
| `ENCRYPTION_KEY` | 64 hex chars |
| `CRON_SECRET` | random, for the retry job |
| `SETUP_TOKEN` | one-time admin bootstrap |
| `ADMIN_LOGIN_IDENTIFIER` | normalized identifier of the existing `ADMIN` account; server-only |
| `META_APP_ID` | Meta app id |
| `META_APP_SECRET` | Meta app secret |
| `META_VERIFY_TOKEN` | webhook verify token |
| `META_GRAPH_API_VERSION` | `v21.0` |
| `META_REDIRECT_URI` | `https://YOUR_DOMAIN/api/auth/meta/callback` |
| `UPI_ID` | `name@okaxis` |
| `UPI_PAYEE_NAME` | legal name on UPI |
| `UPI_NOTE` | optional |
| `TELEGRAM_BOT_TOKEN` | optional BotFather secret for payment approvals |
| `TELEGRAM_CHAT_ID` | optional numeric admin chat ID |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | optional transactional email (configure all five) |

Never add `TELEGRAM_WEBHOOK_SECRET`; the app derives it from `AUTH_SECRET`.

Encrypt secrets (the lock icon). Set `ADMIN_LOGIN_IDENTIFIER` to the normalized identifier of the existing database user with role `ADMIN` in the server environment only; never use a `NEXT_PUBLIC_` prefix or commit the production value. Do **not** paste credentials or secrets into the repo.

`APP_URL` must be HTTPS. After the first deploy, set it to the live hostname and redeploy.

## 4. Meta app

Same URLs as production:

- OAuth redirect: `https://YOUR_DOMAIN/api/auth/meta/callback`
- Webhook: `https://YOUR_DOMAIN/api/webhooks/meta`
- Verify token = `META_VERIFY_TOKEN`
- Fields: `comments`, `messages`, `messaging_postbacks`

## 5. Cron (retry + quota reset)

Cloudflare cron on OpenNext is not always wired. Use any HTTP cron (cron-job.org, or a tiny Cloudflare Cron Trigger Worker) every 5 minutes:

```
GET https://YOUR_DOMAIN/api/jobs/process-webhooks
Authorization: Bearer CRON_SECRET
```

## 6. First login

For an existing database, configure `ADMIN_LOGIN_IDENTIFIER` to the existing account whose database role is `ADMIN`, then sign in at `/admin/login`. Do not use `/setup`, `admin:create`, a seed, or a migration to change an existing account's identifier, role, or password. `/setup` is only for bootstrapping an intentionally empty/new database; rotate or remove `SETUP_TOKEN` immediately afterward.

## Prisma note

The project uses Prisma 6's Rust-free client with `@prisma/adapter-pg`, plus `pg-cloudflare` for the Worker bundle. Use a Postgres provider that permits Cloudflare Worker TCP connections (a pooled Neon/Supabase URL is recommended), keep `nodejs_compat`, and retain the `pg-cloudflare` output-file tracing rule in `next.config.js`. Do not use Cloudflare D1 unless the database layer is intentionally migrated away from Postgres.
