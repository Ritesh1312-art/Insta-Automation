import { after, NextRequest, NextResponse } from 'next/server';
import { WebhookService } from '@/services/webhooks/WebhookService';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const challenge = WebhookService.verifyChallenge(params.get('hub.mode'), params.get('hub.verify_token'), params.get('hub.challenge'));
  if (challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 1_000_000) return NextResponse.json({ error: 'Webhook payload too large' }, { status: 413 });
    if (!WebhookService.verifySignature(rawBody, req.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

    const parsedBody = JSON.parse(rawBody);

    // 1. Process Comment Webhook Events
    const commentEvents = WebhookService.parseCommentEvents(parsedBody);
    const storedComments = await Promise.all(commentEvents.map((event) => AutomationEngine.ingestCommentEvent(event)));
    after(async () => {
      await Promise.allSettled(storedComments.map((event: { id: string }) => AutomationEngine.processWebhookEvent(event.id)));
    });

    // Persist actionable messaging events before acknowledgement. Only the
    // action token is retained; ordinary conversations are intentionally ignored.
    const messagingEvents = WebhookService.parseMessagingEvents(parsedBody);
    const storedMessaging = await Promise.all(messagingEvents.map((event) => AutomationEngine.ingestMessagingEvent(event)));
    after(async () => {
      await Promise.allSettled(storedMessaging.map((event: { id: string }) => AutomationEngine.processMessagingEvent(event.id)));
    });
    return NextResponse.json({ status: 'RECEIVED', commentEventCount: storedComments.length, messagingEventCount: storedMessaging.length });
  } catch (error) {
    console.error('Meta webhook receiver error:', error);
    return NextResponse.json({ error: 'Unable to receive webhook' }, { status: 500 });
  }
}
