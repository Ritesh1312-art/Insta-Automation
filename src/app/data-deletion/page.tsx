import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Data Deletion Instructions | InstaDM Auto' };

export default function DataDeletionPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold">Data Deletion Instructions</h1>
      <div className="mt-8 space-y-4 leading-7">
        <p>To request deletion of data associated with InstaDM Auto, email <a className="text-fuchsia-700 underline" href="mailto:ritesh.gupta131290@gmail.com?subject=InstaDM%20Auto%20data%20deletion%20request">ritesh.gupta131290@gmail.com</a> from the email address linked to your Facebook or Instagram account.</p>
        <p>Include the Facebook Page name and Instagram username to identify the connected account. We will confirm receipt, disconnect the account, and delete stored connection tokens and automation data unless retention is required by law.</p>
      </div>
    </main>
  );
}
