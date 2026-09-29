import crypto from 'node:crypto';

export type CommentWebhookEvent = {
  instagramAccountId: string;
  mediaId: string;
  commentId: string;
  commenterId: string;
  commenterUsername: string;
  commentText: string;
  rawPayload: unknown;
};

export type MessagingWebhookEvent = {
  instagramAccountId: string;
  senderId: string;
  postbackPayload: string;
  interactionType: 'POSTBACK' | 'QUICK_REPLY' | 'TEXT';
  rawPayload: unknown;
};

function asArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
    : [];
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
    const received = signatureHeader.slice('sha256='.length);
    if (!/^[a-fA-F0-9]{64}$/.test(received)) return false;

    const computed = crypto.createHmac('sha256', this.appSecret).update(rawBody, 'utf8').digest();
    return crypto.timingSafeEqual(computed, Buffer.from(received, 'hex'));
  }

  /** Supports both Instagram `comments` and Facebook Page `feed` comment payloads. */
  public static parseCommentEvents(payload: unknown): CommentWebhookEvent[] {
    const body = payload && typeof payload === 'object' ? payload as Record<string, any> : null;
    if (!body) return [];
    const events: CommentWebhookEvent[] = [];

    for (const entry of asArray(body.entry)) {
      const entryId = String(entry.id || '');
      if (!entryId) continue;

      for (const change of asArray(entry.changes)) {
        const value = change.value && typeof change.value === 'object' ? change.value : null;
        if (!value) continue;

        if (change.field === 'comments') {
          const mediaId = String(value.media?.id || value.media_id || '');
          const commentId = String(value.id || value.comment_id || '');
          if (!commentId || !mediaId) continue;
          events.push({
            instagramAccountId: String(value.recipient_id || entryId),
            mediaId,
            commentId,
            commenterId: String(value.from?.id || value.from?.id_str || commentId),
            commenterUsername: typeof value.from?.username === 'string' ? value.from.username : '',
            commentText: typeof value.text === 'string' ? value.text : '',
            rawPayload: payload,
          });
          continue;
        }

        // Page subscriptions emit comments under `feed`. Ignore edits/removals and
        // normalize them so global automations still work; the engine resolves the
        // canonical Instagram media ID from the comment before matching a post.
        if (change.field === 'feed' && value.item === 'comment' && (!value.verb || value.verb === 'add')) {
          const mediaId = String(value.media?.id || value.media_id || value.post_id || '');
          const commentId = String(value.comment_id || value.id || '');
          if (!commentId || !mediaId) continue;
          events.push({
            instagramAccountId: String(value.recipient_id || entryId),
            mediaId,
            commentId,
            commenterId: String(value.from?.id || value.sender_id || commentId),
            commenterUsername: typeof value.from?.username === 'string' ? value.from.username : '',
            commentText: typeof value.message === 'string' ? value.message : typeof value.text === 'string' ? value.text : '',
            rawPayload: payload,
          });
        }
      }
    }

    return events;
  }

  public static parseMessagingEvents(payload: unknown): MessagingWebhookEvent[] {
    const body = payload && typeof payload === 'object' ? payload as Record<string, any> : null;
    if (!body) return [];
    const events: MessagingWebhookEvent[] = [];

    for (const entry of asArray(body.entry)) {
      const entryId = String(entry.id || '');
      if (!entryId) continue;

      for (const message of asArray(entry.messaging)) {
        if (message.message?.is_echo) continue;
        const senderId = String(message.sender?.id || message.sender?.id_str || '');
        const recipientId = String(message.recipient?.id || entryId);
        const interactionType: MessagingWebhookEvent['interactionType'] = message.postback?.payload
          ? 'POSTBACK'
          : message.message?.quick_reply?.payload
            ? 'QUICK_REPLY'
            : 'TEXT';
        const action = message.postback?.payload
          || message.message?.quick_reply?.payload
          || message.message?.text;
        if (!senderId || !action || senderId === recipientId) continue;
        events.push({
          instagramAccountId: recipientId,
          senderId,
          postbackPayload: String(action),
          interactionType,
          rawPayload: payload,
        });
      }

      for (const change of asArray(entry.changes)) {
        if (change.field !== 'messages' && change.field !== 'messaging_postbacks') continue;
        const value = change.value && typeof change.value === 'object' ? change.value : null;
        if (!value || value.message?.is_echo) continue;
        const senderId = String(value.sender?.id || value.from?.id || value.from?.id_str || '');
        const recipientId = String(value.recipient?.id || entryId);
        const interactionType: MessagingWebhookEvent['interactionType'] = value.postback?.payload
          ? 'POSTBACK'
          : value.message?.quick_reply?.payload
            ? 'QUICK_REPLY'
            : 'TEXT';
        const action = value.postback?.payload
          || value.message?.quick_reply?.payload
          || value.message?.text;
        if (!senderId || !action || senderId === recipientId) continue;
        events.push({
          instagramAccountId: recipientId,
          senderId,
          postbackPayload: String(action),
          interactionType,
          rawPayload: payload,
        });
      }
    }

    return events;
  }
}
