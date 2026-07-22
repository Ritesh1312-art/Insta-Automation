import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { parseMetaSignedRequest } from '@/lib/meta-signed-request';

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

export async function POST(req: NextRequest) {
  try {
    const signedRequest = readSignedRequest(await req.text(), req.headers.get('content-type'));
    const payload = signedRequest ? parseMetaSignedRequest(signedRequest) : null;
    if (!payload?.user_id) return NextResponse.json({ error: 'Invalid signed request' }, { status: 403 });

    await prisma.metaConnection.deleteMany({ where: { metaUserId: payload.user_id } });
    const confirmationCode = crypto.randomUUID();
    const appUrl = process.env.APP_URL;
    const statusUrl = appUrl?.startsWith('https://')
      ? `${appUrl}/data-deletion?confirmation=${encodeURIComponent(confirmationCode)}`
      : new URL(`/data-deletion?confirmation=${encodeURIComponent(confirmationCode)}`, req.url).toString();

    return NextResponse.json({ url: statusUrl, confirmation_code: confirmationCode });
  } catch (error) {
    console.error('Meta data deletion callback failed:', error);
    return NextResponse.json({ error: 'Unable to process deletion request' }, { status: 500 });
  }
}
