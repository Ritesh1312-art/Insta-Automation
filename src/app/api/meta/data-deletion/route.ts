import { NextRequest, NextResponse } from 'next/server';
import { parseMetaSignedRequest } from '@/lib/meta-signed-request';
import { processMetaDataDeletion } from '@/lib/meta-data-deletion';
import { safeErrorMessage } from '@/lib/safe-error';

export const runtime = 'nodejs';

function readSignedRequest(body: string, contentType: string | null): string | null {
  if (contentType?.includes('application/json')) {
    try {
      const parsed = JSON.parse(body) as { signed_request?: unknown };
      return typeof parsed.signed_request === 'string' ? parsed.signed_request : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(body).get('signed_request');
}

function statusUrlFor(requestUrl: string, confirmationCode: string) {
  const appUrl = process.env.APP_URL;
  return appUrl?.startsWith('https://')
    ? `${appUrl}/data-deletion?confirmation=${encodeURIComponent(confirmationCode)}`
    : new URL(`/data-deletion?confirmation=${encodeURIComponent(confirmationCode)}`, requestUrl).toString();
}

export async function POST(req: NextRequest) {
  try {
    const signedRequest = readSignedRequest(await req.text(), req.headers.get('content-type'));
    const payload = signedRequest ? parseMetaSignedRequest(signedRequest) : null;
    if (!payload?.user_id) return NextResponse.json({ error: 'Invalid signed request' }, { status: 403 });

    // Deletes the MetaConnection(s) of this Meta user; everything related to
    // them (media, automations, runs, contacts, webhook events) goes with them
    // through the schema's cascades. Retries reuse the same confirmation code
    // and counts, so repeated callbacks stay idempotent.
    const deletion = await processMetaDataDeletion(payload.user_id);
    return NextResponse.json({
      url: statusUrlFor(req.url, deletion.confirmationCode),
      confirmation_code: deletion.confirmationCode,
    });
  } catch (error) {
    // Never log the raw error: Prisma errors can echo deleted row data and the
    // callback body carries a signed request. processMetaDataDeletion has
    // already persisted FAILED for this Meta user, so the status page can never
    // claim a deletion that did not happen, and the 5xx makes Meta retry.
    console.error('Meta data deletion callback failed:', safeErrorMessage(error));
    return NextResponse.json({ error: 'Unable to process deletion request' }, { status: 500 });
  }
}
