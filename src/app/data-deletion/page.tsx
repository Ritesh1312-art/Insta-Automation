import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Data Deletion Instructions | InstaDM Auto' };

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ confirmation?: string }> }) {
  const { confirmation } = await searchParams;
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold">Data Deletion Instructions</h1>
      <div className="mt-8 space-y-4 leading-7">
        {confirmation && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">Your automated Meta data deletion request has been received. Confirmation code: <strong>{confirmation}</strong></p>}
        <p>To request deletion of data associated with InstaDM Auto, email <a className="text-fuchsia-700 underline" href="mailto:ritesh.gupta131290@gmail.com?subject=InstaDM%20Auto%20data%20deletion%20request">ritesh.gupta131290@gmail.com</a> from the email address linked to your Facebook or Instagram account.</p>
        <p>Include the Facebook Page name and Instagram username to identify the connected account. We will confirm receipt, disconnect the account, and delete stored connection tokens and automation data unless retention is required by law.</p>
      </div>
    </main>
  );
}
