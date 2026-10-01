# Production certification checklist

This checklist separates **repository readiness** from **live-service certification**. Complete it in a staging environment first, then repeat the marked checks against production. Record the date, operator, and evidence without copying access tokens, passwords, UTRs, or personal data into tickets.

## 1. Release and database

- [ ] `npm ci` completes from the lockfile.
- [ ] `npm run env:check` passes with the intended production hostname.
- [ ] `npm run check`, `npm run test:coverage`, `npm audit --audit-level=low`, and the target build pass.
- [ ] A recoverable Postgres backup/snapshot exists.
- [ ] `npm run db:deploy` completes before the new application starts.
- [ ] `/api/health` returns HTTP 200 with `{"status":"ok","database":"reachable"}`.
- [ ] At least one database restore has been rehearsed in a non-production project.

### Existing database created with `prisma db push`

Do not run the initial migration over non-empty tables. Back up the database, confirm its schema already contains the initial, webhook-retry, and Telegram fields, then baseline those migrations once:

```bash
npx prisma migrate resolve --applied 20260314000000_initial_schema
npx prisma migrate resolve --applied 20260722000000_add_webhook_retry_schedule
npx prisma migrate resolve --applied 20260915000000_direct_upi_and_telegram
npm run db:deploy
```

The final migration converts historical `DirectUpiPayment.amount` values from INR floats to integer paise. Inspect a copy of real payment rows before applying it. Never mark a migration applied unless an operator has verified that its schema changes are already present.

## 2. Secrets and access

- [ ] `AUTH_SECRET`, `CRON_SECRET`, `SETUP_TOKEN`, and `META_VERIFY_TOKEN` are independently generated high-entropy values.
- [ ] `ENCRYPTION_KEY` is exactly 64 hexadecimal characters and has a protected backup. Losing it makes stored Meta/bot tokens unreadable.
- [ ] Secrets exist only in the host's secret manager, not Git, build logs, screenshots, or client bundles.
- [ ] HTTPS is enforced and `APP_URL` and `META_REDIRECT_URI` use the exact canonical production origin.
- [ ] `/setup` created the intended first admin; `SETUP_TOKEN` was then rotated or removed.
- [ ] A non-admin account receives 403 from admin UPI, user, and Telegram-setting APIs.
- [ ] Secret rotation and incident owners are documented.

## 3. Meta professional account and app

- [ ] A real Instagram **professional** account is linked to the intended Facebook Page.
- [ ] The Meta app has the permissions shown on the OAuth consent request and has the required Live-mode/App Review approvals for users outside app roles.
- [ ] OAuth redirect is exactly `https://YOUR_DOMAIN/api/auth/meta/callback`.
- [ ] Webhook callback is exactly `https://YOUR_DOMAIN/api/webhooks/meta`; verification succeeds only with the configured verify token.
- [ ] Instagram/Page webhook subscriptions cover comment, message, postback, and quick-reply events used by the app.
- [ ] Connecting an account syncs real media and the dashboard displays its current connection status.
- [ ] A comment on one connected account cannot trigger an automation belonging to another account.
- [ ] Meta data deletion callback and public privacy/terms/data-deletion pages are reachable.

## 4. Comment-to-DM acceptance test

Use a dedicated test post and a separate test Instagram user.

- [ ] Wrong keyword: no DM.
- [ ] Matching keyword: one private welcome with **Send me the Access**, with one corresponding run/event.
- [ ] Replaying the same webhook/comment: no duplicate delivery.
- [ ] Typing an internal button token as text: no unlock.
- [ ] Tapping **Send me the Access** as a current follower: the configured resource is delivered immediately.
- [ ] Tapping it as a non-follower: **Follow Me** and **I've followed** appear, with no resource delivery.
- [ ] Tapping **I've followed** rechecks Meta; a false or unavailable relationship repeats the controls, while a verified relationship delivers exactly once.
- [ ] A Meta send failure releases a reserved quota where appropriate and is retried only for transient failures.
- [ ] Paused automation, expired token, missing conversation, owner comment, and plan/quota limit each fail safely.
- [ ] Any-comment mode is enabled only after its account-risk warning is accepted operationally.

Instagram does not expose a reliable follow-verification webhook here. Certification must confirm that the live IGSID profile lookup returns `is_user_follow_business`; unavailable checks must withhold the resource.

## 5. UPI and admin review

- [ ] Checkout QR/pay URI shows the server-defined plan and exact rupee amount.
- [ ] Client-side amount tampering cannot alter the stored amount.
- [ ] Duplicate UTR and second pending-payment submissions are rejected.
- [ ] A typed UTR never activates a plan automatically.
- [ ] Admin verifies settlement in the real bank/UPI app before approval.
- [ ] Concurrent/double approval is idempotent; only one audit transition and one plan activation occur.
- [ ] Rejection leaves the plan inactive and stores an appropriate review note.
- [ ] Amounts in database, dashboard, Telegram, and email agree (database values are integer paise).

## 6. Optional Telegram and SMTP

### Telegram

