import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    auditLog: { create: vi.fn() },
    metaConnection: { findFirst: vi.fn(), update: vi.fn() },
    contact: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    automation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    automationRun: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    webhookEvent: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    media: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    prisma,
    decryptToken: vi.fn(() => 'access-token'),
    assertDmQuota: vi.fn(async () => ({ ok: true as const })),
    reserveDmQuota: vi.fn(async () => ({ ok: true as const, periodStart: new Date('2026-09-01'), usageAfter: 1 })),
    releaseDmQuota: vi.fn(),
    follow: {
      upsertContact: vi.fn(),
      sendAccessWelcome: vi.fn(),
      sendFollowAsk: vi.fn(),
      sendResource: vi.fn(),
    },
    messaging: {
      getUserProfile: vi.fn<(igsid: string, token: string) => Promise<{ username?: string; isUserFollowingBusiness?: boolean } | null>>(async () => null),
      getCommentDetails: vi.fn(async () => null),
      sendPrivateReply: vi.fn(),
      sendPublicReply: vi.fn(),
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/encryption', () => ({ decryptToken: mocks.decryptToken }));
vi.mock('@/lib/quota', () => ({
  assertDmQuota: mocks.assertDmQuota,
  reserveDmQuota: mocks.reserveDmQuota,
  releaseDmQuota: mocks.releaseDmQuota,
}));
vi.mock('@/services/meta/InstagramMessagingService', () => ({
  InstagramMessagingService: mocks.messaging,
}));
vi.mock('./FollowGateService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./FollowGateService')>();
  return { ...actual, FollowGateService: mocks.follow };
});

import { AutomationEngine } from './AutomationEngine';

const connection = {
  id: 'connection', userId: 'owner', instagramAccountId: 'ig-a', facebookPageId: 'page-a',
  instagramUsername: 'creator', accessTokenEncrypted: 'encrypted', connectionStatus: 'CONNECTED', expiresAt: null,
};
const automation = {
  id: 'auto-a', userId: 'owner', instagramAccountId: 'ig-a', status: 'ACTIVE',
  followGateEnabled: true, oneDeliveryPerUser: true, dmMessageTemplate: 'Here you go', resource: null,
};
const contact = {
  id: 'contact', instagramAccountId: 'ig-a', igsid: 'person', username: 'fan',
  lastAutomationId: 'auto-a', followGateStatus: 'FOLLOW_ASKED', promptSentAt: null,
};

describe('AutomationEngine messaging security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.auditLog.create.mockResolvedValue({});
    mocks.prisma.metaConnection.findFirst.mockResolvedValue(connection);
    mocks.prisma.contact.findUnique.mockResolvedValue(contact);
    mocks.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.automation.findFirst.mockResolvedValue(automation);
    mocks.prisma.automation.update.mockResolvedValue({});
    mocks.prisma.automationRun.update.mockResolvedValue({});
    mocks.prisma.webhookEvent.update.mockResolvedValue({});
    mocks.prisma.contact.upsert.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async (operations: unknown[]) => Promise.all(operations));
    mocks.reserveDmQuota.mockResolvedValue({ ok: true, periodStart: new Date('2026-09-01'), usageAfter: 1 });
    mocks.releaseDmQuota.mockResolvedValue(undefined);
    mocks.follow.upsertContact.mockResolvedValue(contact);
    mocks.follow.sendAccessWelcome.mockResolvedValue({ success: true, responseId: 'welcome' });
    mocks.follow.sendFollowAsk.mockResolvedValue({ success: true, responseId: 'follow-prompt' });
    mocks.follow.sendResource.mockResolvedValue({ success: true, responseId: 'resource' });
  });

  it('does not trust a button token typed as ordinary text', async () => {
    const result = await AutomationEngine.processMessagingPostback({
      instagramAccountId: 'page-a', senderId: 'person',
      postbackPayload: 'CONFIRM_FOLLOW_auto-a', interactionType: 'TEXT', rawPayload: {},
    });
    expect(result).toMatchObject({ status: 'IGNORED', message: 'Button tokens are accepted only from signed postback events' });
    expect(mocks.prisma.metaConnection.findFirst).not.toHaveBeenCalled();
  });

  it('scopes button automation IDs to the receiving Instagram account', async () => {
    mocks.prisma.contact.findUnique.mockResolvedValue(null);
    mocks.prisma.automation.findFirst.mockResolvedValue(null);
    const result = await AutomationEngine.processMessagingPostback({
      instagramAccountId: 'page-a', senderId: 'person',
      postbackPayload: 'CONFIRM_FOLLOW_other-workspace-id', interactionType: 'POSTBACK', rawPayload: {},
    });
    expect(mocks.prisma.automation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'other-workspace-id', instagramAccountId: 'ig-a' },
    }));
    expect(result.status).toBe('IGNORED');
    expect(mocks.follow.sendResource).not.toHaveBeenCalled();
  });

  it('rechecks the live relationship and repeats the follow prompt instead of letting RESOURCE bypass it', async () => {
    mocks.messaging.getUserProfile.mockResolvedValue({ username: 'fan', isUserFollowingBusiness: false });
    const result = await AutomationEngine.processMessagingPostback({
      instagramAccountId: 'page-a', senderId: 'person',
      postbackPayload: 'RESOURCE', interactionType: 'TEXT', rawPayload: {},
    });
    expect(result).toMatchObject({ status: 'PROCESSED', message: 'Follow not detected; follow prompt sent' });
    expect(mocks.follow.sendFollowAsk).toHaveBeenCalledTimes(1);
    expect(mocks.follow.sendResource).not.toHaveBeenCalled();
  });

  it('requires an existing conversation before legacy DONE text can trigger a live check', async () => {
    mocks.prisma.contact.findUnique.mockResolvedValue(null);
    mocks.prisma.automation.findFirst.mockResolvedValue(null);
    const result = await AutomationEngine.processMessagingPostback({
      instagramAccountId: 'page-a', senderId: 'person',
      postbackPayload: 'DONE', interactionType: 'TEXT', rawPayload: {},
    });
    expect(result).toMatchObject({ status: 'IGNORED', message: 'Automation not found or inactive' });
    expect(mocks.follow.sendResource).not.toHaveBeenCalled();
  });

  it('atomically claims a live verified follow and sends the resource directly', async () => {
    mocks.messaging.getUserProfile.mockResolvedValue({ username: 'fan', isUserFollowingBusiness: true });
    mocks.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    mocks.follow.upsertContact
      .mockResolvedValueOnce(contact)
      .mockResolvedValueOnce({ ...contact, followGateStatus: 'DELIVERED', promptSentAt: new Date() });
    const result = await AutomationEngine.processMessagingPostback({
      instagramAccountId: 'page-a', senderId: 'person',
      postbackPayload: 'CONFIRM_FOLLOW_auto-a', interactionType: 'POSTBACK', rawPayload: {},
    });
    expect(mocks.prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'contact', promptSentAt: null }),
      data: expect.objectContaining({ followGateStatus: 'CLAIMED' }),
    }));
    expect(mocks.follow.sendResource).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'PROCESSED', message: 'Live follow verified; resource delivered' });
  });
});

