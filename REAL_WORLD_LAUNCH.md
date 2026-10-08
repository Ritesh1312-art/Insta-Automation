# Real-world launch checklist

Everything in `VERIFICATION_LOG.md` was verified in-sandbox against local
stand-ins for Meta, the Instagram CDN, the Telegram Bot API and SMTP, plus a
real PostgreSQL. The steps below are the ones that can only be done with **your**
real credentials and infrastructure. Nothing here is marked verified — each item
is a command to run and the exact output to expect.

Run the whole checklist in one command first:

```bash
npm run verify:integrations      # PASS/FAIL per integration, secrets never printed
```

It checks, and prints the reason for every failure:

| Check | Needs |
| --- | --- |
| Environment contract (`npm run env:check`) | the full `.env` |
| PostgreSQL reachable + all migrations applied | `DATABASE_URL` |
| Meta app credentials accepted by `graph.facebook.com` | `META_APP_ID`, `META_APP_SECRET` |
| Webhook verification handshake answers with the challenge | `APP_URL`, `META_VERIFY_TOKEN` |
| Stored page token still works (decrypts it and calls Graph) | `ENCRYPTION_KEY` + a connected account |
| Bot token valid, webhook registered and pointing at this deployment | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_URL` |
| Live test message to the admin chat | as above |
| SMTP connection + credentials accepted, test mail accepted | `SMTP_*` (`VERIFY_MAIL_TO` overrides the recipient, defaults to `SMTP_USER`) |

```console
$ npm run verify:integrations
PASS  Environment contract (npm run env:check)
PASS  PostgreSQL reachable over the production URL
PASS  All committed migrations are applied
PASS  Meta: app credentials accepted by graph.facebook.com
PASS  Meta: webhook verification handshake
PASS  Meta: stored page token is still valid
PASS  Telegram: bot token is valid
PASS  Telegram: webhook registered and pointing at this deployment
PASS  Telegram: live test message to the admin chat
PASS  SMTP: connection and credentials accepted
PASS  SMTP: test mail accepted for delivery

11 passed, 0 failed, 0 skipped.
```

---

## 0. Who can use your deployment — two kinds of credentials

"Only your real credentials" refers to **deployment secrets**, not to who may
sign up. There are two separate layers:

| Layer | Whose | Examples | Visible to end users? |
| --- | --- | --- | --- |
| Deployment secrets (`.env` / Worker vars) | the owner (you), set once at deploy time | `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ENCRYPTION_KEY`, `AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SMTP_*`, `DATABASE_URL`, `SETUP_TOKEN` | never |
| Per-user credentials | each user, created in-app | their own login (`/register`) and their own Instagram account connected over OAuth | only their own |

So the platform is multi-user, not personal-only: anyone can register, gets
their own plan and quota (`src/lib/plans.ts`) and their own `MetaConnection`
row holding a per-user encrypted token. Users never see or need the Meta app
secret — they only log into Instagram on Meta's own consent screen.

The first admin is created once via `POST /api/auth/setup` with `SETUP_TOKEN`;
Telegram payment-approval messages always go to that admin's chat. All 11
checks of `npm run verify:integrations` cover the **deployment-secret** layer,
which is exactly why only you can run them after deploying — the sandbox
verified every code path against local stand-ins instead.

### Meta app mode: who Instagram allows to connect

Until your Meta app is **Live** with Advanced Access, Meta only lets accounts
that hold a role on the app connect:

- *Development mode* (the default): only app **Admin / Developer / Tester**
  accounts. Add people under App Roles → Roles → Testers (each tester must
  accept the invitation) and they can connect right away.
- *Live mode*: required for the general public — switch the app to Live and
  pass App Review for **Advanced Access** on the scopes the app requests:
  `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`,
  `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
  `pages_messaging`, `business_management`, `public_profile`
  (`META_OAUTH_SCOPES` in `src/services/meta/MetaAuthService.ts`).
  `pages_messaging` is what authorizes the private-reply DM: without it in the
  Page token grant Meta answers `(#230) Requires pages_messaging permission to
  manage the object` and no DM is ever delivered.
- Either way, the connected Instagram account must be a **professional**
  (Business or Creator) account linked to a Facebook Page; personal accounts
  cannot use the comment-to-DM APIs.

---

## 1. Database (E1)

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/instagram_automation?schema=public"
npm run db:deploy      # prisma migrate deploy, exit 0
npm run db:validate    # prisma validate → "The schema at prisma/schema.prisma is valid"
```

Expected: every migration under `prisma/migrations/` applied, twice in a row
(the second run says *No pending migrations to apply*). If the CLI complains
that the query-engine binary cannot be downloaded, set
`PRISMA_QUERY_ENGINE_LIBRARY=/path/to/libquery_engine.so.node` — `db:deploy`
already sets the sandbox-safe default.

## 2. Meta / Instagram (A1–A7)

1. Meta app → *Facebook Login for Business* → add the exact redirect URI:
   `https://YOUR_DOMAIN/api/auth/meta/callback` (`META_REDIRECT_URI`).
