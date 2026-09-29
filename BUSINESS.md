# Business + Instagram policy notes

## Is the follow-gate possible?

**Yes, with a live relationship check at the moment access is requested.**

Instagram / Meta Graph API does **not** send a webhook when someone follows a professional account. For an IGSID that has interacted with the business, the profile lookup can return `is_user_follow_business`, so this app queries it on every access attempt and fails closed if it is missing or the request fails.

What *is* supported:

| Step | API reality |
| --- | --- |
| Comment → first DM | `comments` webhook + **one** private reply per comment (`recipient.comment_id`) |
| Buttons | Generic template `web_url` + `postback` (not always available; text fallback is required) |
| Later DMs | Use the commenter’s IGSID inside the 24-hour messaging window after they tap/reply |
| Request access | `Send me the Access` triggers a fresh profile relationship lookup. |
| Follow retry | `Follow Me` opens the creator profile; `I've followed` performs the lookup again. |
| Resource | A verified current follower receives the configured prompt/resource directly and at most once per automation. |

What we **do not** do:

- Treat opening the creator profile as a follow
- Treat the button label, `DONE`, or an old database timestamp as proof
- Scrape the followers list
- Call unofficial Instagram mobile APIs
- Deliver when Meta's relationship check is unavailable

## Payment safety

UTR numbers can be invented. Auto-activating a plan from a form is fraud-prone.

Safe flow in this repo:

1. Logged-in customer pays the exact amount to the published UPI ID.
2. They submit name, their UPI ID, and UTR.
3. Row is `PENDING_REVIEW`. Quota does not change.
4. Admin opens the UPI / bank app, matches amount + UTR, then taps Approve.
5. Only then is `plan` + `monthlyDmQuota` updated and usage reset.

## Risks you should tell customers

- Professional accounts can still be restricted for repetitive templates, unsolicited DMs, or “any comment” blasts.
- Meta private-reply and messaging rate limits are independent of your SaaS quota.
- “Unlimited DMs” is not a defensible claim. 5,000+ is the highest published cap here.
- You are not Meta. You cannot restore a banned Instagram account.
- Follow-gate does not replace Instagram’s own close-friends / subscriber features.

## Operating defaults

- Prefer keyword triggers.
- Keep `oneDeliveryPerUser` on.
- Pause automations when Meta returns code 4 / 17 / 613.
- Use the emergency pause switch in Settings.
