# InstaDM Auto

Instagram Comment-to-DM automation using official Meta Graph APIs and webhooks. Connected accounts, media, comments, and replies are always real Meta data.

## Required configuration

Copy `.env.example` to `.env` and set every value with a production secret. `APP_URL` must be the HTTPS deployment URL. In Meta, configure the OAuth redirect URI and webhook callback as `https://your-domain.example/api/auth/meta/callback` and `https://your-domain.example/api/webhooks/meta`, then subscribe the Instagram `comments` field.

The connected Instagram account must be a professional account associated with a Facebook Page. Required permissions are `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, and `pages_manage_metadata`.

## Run locally

```bash
npm ci
npx prisma generate
npx prisma db push
npm run dev
```

Use the dashboard to sign in, connect Meta, sync posts, create resources, and create automations. The configuration checker validates a selected post without creating a comment or sending a DM.

## Delivery guarantees

Webhook requests are verified with the Meta app secret, persisted before acknowledgement, deduplicated by Instagram account and comment ID, and processed immediately with a Vercel background continuation. `vercel.json` schedules a protected retry worker for transient failures.

Meta allows one private reply per comment and requires it within Meta's permitted reply window.
