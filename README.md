# InstaDM Auto

Instagram comment-to-DM automation for **professional accounts**, using official Meta Graph APIs and signed webhooks.

The product is a follow-gate lead magnet, not a growth hacker:

1. A comment matches a keyword.
2. A private welcome reply offers **Send me the Access**.
3. On that click, the app checks the current Meta follow relationship.
4. Followers receive the resource; non-followers get **Follow Me** and **I've followed**, with a fresh check on every attempt.

## Plans

| Plan | Monthly DM cap | Price |
| --- | --- | --- |
| Free | 30 | ₹0 |
| Standard | 250 | ₹99 |
| Premium | 750 | ₹299 |
| Premium Pro | 2,000 | ₹699 |
| Premium Pro Plus | 5,000+ | ₹1,299 |

There is no unlimited plan. Instagram rate-limits messaging.

## Required configuration

Copy `.env.example` to `.env` / Vercel project settings.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `APP_URL` | Public HTTPS origin |
| `AUTH_SECRET` | 32+ character session secret |
| `ENCRYPTION_KEY` | 64 hex chars for Meta token encryption |
| `CRON_SECRET` | Bearer token for `/api/jobs/process-webhooks` |
| `SETUP_TOKEN` | One-time first admin bootstrap |
| `META_APP_ID` / `META_APP_SECRET` | Meta app credentials |
| `META_VERIFY_TOKEN` | Webhook verify token (must match Meta dashboard) |
| `META_GRAPH_API_VERSION` | e.g. `v21.0` |
| `META_REDIRECT_URI` | `https://YOUR_DOMAIN/api/auth/meta/callback` |
| `UPI_ID` / `UPI_PAYEE_NAME` | Checkout payee. QR is auto-generated from these — no image upload |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional approval bot; env values override dashboard settings |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Optional welcome, OTP, and payment-status emails |

Do not configure `TELEGRAM_WEBHOOK_SECRET`; the app derives a deterministic webhook secret from `AUTH_SECRET`.

## Deploy on Cloudflare

Primary host is **Cloudflare Workers** (OpenNext). Put every secret in Cloudflare **Variables and Secrets** — not in git. Full steps: [CLOUDFLARE.md](./CLOUDFLARE.md).

```bash
npm run cf:deploy
```

After connect, the studio wall loads real Instagram thumbnails (not name-only rows). Tap a post to attach the auto-DM.

## Generic Node host

The app is a standard Next.js 16 + Rust-free Prisma/Postgres project:

```bash
npm ci
npm run env:check
npm run db:deploy
npm run build
npm start
```

`db:deploy` uses checked-in, repeatable migrations. Never use `prisma db push` against production. Point a process supervisor at `npm start`. Schedule `GET /api/jobs/process-webhooks` with header `Authorization: Bearer $CRON_SECRET` every 5 minutes.

## Payments

Checkout is **direct UPI only**. Set `UPI_ID` and `UPI_PAYEE_NAME` (or save the UPI ID in Settings). `/api/billing/upi-qr?plan=PREMIUM` builds an `upi://pay` QR with the exact plan amount. Submitting a UTR creates `PENDING_REVIEW`. An admin opens **UPI reviews** or uses the secret-verified Telegram bot and approves only after the credit is visible in the bank/UPI app. Both interfaces use the same idempotent review path. Plans are never auto-activated from a typed reference number.

## Policy notes

See `/policies`. Follow-gated delivery fails closed when Meta cannot return the current relationship. High-volume “any comment” automations increase restriction risk. This software cannot prevent Instagram from limiting the connected account.

## Local run

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

## Release verification

Before every production release:

```bash
npm ci
npm run env:check
npm run db:validate
npm run check
npm run test:coverage
npm audit --audit-level=low
npm run build
npm run cf:build       # Cloudflare target only
```

The test suite exercises signed webhook parsing, OAuth/session separation, encrypted credentials, CSRF, ownership boundaries, comment matching, follow-gate button spoofing, DM endpoint fallbacks, quota reservation/release, payment locking/review, and database-backed rate limiting.

## Live certification boundary

A successful build proves code/package readiness; it does **not** prove external services are correctly provisioned. Before taking payments or enabling automations, complete [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) with the real production Postgres database, Meta professional account/app review, webhook delivery, UPI settlement account, and any Telegram/SMTP integrations. Never activate a paid plan until its UTR is visibly credited in the bank/UPI app.

## Operations and privacy

`META_GRAPH_API_VERSION` defaults to `v26.0` and should be pinned in production. SMTP is optional for notices but required for OTP password recovery; recovery returns 503 when SMTP is unavailable. Configure `APP_URL` and `CRON_SECRET` for the five-minute scheduler. The health endpoint is `/api/health`, and the authenticated worker is `/api/jobs/process-webhooks`.

Only actionable follow-gate events are retained. Webhook retention is 30 days for processed/ignored events and 90 days for failed events; audit and rate-limit retention is handled by the worker.
