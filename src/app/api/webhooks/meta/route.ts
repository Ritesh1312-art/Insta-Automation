import { after, NextRequest, NextResponse } from 'next/server';
import { WebhookService } from '@/services/webhooks/WebhookService';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const challenge = WebhookService.verifyChallenge(
    params.get('hub.mode'),
    params.get('hub.verify_token'),
    params.get('hub.challenge'),
  );
  if (challenge) return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const declaredSize = Number.parseInt(req.headers.get('content-length') || '0', 10);
    if (declaredSize > 1_000_000) return NextResponse.json({ error: 'Webhook payload too large' }, { status: 413 });

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 1_000_000) return NextResponse.json({ error: 'Webhook payload too large' }, { status: 413 });
    if (!WebhookService.verifySignature(rawBody, req.headers.get('x-hub-signature-256'))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const parsedBody: unknown = JSON.parse(rawBody);
    const commentEvents = WebhookService.parseCommentEvents(parsedBody);
    const messagingEvents = WebhookService.parseMessagingEvents(parsedBody);
    const [storedComments, storedMessages] = await Promise.all([
      Promise.all(commentEvents.map((event) => AutomationEngine.ingestCommentEvent(event))),
      Promise.all(messagingEvents.map((event) => AutomationEngine.ingestMessagingEvent(event))),
    ]);
    const stored = [...storedComments, ...storedMessages];

    // Next's after() is supported by both Node and Cloudflare OpenNext. Every
    // item is persisted first, so the retry job can recover interrupted work.
    after(async () => {
      await Promise.allSettled(stored.map((event) => AutomationEngine.processWebhookEvent(event.id)));
    });

    return NextResponse.json({
      status: 'RECEIVED',
      commentEventCount: storedComments.length,
      messagingEventCount: storedMessages.length,
    });
  } catch (error) {
    console.error('Meta webhook receiver error:', error);
    return NextResponse.json({ error: 'Unable to receive webhook' }, { status: 500 });
  }
}
