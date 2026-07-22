import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | InstaDM Auto',
  description: 'Privacy policy for InstaDM Auto.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: July 23, 2026</p>

      <section className="mt-8 space-y-4 leading-7">
        <p>
          InstaDM Auto helps Instagram professional accounts manage comment-triggered direct-message automations through Meta&apos;s official APIs.
        </p>
        <div>
          <h2 className="text-xl font-semibold">Information we process</h2>
          <p>We process the Meta account, Page, and Instagram professional-account identifiers required to connect the service, along with comment events and automation settings needed to deliver the configured response.</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">How information is used</h2>
          <p>Information is used only to authenticate the connected account, evaluate enabled automations, send requested Instagram Direct Messages, maintain audit logs, and secure the service.</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Storage and security</h2>
          <p>Connection tokens are encrypted before storage. Access is restricted to authenticated administrators. We do not sell personal information or use Meta data for advertising.</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Retention and deletion</h2>
          <p>Data is retained only while it is needed to operate the connected automation. An administrator can disconnect the account and request deletion of stored connection data by contacting the service owner.</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Contact</h2>
          <p>For privacy questions or deletion requests, contact <a className="text-fuchsia-700 underline" href="mailto:ritesh.gupta131290@gmail.com">ritesh.gupta131290@gmail.com</a>.</p>
        </div>
      </section>
    </main>
  );
}