2. Webhooks → subscribe to the Page fields `feed, messages, messaging_postbacks`
   and the Instagram fields `comments, messages, messaging_postbacks`, with the
   callback URL `https://YOUR_DOMAIN/api/webhooks/meta` and the verify token
   `META_VERIFY_TOKEN`.
3. In the app: *Dashboard → Connect Instagram*, then confirm:

```bash
curl -s "https://YOUR_DOMAIN/api/health"
# {"status":"ok","database":"reachable","latencyMs":N}

# After connecting, the connection must exist and hold an encrypted token:
psql "$DATABASE_URL" -c 'SELECT "instagramUsername", "connectionStatus", left("accessTokenEncrypted", 12) FROM "MetaConnection";'
```

4. Post a real comment containing your flow keyword from a second account and
   watch: the commenter receives the access DM, then the follow prompt, then the
   resource. The same rows the sandbox tests assert on (`AutomationRun`,
   `AutomationContactState`, `Contact.promptSentAt`) will appear:

```bash
psql "$DATABASE_URL" -c 'SELECT status, "dmStatus", "publicReplyStatus" FROM "AutomationRun" ORDER BY "createdAt" DESC LIMIT 3;'
```

Note: `is_user_follow_business` (A7) is only returned by the Instagram Graph
API for a **professional** account that the user follows, which is why the
follow-gate check is live on every retry and never trusts a stored flag.

## 3. Transactional mail (B1–B3)

Set all five `SMTP_*` values (Gmail needs an App Password), then:

```bash
npm run verify:integrations      # SMTP checks included
```

Then walk the flows once in the browser: register (welcome mail), submit a UPI
payment (submitted mail), approve it in the admin dashboard (activated mail),
reject another one (rejection mail with the reason), and *Forgot password* →
the 6-digit code must arrive by mail and only that code must reset the password.

## 4. Telegram payment approvals (C1–C3)

1. Create a bot with `@BotFather` → `TELEGRAM_BOT_TOKEN`.
2. Open *Dashboard → Settings → Telegram*, paste the token and the admin chat ID
   (or send `/id <pairing code>` from the chat and let the bot pair itself).
3. `APP_URL` must be the public HTTPS origin: `setWebhook` is refused otherwise.

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
# "url":"https://YOUR_DOMAIN/api/webhooks/telegram"  ← must match APP_URL + path
```

4. Submit a UPI payment as a user: the Approve/Reject message must arrive in the
   admin chat, and tapping **Approve** must flip the payment to `VERIFIED`,
   activate the plan and send the activation mail. Tapping it twice must be
   idempotent (one plan activation, one mail).

## 5. Cloudflare / OpenNext (E2)

```bash
npm run cf:build                       # exit 0

npx wrangler@latest deploy             # real account, your credentials
curl -s https://YOUR_WORKER.workers.dev/api/health
# {"status":"ok","database":"reachable","latencyMs":N}
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR_WORKER.workers.dev/login   # 200
```

Local mode (`npx wrangler dev --local`) was verified in this workspace: the
worker boots, serves `/login`, `/pricing` and the static bundle with 200s,
enforces the security headers and answers `/api/webhooks/meta` with 401 without
a signature. `/api/health` cannot reach the database *in this sandbox only*
because this machine's `workerd` refuses all Wasm code generation
(`WebAssembly.Module(): Wasm code generation disallowed by embedder`, reproduced
with an empty 8-byte module) and Prisma's client engine is Wasm. Reproduce the
same command on your machine — a stock `workerd` allows Wasm, and the health
check returns `ok`.

## 6. Things the sandbox could not exercise at all

| Item | Why | Command once you have the real values |
| --- | --- | --- |
| Meta token exchange against the real Graph API | graph.facebook.com is unreachable here | the OAuth walkthrough in §2 |
| Real Instagram CDN image bytes | only the fake CDN over HTTPS was reachable | `curl -s -o /tmp/avatar.png -w '%{http_code} %{content_type}\n' https://YOUR_DOMAIN/api/meta/profile-picture -H "Cookie: auth_token=<your session>"` |
| Real Meta webhook delivery (including `x-hub-signature-256` from Meta) | Meta cannot call this sandbox | post a comment on the connected account and confirm the run row (see §2) |
| Real Telegram delivery and button taps | api.telegram.org is unreachable | §4 |
| Real SMTP provider handshake (Gmail App Password, SPF/DKIM) | external SMTP is unreachable | `npm run verify:integrations` |
| A real Cloudflare deploy and a Worker with a reachable database | requires your account + Hyperdrive/connection string | §5 |
| UPI settlement | money movement happens in your bank app | verify the UTR manually before tapping Approve |

Everything else — the whole application logic, every webhook handler, the follow
gate, quota accounting, plan activation, mail bodies, Telegram callbacks and the
database schema — is covered by the 349 tests in `npm test`, which run against a
real PostgreSQL and real HTTP servers.
