import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { WebhookService } from '@/services/webhooks/WebhookService';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const challenge = WebhookService.verifyChallenge(params.get('hub.mode'), params.get('hub.verify_token'), params.get('hub.challenge'));
  return challenge ? new NextResponse(challenge, { status: 200 }) : NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 1_000_000) return NextResponse.json({ error: 'Webhook payload too large' }, { status: 413 });
    if (!WebhookService.verifySignature(rawBody, req.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    const events = WebhookService.parseCommentEvents(JSON.parse(rawBody));
    const stored = await Promise.all(events.map((event) => AutomationEngine.ingestCommentEvent(event)));
    waitUntil(Promise.allSettled(stored.map((event) => AutomationEngine.processWebhookEvent(event.id))).then(() => undefined));
    return NextResponse.json({ status: 'RECEIVED', eventCount: stored.length });
  } catch (error) {
    console.error('Meta webhook receiver error:', error);
    return NextResponse.json({ error: 'Unable to receive webhook' }, { status: 500 });
  }
}
