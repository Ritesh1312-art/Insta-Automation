# Function status

All 130 functions below are implemented **and verified**. A row is only marked
complete because a command was run and its real output observed: the per-item
evidence index is at the bottom of [VERIFICATION_LOG.md](VERIFICATION_LOG.md),
and anything that needs a real third-party credential is a go-live step in
[REAL_WORLD_LAUNCH.md](REAL_WORLD_LAUNCH.md).

Scope: every HTTP route, every page, every library module, every service and
every operational script in the repository. The `Status` column is `Complete`
for every row.

| Function | Status |
| --- | --- |
| GET /api/health — database reachability probe | Complete |
| POST /api/auth/register — account creation, session cookie, welcome mail | Complete |
| POST /api/auth/login — password sign-in, rate limited, session cookie | Complete |
| POST /api/auth/logout — session cookie cleared, sessionVersion bump | Complete |
| GET /api/auth/me — current session user | Complete |
| POST /api/auth/admin-login — configured-identifier admin sign-in | Complete |
| POST /api/auth/setup — first-run admin bootstrap with SETUP_TOKEN | Complete |
| POST /api/auth/reset — token-guarded password reset (break-glass) | Complete |
| POST /api/auth/forgot — password recovery: REQUEST_OTP and VERIFY_AND_RESET | Complete |
| GET /api/auth/meta/url — signed OAuth state + Meta dialog URL | Complete |
| GET /api/auth/meta/callback — code→token, page lookup, subscribe_apps, initial media sync | Complete |
| GET /api/auth/meta/debug — read-only Meta diagnostics for admins | Complete |
| POST /api/auth/meta/debug — live webhook re-subscribe (code 190 → TOKEN_EXPIRED) | Complete |
| POST /api/auth/meta/disconnect — disconnect Instagram, pause the account's flows | Complete |
| GET /api/media — cached media list (+ ?sync=true live sync with soft-fail cache) | Complete |
| GET /api/meta/profile-picture — authenticated CDN-allowlisted avatar proxy | Complete |
| POST /api/meta/data-deletion — signed Meta data-deletion callback | Complete |
| GET /api/webhooks/meta — webhook verification handshake | Complete |
| POST /api/webhooks/meta — signed comment/messaging webhook intake | Complete |
| POST /api/webhooks/telegram — Telegram updates: pairing, /pending, Approve/Reject | Complete |
| GET /api/automations — list flows for the signed-in workspace | Complete |
| POST /api/automations — create a flow under plan limits and one-active-per-scope | Complete |
| PATCH /api/automations — update a flow (activation limits, ownership checks) | Complete |
| DELETE /api/automations — delete a flow | Complete |
| POST /api/automations/pause-all — pause every active flow | Complete |
| POST /api/automations/test-trigger — dry-run a flow against a sample comment | Complete |
| GET /api/resources — list resources with attached-flow counts | Complete |
| POST /api/resources — create a URL/TEXT/PDF_LINK/FILE resource | Complete |
| DELETE /api/resources — delete a resource that has no attached flow | Complete |
| GET /api/logs — automation/webhook run history for the dashboard | Complete |
| GET /api/stats — workspace analytics (runs, comments, quota) | Complete |
| GET /api/contacts/mark-followed — record a manual follow claim for a contact | Complete |
| POST /api/payments/direct-upi/submit — UPI submission with UTR dedupe under a row lock | Complete |
| GET /api/payments/direct-upi/review — admin list of UPI payments | Complete |
| POST /api/payments/direct-upi/review — approve/reject a payment, activate the plan | Complete |
| GET /api/billing/public — public plan catalogue and prices | Complete |
| GET /api/billing/upi-qr — server-rendered UPI QR for the configured payee | Complete |
| GET /api/admin/users — admin user list with plan/quota controls | Complete |
| POST /api/admin/users — admin actions: plan change, quota reset, analytics reset | Complete |
| GET /api/admin/upi-settings — read the admin UPI payee settings | Complete |
| POST /api/admin/upi-settings — save the admin UPI payee settings | Complete |
| GET /api/admin/telegram-settings — Telegram status incl. live getMe/getWebhookInfo | Complete |
| POST /api/admin/telegram-settings — save the bot token/chat ID and setWebhook | Complete |
| GET /api/admin/database-status — database health and migration state for admins | Complete |
| POST /api/jobs/process-webhooks — CRON_SECRET-guarded retry/retention scheduler | Complete |
| / (landing) — marketing page | Complete |
| /login — user sign-in | Complete |
| /register — account creation | Complete |
| /forgot — OTP request → verify → new password | Complete |
| /reset — break-glass password reset with SETUP_TOKEN | Complete |
| /setup — first-run admin bootstrap | Complete |
| /admin/login — dedicated admin sign-in | Complete |
| /dashboard — Studio overview (counters, quota, connection state) | Complete |
| /dashboard/automations — flow list and editor | Complete |
| /dashboard/content — media library with live sync | Complete |
| /dashboard/resources — resource manager | Complete |
| /dashboard/logs — run and webhook history | Complete |
| /dashboard/settings — Instagram connection, Telegram, UPI settings | Complete |
| /dashboard/pricing — plan catalogue and UPI checkout | Complete |
| /dashboard/admin — admin overview | Complete |
| /dashboard/admin/users — user/plan management | Complete |
| /dashboard/admin/payments — UPI payment review queue | Complete |
| /privacy — privacy policy | Complete |
| /terms — terms of service | Complete |
| /pricing — public pricing page | Complete |
| src/lib/auth — JWT sessions, OAuth state, sessionVersion revocation | Complete |
| src/lib/require-admin — admin guard for API routes | Complete |
| src/lib/password-policy — shared password policy | Complete |
| src/lib/password-auth — bcrypt hash validation + dummy hash for timing safety | Complete |
| src/lib/encryption — AES-256-GCM token encryption (iv:tag:ciphertext) | Complete |
| src/lib/rate-limit — database-backed limiter over advisory locks | Complete |
| src/lib/advisory-lock — transaction-scoped advisory locks (cast queries) | Complete |
| src/lib/quota — plan cycle, DM reservation/release, scheduled resets | Complete |
| src/lib/plans — plan catalogue, prices in INR, plan assignment data | Complete |
| src/lib/payment-review — UPI review transaction (approve/reject + mails) | Complete |
| src/lib/telegram — Bot API client, webhook secret, pairing code, keyboards | Complete |
| src/lib/mailer — SMTP transactional mail (welcome, OTP, payment mails) | Complete |
| src/lib/meta-graph — Graph base URL/version resolution + pagination guard | Complete |
| src/lib/meta-errors — Meta error classification and reauthorization detection | Complete |
| src/lib/meta-signed-request — Meta signed_request parsing/verification | Complete |
| src/lib/flow-scope — active-flow scoping helpers | Complete |
| src/lib/analytics-reset — admin analytics reset transaction | Complete |
| src/lib/database-status — database/migration status reporting | Complete |
| src/lib/http-cache — private no-store JSON helper | Complete |
| src/lib/safe-error — secret redaction and safe error messages | Complete |
| src/lib/app-url — canonical APP_URL / Meta redirect URI resolution | Complete |
| src/lib/auth-logging — PII-free auth failure logging | Complete |
| src/lib/upi — UPI ID/UTR validation | Complete |
| src/lib/upi-server — UPI payment string + QR generation | Complete |
| src/lib/studio-refresh — dashboard refresh helpers | Complete |
| src/lib/prisma — PrismaClient with the pg driver adapter | Complete |
| src/services/automation/AutomationEngine — comment + messaging pipelines, retries, idempotency | Complete |
| src/services/automation/FollowGateService — welcome, follow prompt, resource delivery, contact state | Complete |
| src/services/automation/FollowGateService.resolveFollowGateStatus — live is_user_follow_business check | Complete |
| src/services/automation/KeywordMatcher — EXACT/CONTAINS/STARTS_WITH/CASE_SENSITIVE matching | Complete |
| src/services/automation/template — {{username}}/{{resource_url}} rendering, UTF-8 safe cap | Complete |
| src/services/meta/MetaAuthService — OAuth exchange, page lookup, subscribe_apps | Complete |
| src/services/meta/InstagramMessagingService — private/public replies, DMs, profile, comment details | Complete |
| src/services/meta/InstagramMediaService — paginated media fetch with token hygiene | Complete |
| src/services/webhooks/WebhookService — signature verification + payload parsing | Complete |
| Webhook retry scheduler — bounded exponential backoff, RETRYING → FAILED | Complete |
| Follow-gate attempt cap — MAX_FOLLOW_PROMPTS=3 per contact and flow | Complete |
| Follow-gate delivery claim — CLAIMED/DELIVERED state machine, one delivery per user | Complete |
| Public reply templates — random pick + variable rendering, skipped when empty | Complete |
| Quota accounting — reserve before Meta, release on definitive rejection | Complete |
| Plan activation — transactional plan/quota assignment on approval | Complete |
| Meta token invalidation — TOKEN_EXPIRED on code 190 with audit trail | Complete |
| Telegram payment notifications — Approve/Reject inline keyboard | Complete |
| Telegram approval handler — idempotent review, message edit, callback answer | Complete |
| Telegram chat pairing — /id <code> binds the admin chat (env override respected) | Complete |
| scripts/db-local.cjs — embedded PostgreSQL provisioning for sandbox/local runs | Complete |
| scripts/db-deploy.mjs — production-shape prisma migrate deploy | Complete |
| scripts/check-env.mjs (npm run env:check) — environment contract validation | Complete |
| scripts/create-admin.ts — admin creation/reset CLI | Complete |
| scripts/run-tests.mjs — provisions PostgreSQL + mocks + next start, runs vitest | Complete |
| scripts/mocks/graph-mock.cjs — local Meta Graph API stand-in with request log | Complete |
| scripts/mocks/cdn-mock.cjs — local Instagram CDN stand-in over HTTPS | Complete |
| scripts/mocks/telegram-mock.cjs — local Bot API stand-in with request log | Complete |
| scripts/mocks/smtp-mock.cjs — SMTP catcher writing real MIME messages | Complete |
| scripts/evidence/live-evidence.mjs — paste-ready end-to-end evidence run | Complete |
| scripts/verify-integrations.mjs (npm run verify:integrations) — live credential checks | Complete |
| prisma.config.ts — Prisma CLI ↔ WASM schema engine bridging (OID 19 + executeScript) | Complete |
| prisma/migrations/20261007000000_follow_prompt_cap — followPromptCount column | Complete |
| src/proxy.ts — CSRF origin check (Host/x-forwarded-host) + dashboard guard | Complete |
| src/components/AutomationComposer.tsx — flow editor UI | Complete |
| src/components/PostCard.tsx — media card UI | Complete |
| src/components/UpiPayForm.tsx — UPI checkout form | Complete |
| src/components/PasswordInput.tsx — password field with reveal toggle | Complete |
| src/components/studio.ts — dashboard formatting helpers | Complete |
| Test suite — 349 tests across unit + integration, 0 skipped | Complete |
