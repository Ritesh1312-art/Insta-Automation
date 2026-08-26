import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Instagram policy notes | InstaDM Auto' };

export default function PoliciesPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-200">
      <Link href="/" className="text-xs text-slate-500 hover:text-white">← Home</Link>
      <h1 className="mt-4 text-3xl font-bold text-white">Instagram automation policies</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: August 25, 2026</p>
      <div className="mt-8 space-y-5 text-sm leading-7 text-slate-300">
        <p>
          InstaDM Auto only uses Meta Graph API private replies, Instagram messaging, and signed webhooks.
          There is no unofficial mobile API, no follower scraping, and no silent follow detection.
        </p>
        <section>
          <h2 className="text-lg font-semibold text-white">What Instagram does not allow us to do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>There is no production “user followed you” webhook.</li>
            <li>We cannot look up whether a random commenter currently follows the professional account.</li>
            <li>A comment may receive only one private reply. Later messages need the IGSID and a recent user action.</li>
            <li>Messaging is rate-limited. “Unlimited DMs” is not a realistic product claim.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">Follow-gate honesty</h2>
          <p>
            The follow gate is an honor system: we ask the person to follow, then they tap <strong>I Followed</strong> or reply DONE.
            Clicking “Visit profile” is not treated as a follow. Some people will confirm without following.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">Ban and restriction risk</h2>
          <p>
            Professional accounts can still be restricted if templates look like spam, if you trigger on every comment at high volume,
            or if recipients report the conversation. Keep keywords specific, pause automations that misfire, and never promise
            that Meta will not act on the connected account.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">Safe operating defaults</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Prefer keyword triggers over “any comment”.</li>
            <li>Deliver one resource per user unless they ask again.</li>
            <li>Stay inside the published monthly DM quota for your plan.</li>
            <li>Use the emergency pause switch if Meta returns rate-limit errors.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
