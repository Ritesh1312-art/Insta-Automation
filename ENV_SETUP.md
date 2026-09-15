# Environment variables

Copy from `.env.example`. Real values live in your private `.env` (gitignored) and in Cloudflare secrets.

## UPI_PAYEE_NAME — apna naam?

**Haan, UPI app wala naam daalo.** Random word technically chal sakta hai, lekin:

| | |
| --- | --- |
| `UPI_ID` | Paisa **is** VPA par jata hai. Ye galat hua to payment galat account mein chali jaati hai. |
| `UPI_PAYEE_NAME` | QR ke `pn=` field mein dikhta hai: “Paying **Ritesh Gupta**”. NPCI asli naam VPA se nikal leti hai. |

Agar `pn` registered name se match nahi karta, PhonePe/GPay kabhi warning dete hain (“name does not match”), user ghabra ke cancel kar deta hai. Scam lagna bhi asaan hai.

**Best:** UPI app → profile / “receive money” par jo naam likha hai, wahi. Brand name (`InstaDM Auto`) tabhi use karo jab wahi naam UPI pe registered ho.

## What I generated vs what only you have

| Variable | Who fills it |
| --- | --- |
| `AUTH_SECRET` | Generated in your local `.env` |
| `ENCRYPTION_KEY` | Generated (64 hex) |
| `CRON_SECRET` | Generated |
| `SETUP_TOKEN` | Generated — `/setup` ke baad private rakho |
| `META_VERIFY_TOKEN` | Generated — Meta webhook verify token isi se match kare |
| `META_GRAPH_API_VERSION` | `v21.0` |
| `DATABASE_URL` | **You** — Neon/Supabase |
| `APP_URL` | **You** — Cloudflare hostname (HTTPS, no trailing slash) |
| `META_REDIRECT_URI` | `https://<same-as-APP_URL>/api/auth/meta/callback` |
| `META_APP_ID` / `META_APP_SECRET` | **You** — Meta Developers |
| `UPI_ID` | **You** — PhonePe/GPay UPI ID |
| `UPI_PAYEE_NAME` | **You** — name on that UPI ID |

## Cloudflare

Workers → Settings → Variables and Secrets → har key **Build** + **Runtime**. Secrets encrypt (lock).
