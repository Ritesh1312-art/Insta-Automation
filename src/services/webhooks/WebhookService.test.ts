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

  it('carries Meta stable message ids and timestamps for dedup', () => {
    const payload = {
      object: 'instagram',
      entry: [{ id: 'page-1', messaging: [
        { sender: { id: 'fan' }, recipient: { id: 'page-1' }, timestamp: 1727000000123, message: { mid: 'mid.$A', text: 'send' } },
        { sender: { id: 'fan' }, recipient: { id: 'page-1' }, timestamp: 1727000099456, message: { mid: 'mid.$B', text: 'send' } },
        { sender: { id: 'fan' }, recipient: { id: 'page-1' }, timestamp: 1727000010000, postback: { mid: 'mid.$C', payload: 'CONFIRM_FOLLOW_a' } },
      ] }],
    };
    const events = WebhookService.parseMessagingEvents(payload);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.providerEventId)).toEqual(['mid.$A', 'mid.$B', 'mid.$C']);
    expect(events[0].occurredAt).toBe(1727000000123);
    // Two separate identical texts keep distinct provider ids; the engine must not collapse them.
    expect(events[0].providerEventId).not.toBe(events[1].providerEventId);
    expect(events[0].postbackPayload).toBe(events[1].postbackPayload);
  });

  it('reads Instagram change-shaped messaging payloads and skips self, echo, and non-actionable events', () => {
    const igChanges = {
      object: 'instagram',
      entry: [{ id: 'ig-1', time: 1727000000, changes: [
        { field: 'messages', value: { id: 'ig-event-1', from: { id: 'fan' }, to: { id: 'ig-1' }, message: { text: { body: 'send' } } } },
        // Echo of the bot's own reply must never re-enter the pipeline.
        { field: 'messages', value: { id: 'ig-event-echo', from: { id: 'ig-1' }, to: { id: 'fan' }, message: { is_echo: true, text: { body: 'bot says hi' } } } },
        // Non-actionable receipts and unrelated fields carry no text to process.
        { field: 'messages', value: { id: 'ig-event-read', from: { id: 'fan' }, to: { id: 'ig-1' }, read: { mid: 'x' } } },
        { field: 'others', value: { id: 'other' } },
      ] }],
    };
    const events = WebhookService.parseMessagingEvents(igChanges);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      instagramAccountId: 'ig-1', senderId: 'fan', postbackPayload: 'send',
      interactionType: 'TEXT', providerEventId: 'ig-event-1', occurredAt: 1727000000,
    });

    // The page acting as its own sender (echo loop) is ignored in the messaging shape too.
    const self = { entry: [{ id: 'page-1', messaging: [{ sender: { id: 'page-1' }, recipient: { id: 'page-1' }, message: { mid: 'm', text: 'loop' } }] }] };
    expect(WebhookService.parseMessagingEvents(self)).toEqual([]);

    // Malformed shapes never throw and never produce events.
    expect(WebhookService.parseMessagingEvents(undefined)).toEqual([]);
    expect(WebhookService.parseMessagingEvents('string')).toEqual([]);
    expect(WebhookService.parseMessagingEvents({ entry: [null, 'x', { id: '' }] })).toEqual([]);
    expect(WebhookService.parseMessagingEvents({ entry: [{ id: 'p', messaging: 'broken' }] })).toEqual([]);
    expect(WebhookService.parseMessagingEvents({ entry: [{ id: 'p', messaging: [{ sender: { id: 'fan' }, recipient: { id: 'p' }, message: { text: { nested: 'junk' } } }] }] })).toEqual([]);
  });

  it('handles malformed payloads without throwing', () => {
    expect(WebhookService.parseCommentEvents(null)).toEqual([]);
    expect(WebhookService.parseCommentEvents({ entry: 'bad' })).toEqual([]);
    expect(WebhookService.parseMessagingEvents({ entry: [{}] })).toEqual([]);
  });
});
