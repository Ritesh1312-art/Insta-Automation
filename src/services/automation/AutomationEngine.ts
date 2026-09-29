import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { KeywordMatcher } from './KeywordMatcher';
import { InstagramMessagingService } from '@/services/meta/InstagramMessagingService';
import { FollowGateService, isHonorFollowConfirm, parseButtonPayload } from './FollowGateService';
import { assertDmQuota, releaseDmQuota, reserveDmQuota } from '@/lib/quota';

export interface CommentEventPayload {
  instagramAccountId: string;
  mediaId: string;
  commentId: string;
  commenterId: string;
  commenterUsername: string;
  commentText: string;
  rawPayload: unknown;
}
type Result = {
  status: 'PROCESSED' | 'IGNORED' | 'FAILED';
  message: string;
  automationRunId?: string;
  errorCategory?: string;
};

function retryAt(retryCount: number) {
  return new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** retryCount));
}

export class AutomationEngine {
  public static async ingestCommentEvent(payload: CommentEventPayload) {
    const eventId = `comment:${payload.instagramAccountId}:${payload.commentId}`;
    const connection = await prisma.metaConnection.findFirst({
      where: { OR: [{ instagramAccountId: payload.instagramAccountId }, { facebookPageId: payload.instagramAccountId }] },
      select: { instagramAccountId: true },
    });
    return prisma.webhookEvent.upsert({
      where: { eventId },
      create: {
        instagramAccountId: connection?.instagramAccountId || null,
        mediaId: payload.mediaId,
        commentId: payload.commentId,
        commenterId: payload.commenterId,
        commenterUsername: payload.commenterUsername,
        commentText: payload.commentText,
        rawPayload: payload.rawPayload as object,
        eventId,
        eventType: 'comments',
        status: 'RECEIVED',
      },
      update: {},
    });
  }

  public static async ingestMessagingEvent(payload: {
    eventId: string;
    instagramAccountId: string;
    senderId: string;
    postbackPayload: string;
    rawPayload: unknown;
  }) {
    const connection = await prisma.metaConnection.findFirst({
      where: { OR: [{ instagramAccountId: payload.instagramAccountId }, { facebookPageId: payload.instagramAccountId }] },
      select: { instagramAccountId: true },
    });
    return prisma.webhookEvent.upsert({
      where: { eventId: payload.eventId },
      create: {
        eventId: payload.eventId,
        eventType: 'messaging',
        instagramAccountId: connection?.instagramAccountId || null,
        commenterId: payload.senderId,
        commentText: payload.postbackPayload,
        rawPayload: payload.rawPayload as object,
        status: 'RECEIVED',
      },
      update: {},
    });
  }

  public static async processCommentEvent(payload: CommentEventPayload): Promise<Result> {
    const event = await this.ingestCommentEvent(payload);
    return this.processWebhookEvent(event.id);
  }

