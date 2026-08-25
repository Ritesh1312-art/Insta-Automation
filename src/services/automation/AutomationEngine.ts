import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { KeywordMatcher } from './KeywordMatcher';
import { InstagramMessagingService } from '@/services/meta/InstagramMessagingService';
import { FollowGateService, isHonorFollowConfirm, parseButtonPayload } from './FollowGateService';
import { assertDmQuota, incrementDmUsage } from '@/lib/quota';

export interface CommentEventPayload {
  instagramAccountId: string;
  mediaId: string;
  commentId: string;
  commenterId: string;
  commenterUsername: string;
  commentText: string;
  rawPayload: unknown;
}
type Result = { status: 'PROCESSED' | 'IGNORED' | 'FAILED'; message: string; automationRunId?: string };

function retryAt(retryCount: number) {
  return new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** retryCount));
}

export class AutomationEngine {
  public static async ingestCommentEvent(payload: CommentEventPayload) {
    const eventId = `${payload.instagramAccountId}:${payload.commentId}`;
    return prisma.webhookEvent.upsert({
      where: { eventId },
      create: { ...payload, rawPayload: payload.rawPayload as Prisma.InputJsonValue, eventId, eventType: 'comments', status: 'RECEIVED' },
      update: {},
    });
  }

  public static async processCommentEvent(payload: CommentEventPayload): Promise<Result> {
    const event = await this.ingestCommentEvent(payload);
    return this.processWebhookEvent(event.id);
  }

  public static async processWebhookEvent(eventId: string): Promise<Result> {
    const claimed = await prisma.webhookEvent.updateMany({
      where: {
        id: eventId,
        status: { in: ['RECEIVED', 'RETRYING', 'PROCESSING'] },
        OR: [{ status: { in: ['RECEIVED', 'RETRYING'] } }, { processingStartedAt: { lte: new Date(Date.now() - 10 * 60 * 1000) } }],
      },
      data: { status: 'PROCESSING', processingStartedAt: new Date() },
    });
    if (claimed.count === 0) return { status: 'IGNORED', message: 'Webhook event is already being processed or completed' };
    const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event?.instagramAccountId || !event.mediaId || !event.commentId || !event.commenterId || event.commentText === null) {
      return this.finishEvent(eventId, 'IGNORED', 'Incomplete comment event');
    }

    const connection = await prisma.metaConnection.findFirst({
      where: {
        OR: [{ instagramAccountId: event.instagramAccountId }, { facebookPageId: event.instagramAccountId }],
      },
    });
    if (!connection || connection.connectionStatus !== 'CONNECTED') return this.finishEvent(eventId, 'IGNORED', 'No connected Instagram account for this event');
    if (connection.expiresAt && connection.expiresAt <= new Date()) {
      await prisma.metaConnection.update({ where: { id: connection.id }, data: { connectionStatus: 'TOKEN_EXPIRED' } });
      return this.finishEvent(eventId, 'IGNORED', 'Instagram access token has expired; reconnect the account');
    }

    const realIgAccountId = connection.instagramAccountId;
    const media = await prisma.media.upsert({
      where: { instagramMediaId: event.mediaId },
      create: { instagramAccountId: realIgAccountId, instagramMediaId: event.mediaId, mediaType: 'REEL', caption: null, permalink: null, timestamp: new Date() },
      update: {},
    });
    const automations = await prisma.automation.findMany({
      where: { instagramAccountId: realIgAccountId, status: 'ACTIVE', OR: [{ mediaId: media.id }, { mediaId: null }] },
      include: { resource: true },
    });
    const automation = automations.find((candidate) =>
      KeywordMatcher.isMatch(event.commentText || '', candidate.keywords, candidate.matchingMode as any, candidate.triggerType as any).matched
    );
    if (!automation) return this.finishEvent(eventId, 'IGNORED', 'No active automation matched this comment');

    if (automation.ignoreOwnerComments && event.commenterUsername && connection.instagramUsername) {
      if (event.commenterUsername.toLowerCase() === connection.instagramUsername.toLowerCase()) {
        return this.finishEvent(eventId, 'IGNORED', 'Owner comment ignored');
      }
    }

    const quota = await assertDmQuota(automation.userId);
    if (!quota.ok) return this.finishEvent(eventId, 'IGNORED', quota.message);

