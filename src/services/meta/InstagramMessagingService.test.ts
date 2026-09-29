import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramMessagingService } from './InstagramMessagingService';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InstagramMessagingService', () => {
  it('sends private comment replies through the Instagram account endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message_id: 'message-1' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(InstagramMessagingService.sendPrivateReply({
      instagramAccountId: 'ig-account', commentId: 'comment-1', messageText: 'Hello', accessToken: 'token',
    })).resolves.toEqual({ success: true, responseId: 'message-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/ig-account/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ recipient: { comment_id: 'comment-1' }, message: { text: 'Hello' } }),
      }),
    );
  });

  it.each([
    [429, { error: { code: 613, message: 'Slow down' } }, 'RATE_LIMIT'],
    [401, { error: { code: 190, message: 'Bad token' } }, 'AUTHENTICATION'],
    [403, { error: { code: 10, message: 'Missing permission' } }, 'PERMISSION'],
    [500, { error: { code: 2, message: 'Temporary' } }, 'TRANSIENT'],
    [400, { error: { code: 100, message: 'Bad input' } }, 'VALIDATION'],
  ])('classifies Meta status %s failures', async (status, body, category) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)));
    const result = await InstagramMessagingService.sendDirectMessage({
      instagramAccountId: 'ig', recipientId: 'person', messageText: 'Hi', accessToken: 'token',
    });
    expect(result).toMatchObject({ success: false, errorCategory: category });
  });

  it('classifies transport failures as transient', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket closed')));
    await expect(InstagramMessagingService.sendDirectMessage({
      instagramAccountId: 'ig', recipientId: 'person', messageText: 'Hi', accessToken: 'token',
    })).resolves.toMatchObject({ success: false, errorCategory: 'TRANSIENT', errorMessage: 'socket closed' });
  });

  it('resolves canonical comment details for Page feed events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      id: 'comment', text: 'PROMPT', media: { id: 'ig-media' }, from: { id: 'person', username: 'fan' },
    })));
    await expect(InstagramMessagingService.getCommentDetails('comment', 'token')).resolves.toEqual({
      mediaId: 'ig-media', text: 'PROMPT', commenterId: 'person', commenterUsername: 'fan',
    });
  });

  it('reads the live follow relationship from the IGSID profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      username: 'fan', name: 'Fan', is_user_follow_business: true,
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(InstagramMessagingService.getUserProfile('person', 'token')).resolves.toEqual({
      username: 'fan', name: 'Fan', isUserFollowingBusiness: true,
    });
    expect(fetchMock.mock.calls[0][0]).toContain('is_user_follow_business');
  });

  it('returns null for unavailable profiles without leaking errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 404)));
    await expect(InstagramMessagingService.getUserProfile('person', 'token')).resolves.toBeNull();
  });
});
