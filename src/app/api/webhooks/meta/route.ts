import { NextRequest, NextResponse } from 'next/server';
import { WebhookService } from '@/services/webhooks/WebhookService';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

/**
 * GET /api/webhooks/meta
 * Meta Webhook Challenge Verification
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifiedChallenge = WebhookService.verifyChallenge(mode, token, challenge);

  if (verifiedChallenge) {
    console.log('✅ [META WEBHOOK VERIFIED] Subscription challenge verified successfully.');
    return new NextResponse(verifiedChallenge, { status: 200 });
  } else {
    console.error('❌ [META WEBHOOK VERIFICATION FAILED] Token mismatch or invalid request');
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
  }
}

/**
 * POST /api/webhooks/meta
 * Meta Event Delivery Receiver
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    // 1. Verify HMAC-SHA256 signature
    const isValid = WebhookService.verifySignature(rawBody, signature);
    if (!isValid) {
      console.error('❌ [META WEBHOOK SIGNATURE INVALID] Rejected unauthorized webhook payload');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    // 2. Parse & normalize comment events
    const events = WebhookService.parseCommentEvents(payload);

    if (events.length === 0) {
      return NextResponse.json({ status: 'NO_EVENTS_PARSED' }, { status: 200 });
    }

    // 3. Process events asynchronously in background & return 200 OK fast
    (async () => {
      for (const event of events) {
        try {
          const result = await AutomationEngine.processCommentEvent(event);
          console.log(`⚡ [AUTOMATION ENGINE RESULT] ${result.status}: ${result.message}`);
        } catch (err: any) {
          console.error('💥 [AUTOMATION ENGINE ERROR]', err);
        }
      }
    })();

    // Meta expects HTTP 200 OK within 5 seconds (we acknowledge in < 50ms!)
    return NextResponse.json({ status: 'RECEIVED', eventCount: events.length }, { status: 200 });
  } catch (error: any) {
    console.error('❌ [WEBHOOK RECEIVER ERROR]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