  public static async processWebhookEvent(eventId: string): Promise<Result> {
    const queued = await prisma.webhookEvent.findUnique({ where: { id: eventId }, select: { eventType: true } });
    if (!queued) return { status: 'IGNORED', message: 'Webhook event not found' };
    if (queued.eventType === 'messaging') return this.processStoredMessagingEvent(eventId);

    const claimed = await this.claimWebhookEvent(eventId);
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
    // A post-specific flow always wins over an account-wide fallback.
    automations.sort((left, right) => {
      const leftSpecific = left.mediaId === media.id ? 1 : 0;
      const rightSpecific = right.mediaId === media.id ? 1 : 0;
      return rightSpecific - leftSpecific || left.createdAt.getTime() - right.createdAt.getTime();
    });
    const automation = automations.find((candidate) =>
      KeywordMatcher.isMatch(
        event.commentText || '',
        candidate.keywords,
        candidate.matchingMode as 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'CASE_SENSITIVE',
        candidate.triggerType as 'ANY_COMMENT' | 'KEYWORD',
      ).matched
    );
    if (!automation) return this.finishEvent(eventId, 'IGNORED', 'No active automation matched this comment');

    if (automation.ignoreOwnerComments) {
      const ownerById = event.commenterId === realIgAccountId;
      const ownerByUsername = Boolean(event.commenterUsername && connection.instagramUsername
        && event.commenterUsername.toLowerCase() === connection.instagramUsername.toLowerCase());
      if (ownerById || ownerByUsername) return this.finishEvent(eventId, 'IGNORED', 'Owner comment ignored');
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
      const reservation = await reserveDmQuota(automation.userId);
      if (!reservation.ok) {
        dm = { success: false, errorCategory: 'VALIDATION' as const, errorMessage: reservation.message };
      } else {
        dm = await InstagramMessagingService.sendPrivateReply({
          instagramAccountId: realIgAccountId,
          commentId: event.commentId,
          messageText: text,
          accessToken,
        });
        if (!dm.success) await releaseDmQuota(automation.userId, reservation);
      }
    }

    if (!dm.success) {
      return this.failRun(event, run.id, automation.id, dm.errorCategory, dm.errorMessage || 'Private reply failed');
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

  private static claimWebhookEvent(eventId: string) {
    const now = new Date();
    return prisma.webhookEvent.updateMany({
      where: {
        id: eventId,
        OR: [
          { status: 'RECEIVED' },
          { status: 'RETRYING', nextRetryAt: { lte: now } },
          { status: 'PROCESSING', processingStartedAt: { lte: new Date(now.getTime() - 10 * 60 * 1000) } },
        ],
      },
      data: { status: 'PROCESSING', processingStartedAt: now },
    });
  }

  private static async processStoredMessagingEvent(eventId: string): Promise<Result> {
    const claimed = await this.claimWebhookEvent(eventId);
    if (claimed.count === 0) return { status: 'IGNORED', message: 'Messaging event is already processing or completed' };
    const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event?.instagramAccountId || !event.commenterId || !event.commentText) {
      return this.finishEvent(eventId, 'IGNORED', 'Incomplete messaging event');
    }

    const result = await this.processMessagingPostback({
      instagramAccountId: event.instagramAccountId,
      senderId: event.commenterId,
      postbackPayload: event.commentText,
      rawPayload: event.rawPayload,
    });
    const retryCount = event.retryCount + 1;
    const retryable = result.status === 'FAILED'
      && (result.errorCategory === 'TRANSIENT' || result.errorCategory === 'RATE_LIMIT')
      && retryCount <= 5;
    const status = result.status === 'PROCESSED'
      ? 'PROCESSED'
      : result.status === 'IGNORED'
        ? 'IGNORED'
        : retryable ? 'RETRYING' : 'FAILED';
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status,
        errorDetails: result.status === 'PROCESSED' ? null : result.message,
        retryCount: result.status === 'FAILED' ? retryCount : event.retryCount,
        nextRetryAt: retryable ? retryAt(retryCount) : null,
        processedAt: retryable ? null : new Date(),
        processingStartedAt: null,
      },
    });
    return result;
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
    return Promise.all(events.map((event: { id: string }) => this.processWebhookEvent(event.id)));
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
    return { status: 'FAILED', message, automationRunId: runId, errorCategory: category };
  }

  public static async processMessagingPostback(payload: {
    instagramAccountId: string;
    senderId: string;
    postbackPayload: string;
    rawPayload: any;
  }): Promise<Result> {
    let auditUserId: string | null = null;
    let auditAutomationId: string | null = null;
    let auditAction = 'UNKNOWN';
    const finish = async (result: Result): Promise<Result> => {
      try {
        await prisma.auditLog.create({
          data: {
            userId: auditUserId,
            action: `POSTBACK_${result.status}`,
            details: {
              automationId: auditAutomationId,
              instagramAccountId: payload.instagramAccountId,
              senderId: payload.senderId,
              buttonAction: auditAction,
              postbackPayload: String(payload.postbackPayload || '').slice(0, 160),
              outcome: result.message,
            },
          },
        });
      } catch (auditError) {
        console.error('Unable to write postback audit log:', auditError);
      }
      return result;
    };

    try {
      const { instagramAccountId, senderId } = payload;
      const cleanPayload = (payload.postbackPayload || '').trim();
      if (!cleanPayload) return finish({ status: 'IGNORED', message: 'Empty messaging payload' });

      const parsed = parseButtonPayload(cleanPayload);
      auditAction = parsed.action;
      const isTextConfirm = parsed.action === 'UNKNOWN' && isHonorFollowConfirm(cleanPayload);
      const isDeliverText = parsed.action === 'UNKNOWN' && /^(resource|send|unlock|link)$/i.test(cleanPayload.trim());
      const resolvedAction = parsed.action === 'UNKNOWN'
        ? (isTextConfirm ? 'CONFIRM' : isDeliverText ? 'DELIVER' : 'UNKNOWN')
        : parsed.action;
      auditAction = resolvedAction;

      if (parsed.action === 'UNKNOWN' && !isTextConfirm && !isDeliverText) {
        return finish({ status: 'IGNORED', message: 'Messaging event is not a follow-gate action' });
      }

      const connection = await prisma.metaConnection.findFirst({
        where: { OR: [{ instagramAccountId }, { facebookPageId: instagramAccountId }] },
      });
      if (!connection || connection.connectionStatus !== 'CONNECTED') {
        return finish({ status: 'IGNORED', message: 'No connected Instagram account' });
      }

      auditUserId = connection.userId;
      const realInstagramAccountId = connection.instagramAccountId;
      const accessToken = decryptToken(connection.accessTokenEncrypted);
      const igUsername = connection.instagramUsername || 'instagram';

      const existingContact = await prisma.contact.findUnique({
        where: { instagramAccountId_igsid: { instagramAccountId: realInstagramAccountId, igsid: senderId } },
      });
      // Free-form DONE/RESOURCE messages are valid only in an existing gate
      // conversation. This prevents a random DM from selecting the latest flow.
      if (!parsed.automationId && !existingContact?.lastAutomationId) {
        return finish({ status: 'IGNORED', message: 'No active follow-gate conversation for this user' });
      }

      const automationId = parsed.automationId || existingContact?.lastAutomationId;
      const automation = automationId
        ? await prisma.automation.findFirst({
          where: { id: automationId, instagramAccountId: realInstagramAccountId },
          include: { resource: true },
        })
        : null;
      if (automation) {
        auditUserId = automation.userId;
        auditAutomationId = automation.id;
      }
      if (!automation || automation.status !== 'ACTIVE') {
        return finish({ status: 'IGNORED', message: 'Automation not found, inactive, or belongs to another account' });
      }

      if (automation.followGateEnabled && resolvedAction === 'CONFIRM'
        && (!existingContact || !['FOLLOW_ASKED', 'CLAIMED', 'UNLOCKED'].includes(existingContact.followGateStatus))) {
        return finish({ status: 'IGNORED', message: 'Follow confirmation arrived before a follow request' });
      }
      if (automation.followGateEnabled && resolvedAction === 'DELIVER'
        && (!existingContact || !['CLAIMED', 'UNLOCKED'].includes(existingContact.followGateStatus))) {
        return finish({ status: 'IGNORED', message: 'Resource is still locked' });
      }

      const quota = await assertDmQuota(automation.userId);
      if (!quota.ok) return finish({ status: 'IGNORED', message: quota.message });

      const contact = await FollowGateService.upsertContact({
        instagramAccountId: realInstagramAccountId,
        igsid: senderId,
        lastAutomationId: automation.id,
      });

      if (automation.oneDeliveryPerUser && contact.promptSentAt) {
        return finish({ status: 'IGNORED', message: 'Resource already delivered to this user' });
      }

      const action = resolvedAction;
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
        if (!dm.success) return finish({ status: 'FAILED', message: dm.errorMessage || 'Follow-gate DM failed', errorCategory: dm.errorCategory });
        await FollowGateService.upsertContact({
          instagramAccountId: realInstagramAccountId,
          igsid: senderId,
          username,
          followGateStatus: 'FOLLOW_ASKED',
          lastAutomationId: automation.id,
        });
        return finish({ status: 'PROCESSED', message: 'Follow-gate reminder sent' });
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
          if (!dm.success) return finish({ status: 'FAILED', message: dm.errorMessage || 'Unlock card failed', errorCategory: dm.errorCategory });
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
          return finish({ status: 'PROCESSED', message: 'Follow claimed; unlock card sent' });
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
        return finish({ status: 'FAILED', message: dm.errorMessage || 'Resource DM failed', errorCategory: dm.errorCategory });
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
      return finish({ status: 'PROCESSED', message: 'Resource delivered after follow-gate' });
    } catch (error: unknown) {
      return finish({
        status: 'FAILED',
        message: error instanceof Error ? error.message : 'Error processing postback click',
        errorCategory: 'TRANSIENT',
      });
    }
  }
}
