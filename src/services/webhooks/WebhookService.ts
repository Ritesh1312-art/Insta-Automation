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
    const expectedToken = process.env.META_VERIFY_TOKEN;
    if (mode === 'subscribe' && challenge && expectedToken && token === expectedToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Validates x-hub-signature-256 header using HMAC-SHA256
   */
  public static verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!this.appSecret) return false;
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

    const expectedSignature = signatureHeader.split('sha256=')[1];
    const computedHmac = crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(computedHmac, 'hex'), Buffer.from(expectedSignature, 'hex'));
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

      // Structure 1: Direct Messaging Array
      if (entry.messaging) {
        for (const msg of entry.messaging) {
          const senderId = msg.sender?.id || msg.sender?.id_str;
          const postbackPayload = msg.postback?.payload || msg.postback?.title || msg.message?.quick_reply?.payload || msg.message?.text;
          if (senderId && postbackPayload) {
            events.push({
              instagramAccountId: msg.recipient?.id || instagramAccountId,
              senderId,
              postbackPayload,
              rawPayload: payload,
            });
          }
        }
      }

      // Structure 2: Entry Changes Array
      if (entry.changes) {
        for (const change of entry.changes) {
          if ((change.field === 'messages' || change.field === 'messaging_postbacks') && change.value) {
            const val = change.value;
            const senderId = val.sender?.id || val.from?.id || val.from?.id_str;
            const postbackPayload = val.postback?.payload || val.postback?.title || val.message?.text;
            if (senderId && postbackPayload) {
              events.push({
                instagramAccountId: String(val.recipient?.id || instagramAccountId),
                senderId: String(senderId),
                postbackPayload: String(postbackPayload),
                rawPayload: payload,
              });
            }
          }
        }
      }
    }
    return events;
  }

  public static parseReferralEvents(payload: any): Array<{
    instagramAccountId: string;
    senderId: string;
    rawPayload: any;
  }> {
    const events: Array<any> = [];
    if (!payload || !payload.entry) return events;
    for (const entry of payload.entry) {
      const instagramAccountId = entry.id;

      // messaging_referrals fires when user clicks a web_url button in DM
      if (entry.messaging) {
        for (const msg of entry.messaging) {
          if (msg.referral && msg.sender?.id) {
            events.push({
              instagramAccountId: msg.recipient?.id || instagramAccountId,
              senderId: msg.sender.id,
              rawPayload: payload,
            });
          }
        }
      }

      // Also check changes array for referral events  
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'messaging_referrals' && change.value) {
            const val = change.value;
            const senderId = val.sender?.id || val.from?.id;
            if (senderId) {
              events.push({
                instagramAccountId: String(val.recipient?.id || instagramAccountId),
                senderId: String(senderId),
                rawPayload: payload,
              });
            }
          }
        }
      }
    }
    return events;
  }
}
