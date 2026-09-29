# Security policy

## Reporting a vulnerability

Do not open a public issue containing credentials, personal data, webhook payloads, payment references, or an exploitable proof of concept. Contact the repository owner privately through the GitHub security-advisory/reporting channel. Include the affected route/version, impact, reproduction steps, and a redacted proof. Do not access data that is not yours or disrupt live Meta/UPI services.

## Supported release

Only the current production release is supported. Rotate affected credentials immediately when exposure is suspected; application fixes do not revoke already leaked Meta, Telegram, SMTP, database, or session secrets.

## Security model

The application assumes:

- HTTPS termination and a trusted production secret store.
- A dedicated Postgres role and encrypted database transport.
- Official Meta OAuth/Graph endpoints and signed webhook delivery.
- Manual UPI settlement verification by an authorized administrator.
- A five-minute authenticated retry job.

Implemented controls include signed, purpose-bound session/OAuth tokens; authenticated encryption for stored access tokens; same-origin mutation protection; secure/HTTP-only cookies; database-backed abuse limits; ownership/account-scoped queries; transactional quota/payment transitions; webhook signature verification and deduplication; idempotent automation runs; CSP/HSTS and related browser headers; password policy; and audit logs for sensitive state changes.

## Operational limitations

- Instagram does not provide a reliable follow webhook for this flow. Resource delivery therefore queries Meta's current IGSID follow relationship on each access attempt and fails closed when that check is unavailable.
- App Review, access-token health, webhook subscriptions, UPI settlement, Telegram, SMTP, database backup/restore, and hosting controls must be certified against live services; repository tests cannot prove them.
- A CSP containing `unsafe-inline` is currently required by the Next.js rendering target. Keep dependencies pinned/audited and do not render unsanitized HTML.
- Treat usernames, comments, email addresses, UPI identifiers, UTRs, IP-derived fingerprints, and webhook payloads as sensitive data. Define retention/deletion periods and restrict database/log access.

See [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) before launch.
