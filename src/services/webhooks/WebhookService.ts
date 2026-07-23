import crypto from 'crypto';

export class WebhookService {
  private static get verifyToken() {
    return process.env.META_VERIFY_TOKEN || 'my_custom_webhook_verify_token_123';
  }
  private static get appSecret() {
    return process.env.META_APP_SECRET || '';
  }

  /**
   * Validates Meta Webhook Verification Challenge (GET)
   */
  public static verifyChallenge(mode: string | null, token: string | null, challenge: string | null): string | null {
    if (mode === 'subscribe' && token === this.verifyToken && challenge) {
      return challenge;
    }
    return null;
  }

  /**
   * Validates x-hub-signature-256 header using HMAC-SHA256
   */
  public static verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    if (!this.appSecret) return false;

    const expectedSignature = signatureHeader.split('sha256=')[1];
    const computedHmac = crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(computedHmac, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch {
      return false;
    }
  }

  /**
   * Normalizes raw Meta webhook payload into standardized comment events
   */
  public static parseCommentEvents(payload: any): Array<{
    instagramAccountId: string;
    mediaId: string;
    commentId: string;
    commenterId: string;
    commenterUsername: string;
    commentText: string;
    rawPayload: any;
  }> {
    const events: Array<any> = [];

    if (!payload || !payload.entry) return events;

    for (const entry of payload.entry) {
      const instagramAccountId = entry.id;

      // Handle direct Instagram webhook changes
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'comments' && change.value) {
            const val = change.value;
            const mediaId = String(val.media?.id || val.media_id || '');
            const commentId = String(val.id || '');
            const commenterId = String(val.from?.id || val.from?.id_str || commentId);
            if (!commentId || !mediaId) continue;
            events.push({
              instagramAccountId: String(val.recipient_id || instagramAccountId),
              mediaId,
              commentId,
              commenterId,
              commenterUsername: typeof val.from?.username === 'string' ? val.from.username : '',
              commentText: typeof val.text === 'string' ? val.text : '',
              rawPayload: payload,
            });
          }
        }
      }
    }

    return events;
  }

  public static parseMessagingEvents(payload: any): Array<{
    instagramAccountId: string;
    senderId: string;
    postbackPayload: string;
    rawPayload: any;
  }> {
    const events: Array<any> = [];
    if (!payload || !payload.entry) return events;
    for (const entry of payload.entry) {
      const instagramAccountId = entry.id;
      if (entry.messaging) {
        for (const msg of entry.messaging) {
          if (msg.postback && msg.postback.payload) {
            events.push({
              instagramAccountId: msg.recipient?.id || instagramAccountId,
              senderId: msg.sender?.id,
              postbackPayload: msg.postback.payload,
              rawPayload: payload,
            });
          }
        }
      }
    }
    return events;
  }
}