- [ ] Bot token/chat ID are stored as secrets or encrypted admin settings.
- [ ] Webhook path/secret is obtained through the admin settings API; the derived secret itself is not configured as an environment variable.
- [ ] A message from another chat and a forged callback are rejected.
- [ ] Approve/reject buttons invoke the same idempotent payment-review service as the dashboard.

### SMTP

- [ ] All five SMTP variables are configured, or all are intentionally omitted.
- [ ] Welcome, reset OTP, payment submitted, approved, and rejected emails arrive.
- [ ] Failure of the mail provider does not roll back account/payment state; monitoring catches delivery failure.

## 7. Scheduling, monitoring, and rollback

- [ ] `GET /api/jobs/process-webhooks` runs every five minutes with `Authorization: Bearer $CRON_SECRET`.
- [ ] Calling the job without that header returns 401.
- [ ] Alerts cover health 503, repeated webhook failures, Meta authorization errors, queue age, payment review backlog, and abnormal login/reset traffic.
- [ ] Logs and audit entries do not expose access tokens, encryption keys, full secrets, or passwords.
- [ ] A rollback procedure includes application rollback, database compatibility assessment, and Meta webhook disable/disconnect steps.

Only after every applicable box is evidenced should the live integration be described as production-certified.

## Before production

- [ ] Set and pin `META_GRAPH_API_VERSION=v26.0`.
- [ ] Configure SMTP (required for OTP recovery), `CRON_SECRET`, `APP_URL`, and PostgreSQL.
- [ ] Verify Meta subscriptions for both Page and Instagram objects.
- [ ] Run migration against a disposable PostgreSQL database and test partial unique indexes.
- [ ] Exercise Meta, Telegram, UPI, SMTP, and scheduler integrations with live sandbox credentials; automated tests are not certification.

## Operational verification log

### 2026-10-01 — Arena session `arena/01a0f718-insta-automation`

Attempted the full operational runbook (PR merge → migrate → deploy → health/webhook/scheduler/SMTP/monitoring checks → restore drill). Recorded here are only actions actually executed in this sandbox, with no secret values printed.

**GitHub / PR**
- `arena/01a0f718-insta-automation` has no diff from `main` (`git diff main HEAD` is empty) and no open PR — there is nothing on this branch to merge.
- `gh pr list --state open` shows exactly one open PR repo-wide: **#6** `fix: recognize updated Telegram bot destination rejection` (branch `arena/01a0ccda-insta-automation`, unrelated to this session).
  - `statusCheckRollup`: Vercel check = **FAILURE** (2026-09-23T06:03Z). A required check is not green.
  - PR **#8**'s own description documents that it already carried PR #6's substantive fix (the TDLib rejection-wording comment) forward onto `main` while fixing a merge conflict; PR #8 is merged. PR #6 therefore appears superseded in addition to failing its check.
  - **Action taken: did not merge PR #6** (failing required check; not on the assigned branch; appears superseded). No PR existed to merge/update on the assigned branch. No PR was opened because no code change was needed this run.

**Environment / deploy / database / SMTP / monitoring**
- This sandbox has no Vercel/Cloudflare session (`vercel whoami` → "Logged out"; `wrangler whoami` → "not authenticated"), no `DATABASE_URL`/`APP_URL`/`CRON_SECRET`/SMTP/monitoring-provider variables set, and `gh secret list` is not accessible to this token (HTTP 403). The repo also has no `.github/workflows`, so there is no CI-side place those secrets could be exercised either.
- The task brief's "non-secret deployment information" (hosting provider, production URL, database provider, monitoring provider) was supplied as unfilled template placeholders, so there is no concrete production target to point any of these commands at.
- Ran `npm run env:check` locally with no environment loaded, purely to confirm the validator itself works: it correctly fails closed, listing only field *names* that are missing/invalid, never values (see command output below). This is **not** a verification of the real production configuration — that requires running the same command inside the actual hosting platform's environment (Vercel/Cloudflare build or an authenticated shell), which this sandbox cannot reach.

  ```
  $ npm run env:check
  Environment validation failed:
  - DATABASE_URL is required
  - APP_URL is required
  ... (all other required keys listed by name only)
  ```

- **Not executed (blocked, no credentials/target in this sandbox):** production backup creation/verification, `npm run db:deploy` against production, production deploy, `/api/health` and page/API checks against a live URL, Meta Page/Instagram webhook subscription check, five-minute cron scheduler configuration/test, SMTP send test, monitoring alert configuration, and the staging restore drill.

**Why stopped here:** per the safety rules for this task ("stop and report clearly if required platform access is unavailable" and "confirm a verified backup exists before applying production migrations"), none of steps 3–12 were simulated or marked complete without real access. No destructive command was run against any database.

**Still required from the user/operator:** supply (via the hosting/database/monitoring platforms directly, not in chat) a reachable production `APP_URL`, `DATABASE_URL`, SMTP, and monitoring-provider access so these steps can be executed and evidenced in a follow-up run; confirm whether PR #6 should be closed as superseded/failing.
