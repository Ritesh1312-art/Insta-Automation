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
| `UPI_ID` / `UPI_PAYEE_NAME` | Checkout payee. QR is auto-generated from these — no image upload |

## Deploy on Cloudflare

Primary host is **Cloudflare Workers** (OpenNext). Put every secret in Cloudflare **Variables and Secrets** — not in git. Full steps: [CLOUDFLARE.md](./CLOUDFLARE.md).

```bash
npm run cf:deploy
```

After connect, the studio wall loads real Instagram thumbnails (not name-only rows). Tap a post to attach the auto-DM.

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

Checkout is **direct UPI**. Set `UPI_ID` and `UPI_PAYEE_NAME` (or save the UPI ID in Settings). `/api/billing/upi-qr?plan=PREMIUM` builds an `upi://pay` QR with the exact plan amount. Submitting a UTR creates `PENDING_REVIEW`. An admin opens **UPI reviews** and approves only after the credit is visible in the bank/UPI app. Plans are never auto-activated from a typed reference number.

## Policy notes

See `/policies`. Follow confirms are not cryptographic proof of a follow. High-volume “any comment” automations increase restriction risk. This software cannot prevent Instagram from limiting the connected account.

## Local run

```bash
npm ci
npx prisma generate
npx prisma db push
npm run dev
```
