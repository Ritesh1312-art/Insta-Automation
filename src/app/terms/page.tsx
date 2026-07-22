import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service | InstaDM Auto' };

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: July 23, 2026</p>
      <div className="mt-8 space-y-4 leading-7">
        <p>InstaDM Auto provides tools for authorized Instagram professional-account automation through Meta&apos;s official APIs.</p>
        <p>You must use the service only for accounts you are authorized to manage and comply with Meta&apos;s Platform Terms, Instagram Terms of Use, and all applicable laws.</p>
        <p>You are responsible for the automation rules, message content, consent, and audience choices you configure. Do not use the service for spam, harassment, or prohibited data collection.</p>
        <p>The service may be suspended when use violates these terms or Meta platform policies.</p>
        <p>Questions about these terms can be sent to <a className="text-fuchsia-700 underline" href="mailto:ritesh.gupta131290@gmail.com">ritesh.gupta131290@gmail.com</a>.</p>
      </div>
    </main>
  );
}
