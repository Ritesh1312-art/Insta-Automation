# 🚀 InstaDM Auto — Self-Hosted Instagram Comment-to-DM Platform

A production-grade, event-driven, self-hosted web application that automates **Instagram Comment-to-DM private replies** using official **Meta Graph APIs & Webhooks**.

---

## 📌 Features

- **100% Official Meta Graph API Compliance**: Uses official Meta Webhooks (`comments`) and official Instagram Private Reply endpoints (`/v19.0/{comment-id}/private_replies`).
- **Post-Specific Deterministic Mapping**: Reel A comments ("HANUMAN") receive Link A; Reel B comments ("PROMPT") receive Link B.
- **Fast Webhook & Composite Idempotency**: Responds to Meta webhooks in < 500ms and prevents duplicate DMs using composite database keys (`instagramAccountId:commentId:automationId`).
- **Keyword Normalizer**: Supports `EXACT`, `CONTAINS`, and `STARTS_WITH` keyword matching modes.
- **Dynamic Template Variables**: Supports `{{username}}`, `{{comment_text}}`, `{{post_caption}}`, `{{resource_url}}`, and `{{keyword}}`.
- **Public Comment Auto-Replies**: Optional public comment replies with rotating variations (e.g. "Sent! Check your DMs 📩").
- **Offline Mock Mode**: Built-in `META_API_MOCK=true` mode for 100% offline local development & webhook testing without Meta access tokens.
- **SaaS Mobile Dashboard**: Built with Next.js 14 App Router, React, TypeScript, and Tailwind CSS.
- **AES-256 Token Encryption**: Access tokens encrypted at rest.

---

## 🛠️ Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (Strict Mode)
- **Styling**: Tailwind CSS
- **Database & ORM**: PostgreSQL + Prisma ORM
- **Authentication & Security**: JWT Cookies, AES-256-GCM Token Encryption, HMAC-SHA256 Signature Verification
- **Icons**: Lucide React

---

## 📋 Prerequisites & Meta App Setup

1. **Meta Developer Account**: Register at [developers.facebook.com](https://developers.facebook.com).
2. **Meta App Creation**: Create a **Business** type application.
3. **Products**: Add **Instagram Graph API** and **Webhooks**.
4. **Webhook Subscription**:
   - Object: `instagram`
   - Callback URL: `https://your-domain.com/api/webhooks/meta`
   - Verify Token: `my_custom_webhook_verify_token_123`
   - Subscribed Field: `comments`
5. **Permissions Required**: `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_read_engagement`, `pages_show_list`.

---

## ⚙️ Environment Variables (`.env`)

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/instagram_automation?schema=public"
APP_URL="http://localhost:3000"

AUTH_SECRET="super-secret-jwt-key-change-in-production-min-32-chars"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

META_APP_ID="your-meta-app-id"
META_APP_SECRET="your-meta-app-secret"
META_VERIFY_TOKEN="my_custom_webhook_verify_token_123"
META_GRAPH_API_VERSION="v19.0"
META_REDIRECT_URI="http://localhost:3000/api/auth/meta/callback"

META_API_MOCK="true"
```

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Clone repository & install dependencies
npm install

# 2. Setup Prisma Database
npx prisma generate
npx prisma db push

# 3. Start Development Server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing Webhook Automations Locally

1. Open Dashboard -> Click **"Test Comment Simulator"**.
2. Select **Reel A ("Hanuman Chalisa")**, type comment **"HANUMAN"**, and click **Simulate**.
3. Observe instant idempotency check, matching logic, and private reply payload in the **Activity & Logs** tab!

---

## 🛡️ Known Meta API Limitations

- **Private Reply Policy**: Meta permits maximum **1 private reply per comment**, within **7 days** of comment creation.
- **Follower Status**: Direct follower verification for arbitrary commenters is **UNSUPPORTED** by official Meta APIs. The app uses compliant two-step CTA prompts.
