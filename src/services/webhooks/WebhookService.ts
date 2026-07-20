import crypto from 'crypto';

export class WebhookService {
  private static verifyToken = process.env.META_VERIFY_TOKEN || 'my_custom_webhook_verify_token_123';
  private static appSecret = process.env.META_APP_SECRET || 'mock_meta_app_secret_12345';

  /**
   * Validates Meta Webhook Verification Challenge (GET)
   */
  public static verifyChallenge(mode: string | null, token: string | null, challenge: string | null): string | null {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Validates x-hub-signature-256 header using HMAC-SHA256
   */
  public static verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (process.env.META_API_MOCK === 'true') {
      return true; // Bypass signature check in dev mock mode
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

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
            events.push({
              instagramAccountId: val.recipient_id || instagramAccountId,
              mediaId: val.media?.id || val.media_id,
              commentId: val.id,
              commenterId: val.from?.id || 'ig_user_unknown',
              commenterUsername: val.from?.username || 'instagram_user',
              commentText: val.text || '',
              rawPayload: payload,
            });
          }
        }
      }
    }

    return events;
  }
}