describe('AutomationEngine comment delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.webhookEvent.findUnique.mockResolvedValue({
      id: 'event-1', instagramAccountId: 'ig-a', mediaId: 'instagram-media-1', commentId: 'comment-1',
      commenterId: 'person', commenterUsername: 'fan', commentText: 'guide', retryCount: 0,
    });
    mocks.prisma.webhookEvent.update.mockResolvedValue({});
    mocks.prisma.metaConnection.findFirst.mockResolvedValue(connection);
    mocks.prisma.media.findUnique.mockResolvedValue({ id: 'media-row' });
    mocks.prisma.media.upsert.mockResolvedValue({ id: 'media-row' });
    mocks.prisma.automation.findMany.mockResolvedValue([{
      ...automation,
      keywords: ['guide'], matchingMode: 'EXACT', triggerType: 'KEYWORD', ignoreOwnerComments: true,
      oneDeliveryPerUser: true, followGateEnabled: false, publicReplyEnabled: false, publicReplyTemplates: [],
      dmMessageTemplate: 'Hi {{username}}, {{resource_url}}', resource: { url: 'https://example.com/guide', textContent: null },
    }]);
    mocks.prisma.contact.findUnique.mockResolvedValue(null);
    mocks.prisma.automationRun.create.mockResolvedValue({ id: 'run-1', publicReplyStatus: null, publicReplyId: null });
    mocks.prisma.automationRun.update.mockResolvedValue({});
    mocks.prisma.automation.update.mockResolvedValue({});
    mocks.prisma.contact.upsert.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async (operations: unknown[]) => Promise.all(operations));
    mocks.assertDmQuota.mockResolvedValue({ ok: true });
    mocks.reserveDmQuota.mockResolvedValue({ ok: true, periodStart: new Date('2026-09-01'), usageAfter: 1 });
    mocks.messaging.sendPrivateReply.mockResolvedValue({ success: true, responseId: 'dm-1' });
  });

  it('claims one webhook, matches the scoped flow, reserves quota, and records Meta acceptance', async () => {
    const result = await AutomationEngine.processWebhookEvent('event-1');
    expect(mocks.prisma.webhookEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'event-1' }),
      data: expect.objectContaining({ status: 'PROCESSING' }),
    }));
    expect(mocks.prisma.automation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ instagramAccountId: 'ig-a', status: 'ACTIVE' }),
    }));
    expect(mocks.messaging.sendPrivateReply).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'comment-1', messageText: 'Hi fan, https://example.com/guide',
    }));
    expect(mocks.prisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ followGateStatus: 'DELIVERED' }),
    }));
    expect(result).toEqual({ status: 'PROCESSED', message: 'Private reply accepted by Meta', automationRunId: 'run-1' });
  });

  it('starts a fresh per-automation delivery state after sending the access welcome', async () => {
    mocks.prisma.automation.findMany.mockResolvedValue([{
      ...automation,
      keywords: ['guide'], matchingMode: 'EXACT', triggerType: 'KEYWORD', ignoreOwnerComments: true,
      publicReplyEnabled: false, publicReplyTemplates: [], resource: null,
    }]);
    mocks.prisma.contact.findUnique.mockResolvedValue({
      ...contact,
      lastAutomationId: 'older-automation',
      followGateStatus: 'DELIVERED',
      promptSentAt: new Date('2026-09-10'),
    });
    mocks.follow.sendAccessWelcome.mockResolvedValue({ success: true, responseId: 'welcome' });

    const result = await AutomationEngine.processWebhookEvent('event-1');

    expect(mocks.prisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        lastAutomationId: 'auto-a',
        followGateStatus: 'NEW',
        promptSentAt: null,
        claimedFollowAt: null,
      }),
    }));
    expect(result).toEqual({ status: 'PROCESSED', message: 'Access welcome sent', automationRunId: 'run-1' });
  });

  it('does not claim the same in-flight webhook twice', async () => {
    mocks.prisma.webhookEvent.updateMany.mockResolvedValue({ count: 0 });
    await expect(AutomationEngine.processWebhookEvent('event-1')).resolves.toEqual({
      status: 'IGNORED', message: 'Webhook event is already being processed or completed',
    });
    expect(mocks.messaging.sendPrivateReply).not.toHaveBeenCalled();
  });
});
