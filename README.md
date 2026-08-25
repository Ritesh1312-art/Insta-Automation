# InstaDM Auto

Instagram comment-to-DM automation for **professional accounts**, using official Meta Graph APIs and signed webhooks.

The product is a follow-gate lead magnet, not a growth hacker:

1. A comment matches a keyword.
2. One private reply asks the person to follow and confirm.
3. They tap **I Followed** or reply `DONE` (honor system — Instagram has no follow webhook).
4. An unlock card is sent, then the resource is delivered on the final button.

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
| `UPI_ID` / `UPI_PAYEE_NAME` | Shown on checkout |

## Deploy on Vercel

1. Create a Postgres database (Vercel Postgres, Neon, or Supabase).
2. Import the GitHub repo into Vercel.
3. Set every environment variable above. `APP_URL` and `META_REDIRECT_URI` must be the production HTTPS URL.
4. Deploy. `npm run build` runs `prisma generate && prisma db push && next build`.
5. Open `/setup` once with `SETUP_TOKEN`, then keep that token private.
6. In Meta Developers:
   - Valid OAuth redirect: `https://YOUR_DOMAIN/api/auth/meta/callback`
   - Webhook callback: `https://YOUR_DOMAIN/api/webhooks/meta`
   - Verify token = `META_VERIFY_TOKEN`
   - Subscribe Instagram fields: `comments`, `messages`, `messaging_postbacks`
7. Connect a **professional** Instagram account linked to a Facebook Page.
8. Set `CRON_SECRET`. Vercel Cron calls `/api/jobs/process-webhooks` every 5 minutes (`vercel.json`). Hobby plans only allow a daily cron — use Vercel Pro or an external ping.

## Cloudbase / generic Node host

Same app is a standard Next.js 15 + Prisma project:

```bash
npm ci
npx prisma generate
npx prisma db push
npm run build
npm start
```

Point a process supervisor at `npm start`. Schedule `GET /api/jobs/process-webhooks` with header `Authorization: Bearer $CRON_SECRET` every 5 minutes.

## Payments

Checkout is **direct UPI**. Submitting a UTR creates `PENDING_REVIEW`. An admin opens **UPI reviews** and approves only after the credit is visible in the bank/UPI app. Plans are never auto-activated from a typed reference number.

## Policy notes

See `/policies`. Follow confirms are not cryptographic proof of a follow. High-volume “any comment” automations increase restriction risk. This software cannot prevent Instagram from limiting the connected account.

## Local run

```bash
npm ci
npx prisma generate
npx prisma db push
npm run dev
```
