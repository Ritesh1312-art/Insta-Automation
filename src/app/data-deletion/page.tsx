import type { Metadata } from 'next';
import { DATA_DELETION_COMPLETED, DATA_DELETION_FAILED, getDataDeletionStatus, type DataDeletionStatus } from '@/lib/meta-data-deletion';

export const metadata: Metadata = { title: 'Data Deletion Instructions | InstaDM Auto' };
// The confirmation code is verified against the deletion record on every load.
export const dynamic = 'force-dynamic';

const CONTACT_EMAIL = 'ritesh.gupta131290@gmail.com';

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Renders only counts and dates. The Meta user id, Instagram account id,
 * usernames, and any workspace email stay server-side: a confirmation code is a
 * shareable URL, so the page it opens must not leak PII.
 */
function DeletionStatusPanel({ status }: { status: DataDeletionStatus }) {
  const completedAt = formatDate(status.completedAt);
  const { deleted } = status;

  if (status.status === DATA_DELETION_FAILED) {
    return (
      <section className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-900">
        <h2 className="font-semibold">Deletion could not be completed</h2>
        <p className="mt-1 text-sm">
          Your request (confirmation code <strong>{status.confirmationCode}</strong>) is recorded, but the stored Meta data
          could not be removed. Nothing has been reported as deleted. Email{' '}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}?subject=InstaDM%20Auto%20data%20deletion%20follow-up`}>{CONTACT_EMAIL}</a>{' '}
          with this code and we will complete the deletion manually.
        </p>
      </section>
    );
  }

  if (status.status !== DATA_DELETION_COMPLETED) {
    return (
      <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <h2 className="font-semibold">Deletion is still in progress</h2>
        <p className="mt-1 text-sm">
          Confirmation code <strong>{status.confirmationCode}</strong> was received
          {formatDate(status.requestedAt) ? ` on ${formatDate(status.requestedAt)}` : ''} and is being processed. Reload this
          page to see the final status.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
      <h2 className="font-semibold">Deletion completed</h2>
      <p className="mt-1 text-sm">
        The Meta data stored for the requesting Meta account was deleted
        {completedAt ? ` on ${completedAt}` : ''}. Confirmation code: <strong>{status.confirmationCode}</strong>
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        <li>{deleted.connections} connected Instagram/Facebook connection(s)</li>
        <li>{deleted.automations} automation(s)</li>
        <li>{deleted.media} synced post(s)</li>
        <li>{deleted.contacts} contact record(s)</li>
        <li>{deleted.webhookEvents} received webhook event(s)</li>
      </ul>
      {deleted.connections === 0 && (
        <p className="mt-2 text-sm">No connection was stored for this Meta account, so there was nothing left to delete.</p>
      )}
    </section>
  );
}

function UnverifiedCodePanel({ code }: { code: string }) {
  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <h2 className="font-semibold">Confirmation code not verified</h2>
      <p className="mt-1 text-sm">
        No deletion request matches the code <strong>{code}</strong>. This page cannot confirm that any data was deleted. Use
        the confirmation code from your request, or email{' '}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}?subject=InstaDM%20Auto%20data%20deletion%20request`}>{CONTACT_EMAIL}</a>{' '}
        to ask about a specific request.
      </p>
    </section>
  );
}

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ confirmation?: string }> }) {
  const { confirmation } = await searchParams;
  const code = typeof confirmation === 'string' ? confirmation.trim() : '';

  // A query parameter alone proves nothing: the code only gets a verified panel
  // when it matches a stored deletion request.
  let status: DataDeletionStatus | null = null;
  let lookupFailed = false;
  if (code) {
    try {
      status = await getDataDeletionStatus(code);
    } catch {
      lookupFailed = true;
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold">Data Deletion Instructions</h1>
      <div className="mt-8 space-y-4 leading-7">
        {code && (status
          ? <DeletionStatusPanel status={status} />
          : lookupFailed
            ? (
              <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
                <h2 className="font-semibold">Status temporarily unavailable</h2>
                <p className="mt-1 text-sm">
                  We could not verify the confirmation code right now. Nothing is confirmed by this page load — please reload
                  in a few minutes or email{' '}
                  <a className="underline" href={`mailto:${CONTACT_EMAIL}?subject=InstaDM%20Auto%20data%20deletion%20request`}>{CONTACT_EMAIL}</a>.
                </p>
              </section>
            )
            : <UnverifiedCodePanel code={code} />)}
        <p>To request deletion of data associated with InstaDM Auto, email <a className="text-fuchsia-700 underline" href={`mailto:${CONTACT_EMAIL}?subject=InstaDM%20Auto%20data%20deletion%20request`}>{CONTACT_EMAIL}</a> from the email address linked to your Facebook or Instagram account.</p>
        <p>Include the Facebook Page name and Instagram username to identify the connected account. We will confirm receipt, disconnect the account, and delete stored connection tokens and automation data unless retention is required by law.</p>
      </div>
    </main>
  );
}
