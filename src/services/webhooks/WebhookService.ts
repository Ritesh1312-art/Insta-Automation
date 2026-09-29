import crypto from 'crypto';

export type ParsedCommentEvent = {
  instagramAccountId: string;
  mediaId: string;
  commentId: string;
  commenterId: string;
  commenterUsername: string;
  commentText: string;
  rawPayload: unknown;
};

export type ParsedMessagingEvent = {
  eventId: string;
  instagramAccountId: string;
  senderId: string;
  postbackPayload: string;
  rawPayload: unknown;
};

function stableEventId(parts: unknown[]) {
  return `messaging:${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

export class WebhookService {
  private static get appSecret() {
    return process.env.META_APP_SECRET || '';
  }

  public static verifyChallenge(mode: string | null, token: string | null, challenge: string | null): string | null {
    const expectedToken = process.env.META_VERIFY_TOKEN;
    if (mode === 'subscribe' && challenge && expectedToken && token === expectedToken) return challenge;
    return null;
  }

  public static verifySignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!this.appSecret || !signatureHeader?.startsWith('sha256=')) return false;
    const expectedSignature = signatureHeader.slice('sha256='.length);
    if (!/^[a-f0-9]{64}$/i.test(expectedSignature)) return false;
    const computedHmac = crypto.createHmac('sha256', this.appSecret).update(rawBody, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHmac, 'hex'), Buffer.from(expectedSignature, 'hex'));
  }

  /** Parses official Instagram `comments` payloads and legacy Page feed comments. */
  public static parseCommentEvents(payload: any): ParsedCommentEvent[] {
    const events: ParsedCommentEvent[] = [];
    if (!Array.isArray(payload?.entry)) return events;

    for (const entry of payload.entry) {
      if (!Array.isArray(entry?.changes)) continue;
      for (const change of entry.changes) {
        const val = change?.value;
        if (!val) continue;

        if (change.field === 'comments') {
          const mediaId = String(val.media?.id || val.media_id || '');
          const commentId = String(val.id || '');
          if (!commentId || !mediaId) continue;
          events.push({
            instagramAccountId: String(val.recipient_id || entry.id || ''),
            mediaId,
            commentId,
            commenterId: String(val.from?.id || val.from?.id_str || commentId),
            commenterUsername: typeof val.from?.username === 'string' ? val.from.username : '',
            commentText: typeof val.text === 'string' ? val.text : '',
            rawPayload: payload,
          });
          continue;
        }

        // Some Facebook-Login installations also deliver linked-account comments
        // through the Page `feed` field. Account-wide automations can process these.
        if (change.field === 'feed' && val.item === 'comment' && val.verb === 'add') {
          const commentId = String(val.comment_id || val.id || '');
          const mediaId = String(val.media_id || val.post_id || '');
          if (!commentId || !mediaId) continue;
          events.push({
            instagramAccountId: String(entry.id || ''),
            mediaId,
            commentId,
            commenterId: String(val.sender_id || commentId),
            commenterUsername: typeof val.sender_name === 'string' ? val.sender_name : '',
            commentText: typeof val.message === 'string' ? val.message : '',
            rawPayload: payload,
          });
        }
      }
    }

    return Array.from(new Map(events.map((event) => [`${event.instagramAccountId}:${event.commentId}`, event])).values());
  }

  public static parseMessagingEvents(payload: any): ParsedMessagingEvent[] {
    const events: ParsedMessagingEvent[] = [];
    if (!Array.isArray(payload?.entry)) return events;

    for (const entry of payload.entry) {
      const entryAccountId = String(entry?.id || '');
      if (Array.isArray(entry?.messaging)) {
        for (const msg of entry.messaging) {
          if (msg?.message?.is_echo) continue;
          const senderId = String(msg?.sender?.id || msg?.sender?.id_str || '');
          const recipientId = String(msg?.recipient?.id || entryAccountId);
          if (!senderId || senderId === recipientId) continue;
          const postbackPayload = msg?.postback?.payload || msg?.postback?.title
            || msg?.message?.quick_reply?.payload || msg?.message?.text;
          if (typeof postbackPayload !== 'string' || !postbackPayload.trim()) continue;
          const metaId = msg?.message?.mid || msg?.postback?.mid;
          events.push({
            eventId: metaId ? `messaging:${metaId}` : stableEventId([entryAccountId, senderId, msg?.timestamp, postbackPayload]),
            instagramAccountId: recipientId,
            senderId,
            postbackPayload,
            rawPayload: payload,
          });
        }
      }

      if (Array.isArray(entry?.changes)) {
        for (const change of entry.changes) {
          if (change?.field !== 'messages' && change?.field !== 'messaging_postbacks') continue;
          const val = change.value;
          if (!val || val.message?.is_echo) continue;
          const senderId = String(val.sender?.id || val.from?.id || val.from?.id_str || '');
          const recipientId = String(val.recipient?.id || entryAccountId);
          const postbackPayload = val.postback?.payload || val.postback?.title
            || val.message?.quick_reply?.payload || val.message?.text;
          if (!senderId || senderId === recipientId || typeof postbackPayload !== 'string' || !postbackPayload.trim()) continue;
          const metaId = val.message?.mid || val.postback?.mid;
          events.push({
            eventId: metaId ? `messaging:${metaId}` : stableEventId([entryAccountId, senderId, val.timestamp, postbackPayload]),
            instagramAccountId: recipientId,
            senderId,
            postbackPayload,
            rawPayload: payload,
          });
        }
      }
    }

    return Array.from(new Map(events.map((event) => [event.eventId, event])).values());
  }

  public static parseReferralEvents(payload: any): Array<{ instagramAccountId: string; senderId: string; rawPayload: unknown }> {
    const events: Array<{ instagramAccountId: string; senderId: string; rawPayload: unknown }> = [];
    if (!Array.isArray(payload?.entry)) return events;
    for (const entry of payload.entry) {
      if (!Array.isArray(entry?.messaging)) continue;
      for (const msg of entry.messaging) {
        if (msg?.referral && msg?.sender?.id) {
          events.push({
            instagramAccountId: String(msg.recipient?.id || entry.id || ''),
            senderId: String(msg.sender.id),
            rawPayload: payload,
          });
        }
      }
    }
    return events;
  }
}
