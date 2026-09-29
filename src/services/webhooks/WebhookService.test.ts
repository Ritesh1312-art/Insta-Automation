import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WebhookService } from './WebhookService';

describe('WebhookService', () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = 'meta-secret';
    process.env.META_VERIFY_TOKEN = 'verify-me';
  });

  it('verifies Meta challenges only with the configured token', () => {
    expect(WebhookService.verifyChallenge('subscribe', 'verify-me', '123')).toBe('123');
    expect(WebhookService.verifyChallenge('subscribe', 'wrong', '123')).toBeNull();
    expect(WebhookService.verifyChallenge('unsubscribe', 'verify-me', '123')).toBeNull();
  });

  it('validates an exact sha256 signature and rejects malformed values', () => {
    const body = '{"object":"instagram"}';
    const signature = createHmac('sha256', 'meta-secret').update(body).digest('hex');
    expect(WebhookService.verifySignature(body, `sha256=${signature}`)).toBe(true);
    expect(WebhookService.verifySignature(`${body} `, `sha256=${signature}`)).toBe(false);
    expect(WebhookService.verifySignature(body, 'sha256=not-hex')).toBe(false);
    expect(WebhookService.verifySignature(body, null)).toBe(false);
  });

  it('normalizes direct Instagram comment events', () => {
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'ig-1',
        changes: [{ field: 'comments', value: {
          id: 'comment-1', text: 'PROMPT', media: { id: 'media-1' },
          from: { id: 'person-1', username: 'creator_fan' },
        } }],
      }],
    };
    expect(WebhookService.parseCommentEvents(payload)).toEqual([expect.objectContaining({
      instagramAccountId: 'ig-1', mediaId: 'media-1', commentId: 'comment-1',
      commenterId: 'person-1', commenterUsername: 'creator_fan', commentText: 'PROMPT',
    })]);
  });

  it('normalizes Page feed comments and ignores removals', () => {
    const add = {
      entry: [{ id: 'page-1', changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', post_id: 'page-post', comment_id: 'comment-2',
        message: 'LINK', from: { id: 'person-2' },
      } }] }],
    };
    expect(WebhookService.parseCommentEvents(add)[0]).toMatchObject({
      instagramAccountId: 'page-1', mediaId: 'page-post', commentId: 'comment-2',
      commenterId: 'person-2', commentText: 'LINK',
    });
    add.entry[0].changes[0].value.verb = 'remove';
    expect(WebhookService.parseCommentEvents(add)).toEqual([]);
  });

  it('distinguishes postbacks, quick replies, and text and ignores echoes', () => {
    const make = (message: Record<string, unknown>) => ({
      entry: [{ id: 'page-1', messaging: [{ sender: { id: 'person' }, recipient: { id: 'page-1' }, ...message }] }],
    });
    expect(WebhookService.parseMessagingEvents(make({ postback: { payload: 'CONFIRM_FOLLOW_a' } }))[0].interactionType).toBe('POSTBACK');
    expect(WebhookService.parseMessagingEvents(make({ message: { quick_reply: { payload: 'DELIVER_RESOURCE_a' } } }))[0].interactionType).toBe('QUICK_REPLY');
    expect(WebhookService.parseMessagingEvents(make({ message: { text: 'DONE' } }))[0]).toMatchObject({ interactionType: 'TEXT', postbackPayload: 'DONE' });
    expect(WebhookService.parseMessagingEvents(make({ message: { text: 'DONE', is_echo: true } }))).toEqual([]);
  });

  it('handles malformed payloads without throwing', () => {
    expect(WebhookService.parseCommentEvents(null)).toEqual([]);
    expect(WebhookService.parseCommentEvents({ entry: 'bad' })).toEqual([]);
    expect(WebhookService.parseMessagingEvents({ entry: [{}] })).toEqual([]);
  });
});
