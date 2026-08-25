# Business + Instagram policy notes

## Is the follow-gate possible?

**Partially, and only as an honor system.**

Instagram / Meta Graph API does **not** send a webhook when someone follows a professional account. There is also no supported endpoint that answers “does IGSID X currently follow me?” for comment-to-DM flows.

What *is* supported:

| Step | API reality |
| --- | --- |
| Comment → first DM | `comments` webhook + **one** private reply per comment (`recipient.comment_id`) |
| Buttons | Generic template `web_url` + `postback` (not always available; text fallback is required) |
| Later DMs | Use the commenter’s IGSID inside the 24-hour messaging window after they tap/reply |
| Confirm follow | User taps **I Followed** or replies `DONE`. We store `followGateStatus=CLAIMED`. This is **not** proof they followed. |
| Unlock + resource | Second DM (unlock card) then third DM / final `web_url` for the resource |

What we **do not** do:

- Treat “Visit profile” as a follow
- Scrape the followers list
- Call unofficial Instagram mobile APIs
- Auto-unlock because a profile URL was opened

Some people will tap I Followed without following. That is the tradeoff of staying inside official APIs.

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