    const contact = await prisma.contact.findUnique({
      where: { instagramAccountId_igsid: { instagramAccountId: realIgAccountId, igsid: event.commenterId } },
    });
    if (automation.oneDeliveryPerUser && contact?.promptSentAt) {
      return this.finishEvent(eventId, 'IGNORED', 'Resource already delivered to this user');
    }

    const idempotencyKey = `${event.instagramAccountId}:${event.commentId}:${automation.id}`;
    let run;
    let isNewRun = false;
    try {
      run = await prisma.automationRun.create({ data: { automationId: automation.id, webhookEventId: event.id, idempotencyKey, status: 'PROCESSING' } });
      isNewRun = true;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existingRun = await prisma.automationRun.findUnique({ where: { idempotencyKey } });
        if (!existingRun || existingRun.status !== 'RETRYING') return this.finishEvent(eventId, 'IGNORED', 'Duplicate comment delivery prevented');
        run = await prisma.automationRun.update({ where: { id: existingRun.id }, data: { status: 'PROCESSING', nextRetryAt: null } });
      } else throw error;
    }
    if (isNewRun) await prisma.automation.update({ where: { id: automation.id }, data: { totalTriggers: { increment: 1 }, lastTriggeredAt: new Date() } });

    const accessToken = decryptToken(connection.accessTokenEncrypted);
    const igUsername = connection.instagramUsername || 'instagram';

    let dm;
    if (automation.followGateEnabled) {
      dm = await FollowGateService.sendFollowAsk({
        mode: 'comment',
        commentId: event.commentId,
        instagramAccountId: realIgAccountId,
        accessToken,
        igUsername,
        commenterUsername: event.commenterUsername,
        automationId: automation.id,
        userId: automation.userId,
      });
    } else {
      const text = (automation.dmMessageTemplate || automation.resource?.textContent || 'Here is your resource.')
        .replace(/\{\{username\}\}/g, event.commenterUsername || 'there')
        .replace(/\{\{resource_url\}\}/g, automation.resource?.url || '');
      dm = await InstagramMessagingService.sendPrivateReply({
        instagramAccountId: event.instagramAccountId,
        commentId: event.commentId,
        messageText: text,
        accessToken,
      });
      if (dm.success) await incrementDmUsage(automation.userId);
    }

    let publicReplyStatus = 'SKIPPED';
    let publicReplyId: string | undefined;
    if (automation.publicReplyEnabled && automation.publicReplyTemplates.length > 0) {
      const reply = automation.publicReplyTemplates[Math.floor(Math.random() * automation.publicReplyTemplates.length)];
      const publicReply = await InstagramMessagingService.sendPublicReply({
        commentId: event.commentId,
        messageText: reply,
        accessToken,
      });
      publicReplyStatus = publicReply.success ? 'SENT' : 'FAILED';
      publicReplyId = publicReply.responseId;
    }

    if (!dm.success) {
      return this.failRun(event, run.id, automation.id, dm.errorCategory, dm.errorMessage || 'Private reply failed');
    }

    await prisma.$transaction([
      prisma.automationRun.update({
        where: { id: run.id },
        data: { status: 'API_ACCEPTED', dmStatus: 'SENT', dmResponseId: dm.responseId, publicReplyStatus, publicReplyId, executedAt: new Date() },
      }),
      prisma.automation.update({ where: { id: automation.id }, data: { totalSuccess: { increment: 1 }, lastTriggeredAt: new Date() } }),
      prisma.contact.upsert({
        where: { instagramAccountId_igsid: { instagramAccountId: realIgAccountId, igsid: event.commenterId } },
        create: {
          instagramAccountId: realIgAccountId,
          igsid: event.commenterId,
          username: event.commenterUsername,
          followGateStatus: automation.followGateEnabled ? 'FOLLOW_ASKED' : 'DELIVERED',
          lastAutomationId: automation.id,
          promptSentAt: automation.followGateEnabled ? undefined : new Date(),
        },
        update: {
          username: event.commenterUsername,
          lastInteraction: new Date(),
          totalInteractions: { increment: 1 },
          lastAutomationId: automation.id,
          followGateStatus: automation.followGateEnabled ? 'FOLLOW_ASKED' : 'DELIVERED',
          ...(automation.followGateEnabled ? {} : { promptSentAt: new Date() }),
        },
      }),
      prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), errorDetails: null, nextRetryAt: null, processingStartedAt: null },
      }),
    ]);
    return { status: 'PROCESSED', message: automation.followGateEnabled ? 'Follow-gate step 1 sent' : 'Private reply accepted by Meta', automationRunId: run.id };
  }

  public static async processDueEvents(limit = 25) {
    const now = new Date();
    const events = await prisma.webhookEvent.findMany({
      where: {
        OR: [
          { status: 'RECEIVED' },
          { status: 'RETRYING', nextRetryAt: { lte: now } },
          { status: 'PROCESSING', processingStartedAt: { lte: new Date(now.getTime() - 10 * 60 * 1000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return Promise.all(events.map((event) => this.processWebhookEvent(event.id)));
  }

  private static async finishEvent(eventId: string, status: 'IGNORED', message: string): Promise<Result> {
    await prisma.webhookEvent.update({ where: { id: eventId }, data: { status, errorDetails: message, processedAt: new Date(), processingStartedAt: null } });
    return { status, message };
  }

  private static async failRun(event: any, runId: string, automationId: string, category: string | undefined, message: string): Promise<Result> {
    const retryable = category === 'TRANSIENT' || category === 'RATE_LIMIT';
    const retryCount = event.retryCount + 1;
    const retriesLeft = retryable && retryCount <= 5;
    await prisma.$transaction([
      prisma.automationRun.update({
        where: { id: runId },
        data: { status: retriesLeft ? 'RETRYING' : 'FAILED', dmStatus: 'FAILED', errorCategory: category, errorMessage: message, retryCount, nextRetryAt: retriesLeft ? retryAt(retryCount) : null },
      }),
      ...(retriesLeft ? [] : [prisma.automation.update({ where: { id: automationId }, data: { totalFailed: { increment: 1 }, lastTriggeredAt: new Date() } })]),
      prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: retriesLeft ? 'RETRYING' : 'FAILED', errorDetails: message, retryCount, nextRetryAt: retriesLeft ? retryAt(retryCount) : null, processedAt: retriesLeft ? null : new Date(), processingStartedAt: null },
      }),
    ]);
    return { status: 'FAILED', message, automationRunId: runId };
  }

  public static async processMessagingPostback(payload: {
    instagramAccountId: string;
    senderId: string;
    postbackPayload: string;
    rawPayload: any;
  }): Promise<Result> {
    try {
      const { instagramAccountId, senderId } = payload;
      const cleanPayload = (payload.postbackPayload || '').trim();
      if (!cleanPayload) return { status: 'IGNORED', message: 'Empty messaging payload' };

      const parsed = parseButtonPayload(cleanPayload);
      const isTextConfirm = parsed.action === 'UNKNOWN' && isHonorFollowConfirm(cleanPayload);
      const isDeliverText = parsed.action === 'UNKNOWN' && /^(resource|send|unlock|link)$/i.test(cleanPayload.trim());

      if (parsed.action === 'UNKNOWN' && !isTextConfirm && !isDeliverText) {
        return { status: 'IGNORED', message: 'Messaging event is not a follow-gate action' };
      }

      const connection = await prisma.metaConnection.findFirst({
        where: { OR: [{ instagramAccountId }, { facebookPageId: instagramAccountId }] },
      });
      if (!connection || connection.connectionStatus !== 'CONNECTED') {
        return { status: 'IGNORED', message: 'No connected Instagram account' };
      }

      const realInstagramAccountId = connection.instagramAccountId;
      const accessToken = decryptToken(connection.accessTokenEncrypted);
      const igUsername = connection.instagramUsername || 'instagram';

      let automation = parsed.automationId
        ? await prisma.automation.findUnique({ where: { id: parsed.automationId }, include: { resource: true } })
        : null;
      if (!automation) {
        const contactHint = await prisma.contact.findUnique({
          where: { instagramAccountId_igsid: { instagramAccountId: realInstagramAccountId, igsid: senderId } },
        });
        if (contactHint?.lastAutomationId) {
          automation = await prisma.automation.findUnique({ where: { id: contactHint.lastAutomationId }, include: { resource: true } });
        }
      }
      if (!automation) {
        automation = await prisma.automation.findFirst({
          where: { instagramAccountId: realInstagramAccountId, status: 'ACTIVE' },
          orderBy: { updatedAt: 'desc' },
          include: { resource: true },
        });
      }
      if (!automation || automation.status !== 'ACTIVE') {
        return { status: 'IGNORED', message: 'Automation not found or inactive' };
      }

      const quota = await assertDmQuota(automation.userId);
      if (!quota.ok) return { status: 'IGNORED', message: quota.message };

      const contact = await FollowGateService.upsertContact({
        instagramAccountId: realInstagramAccountId,
        igsid: senderId,
        lastAutomationId: automation.id,
      });

      if (automation.oneDeliveryPerUser && contact.promptSentAt) {
        return { status: 'IGNORED', message: 'Resource already delivered to this user' };
      }

      const action = parsed.action === 'UNKNOWN' ? (isTextConfirm ? 'CONFIRM' : isDeliverText ? 'DELIVER' : 'GET_ACCESS') : parsed.action;
      const profile = await InstagramMessagingService.getUserProfile(senderId, accessToken);
      const username = profile?.username || contact.username || 'there';

      if (action === 'GET_ACCESS' && contact.followGateStatus !== 'CLAIMED' && contact.followGateStatus !== 'UNLOCKED' && contact.followGateStatus !== 'DELIVERED') {
        const dm = await FollowGateService.sendFollowAsk({
          mode: 'direct',
          recipientId: senderId,
          instagramAccountId: realInstagramAccountId,
          accessToken,
          igUsername,
          commenterUsername: username,
          automationId: automation.id,
          userId: automation.userId,
        });
        if (!dm.success) return { status: 'FAILED', message: dm.errorMessage || 'Follow-gate DM failed' };
        await FollowGateService.upsertContact({
          instagramAccountId: realInstagramAccountId,
          igsid: senderId,
          username,
          followGateStatus: 'FOLLOW_ASKED',
          lastAutomationId: automation.id,
        });
        return { status: 'PROCESSED', message: 'Follow-gate reminder sent' };
      }

      if (action === 'CONFIRM' || action === 'GET_ACCESS') {
        if (contact.followGateStatus !== 'UNLOCKED' && contact.followGateStatus !== 'DELIVERED') {
          const dm = await FollowGateService.sendUnlockCard({
            recipientId: senderId,
            instagramAccountId: realInstagramAccountId,
            accessToken,
            automationId: automation.id,
            userId: automation.userId,
            username,
          });
          if (!dm.success) return { status: 'FAILED', message: dm.errorMessage || 'Unlock card failed' };
          await FollowGateService.upsertContact({
            instagramAccountId: realInstagramAccountId,
            igsid: senderId,
            username,
            followGateStatus: 'UNLOCKED',
            lastAutomationId: automation.id,
            followed: true,
          });
          await prisma.auditLog.create({
            data: {
              userId: automation.userId,
              action: 'FOLLOW_GATE_CLAIMED',
              details: { igsid: senderId, automationId: automation.id, method: action === 'CONFIRM' ? 'honor_confirm' : 'get_access_after_claim' },
            },
          });
          return { status: 'PROCESSED', message: 'Follow claimed; unlock card sent' };
        }
      }

      const dm = await FollowGateService.sendResource({
        recipientId: senderId,
        instagramAccountId: realInstagramAccountId,
        accessToken,
        userId: automation.userId,
        username,
        messageTemplate: automation.dmMessageTemplate,
        resourceUrl: automation.resource?.url,
        resourceText: automation.resource?.textContent,
      });
      if (!dm.success) {
        await prisma.automation.update({ where: { id: automation.id }, data: { totalFailed: { increment: 1 } } });
        return { status: 'FAILED', message: dm.errorMessage || 'Resource DM failed' };
      }
      await FollowGateService.upsertContact({
        instagramAccountId: realInstagramAccountId,
        igsid: senderId,
        username,
        followGateStatus: 'DELIVERED',
        lastAutomationId: automation.id,
        delivered: true,
      });
      await prisma.automation.update({ where: { id: automation.id }, data: { totalSuccess: { increment: 1 } } });
      return { status: 'PROCESSED', message: 'Resource delivered after follow-gate' };
    } catch (error: any) {
      return { status: 'FAILED', message: error.message || 'Error processing postback click' };
    }
  }
}
