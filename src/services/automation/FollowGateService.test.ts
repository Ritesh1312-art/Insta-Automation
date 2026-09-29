import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  release: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  sendPrivateTemplateReply: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendDirectTemplate: vi.fn(),
  sendDirectMessage: vi.fn(),
}));

vi.mock('@/lib/quota', () => ({ reserveDmQuota: mocks.reserve, releaseDmQuota: mocks.release }));
vi.mock('@/lib/prisma', () => ({ prisma: { contact: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));
vi.mock('@/services/meta/InstagramMessagingService', () => ({
  InstagramMessagingService: {
    sendPrivateTemplateReply: mocks.sendPrivateTemplateReply,
    sendPrivateReply: mocks.sendPrivateReply,
    sendDirectTemplate: mocks.sendDirectTemplate,
    sendDirectMessage: mocks.sendDirectMessage,
  },
}));

import { FollowGateService } from './FollowGateService';

const base = {
  instagramAccountId: 'ig-1', accessToken: 'token', automationId: 'auto-1', userId: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ ok: true, periodStart: new Date('2026-09-01'), usageAfter: 1 });
  mocks.release.mockResolvedValue(undefined);
  mocks.sendPrivateTemplateReply.mockResolvedValue({ success: true, responseId: 'private-template' });
  mocks.sendPrivateReply.mockResolvedValue({ success: true, responseId: 'private-text' });
  mocks.sendDirectTemplate.mockResolvedValue({ success: true, responseId: 'direct-template' });
  mocks.sendDirectMessage.mockResolvedValue({ success: true, responseId: 'direct-text' });
});

describe('FollowGateService delivery', () => {
  it('sends the initial comment welcome with a scoped access button', async () => {
    const result = await FollowGateService.sendAccessWelcome({
      ...base, mode: 'comment', commentId: 'comment-1', commenterUsername: 'fan',
    });
    expect(result).toEqual({ success: true, responseId: 'private-template' });
    expect(JSON.stringify(mocks.sendPrivateTemplateReply.mock.calls[0][0])).toContain('GET_ACCESS_auto-1');
    expect(JSON.stringify(mocks.sendPrivateTemplateReply.mock.calls[0][0])).toContain('Send me the Access');
  });

  it('reserves quota and sends a comment template with scoped postback payload', async () => {
    const result = await FollowGateService.sendFollowAsk({
      ...base, mode: 'comment', commentId: 'comment-1', igUsername: 'creator', commenterUsername: 'fan',
    });
    expect(result).toEqual({ success: true, responseId: 'private-template' });
    expect(mocks.reserve).toHaveBeenCalledWith('user-1');
    expect(mocks.sendPrivateTemplateReply).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'comment-1',
      templatePayload: expect.objectContaining({ attachment: expect.any(Object) }),
    }));
    expect(JSON.stringify(mocks.sendPrivateTemplateReply.mock.calls[0][0])).toContain('CONFIRM_FOLLOW_auto-1');
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('falls back to text after a template error and retains the successful reservation', async () => {
    mocks.sendPrivateTemplateReply.mockResolvedValue({ success: false, errorCategory: 'VALIDATION', errorMessage: 'template rejected' });
    await expect(FollowGateService.sendFollowAsk({
      ...base, mode: 'comment', commentId: 'comment-1', igUsername: 'creator',
    })).resolves.toEqual({ success: true, responseId: 'private-text' });
    expect(mocks.sendPrivateReply).toHaveBeenCalledWith(expect.objectContaining({ messageText: expect.stringContaining('Reply DONE') }));
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('does not call Meta when quota cannot be reserved', async () => {
    mocks.reserve.mockResolvedValue({ ok: false, message: 'Monthly DM quota reached' });
    await expect(FollowGateService.sendAccessWelcome({
      ...base, mode: 'direct', recipientId: 'person-1', commenterUsername: 'fan',
    })).resolves.toEqual({ success: false, errorCategory: 'VALIDATION', errorMessage: 'Monthly DM quota reached' });
    expect(mocks.sendDirectTemplate).not.toHaveBeenCalled();
  });

  it('releases quota when a direct delivery has no recipient', async () => {
    const result = await FollowGateService.sendAccessWelcome({ ...base, mode: 'direct', recipientId: '' });
    expect(result).toMatchObject({ success: false, errorCategory: 'VALIDATION' });
    expect(mocks.release).toHaveBeenCalledWith('user-1', expect.objectContaining({ ok: true }));
  });

  it('renders resource placeholders and uses text when no link is attached', async () => {
    await FollowGateService.sendResource({
      ...base, recipientId: 'person-1', username: 'fan', messageTemplate: 'Hi {{username}}: {{resource_url}}', resourceText: 'fallback',
    });
    expect(mocks.sendDirectTemplate).not.toHaveBeenCalled();
    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(expect.objectContaining({ messageText: 'Hi fan: \n\nfallback' }));
  });
});

describe('FollowGateService contact lifecycle', () => {
  it('keeps an existing username and atomically records a delivery claim', async () => {
    mocks.findUnique.mockResolvedValue({ username: 'existing' });
    mocks.upsert.mockResolvedValue({ id: 'contact-1' });
    await FollowGateService.upsertContact({
      instagramAccountId: 'ig-1', igsid: 'person-1', delivered: true, followed: true, followGateStatus: 'DELIVERED',
    });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        username: 'existing', followGateStatus: 'DELIVERED',
        totalInteractions: { increment: 1 }, followedAt: expect.any(Date), promptSentAt: expect.any(Date),
      }),
    }));
  });
});
