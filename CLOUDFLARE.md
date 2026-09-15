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
npx prisma generate && npx prisma db push && npx @opennextjs/cloudflare build
```

4. Deploy command (if asked): `npx wrangler deploy`
5. Root directory: repo root.

Or from your laptop after `npx wrangler login`:

```bash
npx prisma generate
npx prisma db push
npx @opennextjs/cloudflare build
npx wrangler deploy
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
| `META_APP_ID` | Meta app id |
| `META_APP_SECRET` | Meta app secret |
| `META_VERIFY_TOKEN` | webhook verify token |
| `META_GRAPH_API_VERSION` | `v21.0` |
| `META_REDIRECT_URI` | `https://YOUR_DOMAIN/api/auth/meta/callback` |
| `UPI_ID` | `name@okaxis` |
| `UPI_PAYEE_NAME` | legal name on UPI |
| `UPI_NOTE` | optional |

Encrypt secrets (the lock icon). Do **not** paste keys into the repo.

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

Open `/setup` once with `SETUP_TOKEN`, create the admin, then rotate/delete `SETUP_TOKEN`.

## Prisma note

If the Worker fails to load the Prisma engine, switch the database host to **Neon pooled** and keep `nodejs_compat` (already in `wrangler.jsonc`). Do not use Cloudflare D1 unless you migrate off Prisma Postgres.
