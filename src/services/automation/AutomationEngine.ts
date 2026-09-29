import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { KeywordMatcher } from './KeywordMatcher';
import { InstagramMessagingService } from '@/services/meta/InstagramMessagingService';
import { FollowGateService, isFollowRetryText, parseButtonPayload } from './FollowGateService';
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
type Result = { status: 'PROCESSED' | 'IGNORED' | 'FAILED'; message: string; automationRunId?: string };

function retryAt(retryCount: number) {
  return new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** retryCount));
}

export class AutomationEngine {
  public static async ingestCommentEvent(payload: CommentEventPayload) {
    const eventId = `${payload.instagramAccountId}:${payload.commentId}`;
    return prisma.webhookEvent.upsert({
      where: { eventId },
      create: { ...payload, rawPayload: payload.rawPayload as object, eventId, eventType: 'comments', status: 'RECEIVED' },
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
        OR: [
          { status: 'RECEIVED' },
          { status: 'RETRYING', nextRetryAt: { lte: new Date() } },
          { status: 'PROCESSING', processingStartedAt: { lte: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
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
    const accessToken = decryptToken(connection.accessTokenEncrypted);
    let resolvedMediaId = event.mediaId;
    let resolvedCommentText = event.commentText || '';
    let resolvedCommenterId = event.commenterId;
    let resolvedCommenterUsername = event.commenterUsername || '';

    // A Facebook Page `feed` event can contain the Page post ID rather than the
    // canonical Instagram media ID. Resolve it before applying a post-specific rule.
    const cachedMedia = await prisma.media.findUnique({ where: { instagramMediaId: resolvedMediaId } });
    if (!cachedMedia) {
      const details = await InstagramMessagingService.getCommentDetails(event.commentId, accessToken);
      if (details?.mediaId) resolvedMediaId = details.mediaId;
      if (details?.text !== undefined) resolvedCommentText = details.text;
      if (details?.commenterId) resolvedCommenterId = details.commenterId;
      if (details?.commenterUsername) resolvedCommenterUsername = details.commenterUsername;
      if (details) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            mediaId: resolvedMediaId,
            commentText: resolvedCommentText,
            commenterId: resolvedCommenterId,
            commenterUsername: resolvedCommenterUsername,
          },
        });
      }
    }

    const media = await prisma.media.upsert({
      where: { instagramMediaId: resolvedMediaId },
      create: { instagramAccountId: realIgAccountId, instagramMediaId: resolvedMediaId, mediaType: 'REEL', caption: null, permalink: null, timestamp: new Date() },
      update: {},
    });
    const automations = await prisma.automation.findMany({
      where: { instagramAccountId: realIgAccountId, status: 'ACTIVE', OR: [{ mediaId: media.id }, { mediaId: null }] },
      include: { resource: true },
      orderBy: { createdAt: 'asc' },
    });
    const automation = automations.find((candidate: { keywords: string[]; matchingMode: string; triggerType: string }) =>
      KeywordMatcher.isMatch(resolvedCommentText, candidate.keywords, candidate.matchingMode as any, candidate.triggerType as any).matched
    );
    if (!automation) return this.finishEvent(eventId, 'IGNORED', 'No active automation matched this comment');

    if (automation.ignoreOwnerComments) {
      const isOwnerId = resolvedCommenterId === realIgAccountId;
      const isOwnerUsername = Boolean(
        resolvedCommenterUsername
        && connection.instagramUsername
        && resolvedCommenterUsername.toLowerCase() === connection.instagramUsername.toLowerCase(),
      );
      if (isOwnerId || isOwnerUsername) return this.finishEvent(eventId, 'IGNORED', 'Owner comment ignored');
    }

    const quota = await assertDmQuota(automation.userId);
    if (!quota.ok) return this.finishEvent(eventId, 'IGNORED', quota.message);

    const contact = await prisma.contact.findUnique({
      where: { instagramAccountId_igsid: { instagramAccountId: realIgAccountId, igsid: resolvedCommenterId } },
    });
    if (automation.oneDeliveryPerUser && contact?.promptSentAt && contact.lastAutomationId === automation.id) {
      return this.finishEvent(eventId, 'IGNORED', 'Resource already delivered to this user for this flow');
    }

    const idempotencyKey = `${realIgAccountId}:${event.commentId}:${automation.id}`;
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

    let dm;
    if (automation.followGateEnabled) {
      dm = await FollowGateService.sendAccessWelcome({
        mode: 'comment',
        commentId: event.commentId,
        instagramAccountId: realIgAccountId,
        accessToken,
        commenterUsername: resolvedCommenterUsername,
        automationId: automation.id,
        userId: automation.userId,
      });
    } else {
      const reservation = await reserveDmQuota(automation.userId);
      if (!reservation.ok) {
        dm = { success: false as const, errorCategory: 'VALIDATION' as const, errorMessage: reservation.message };
      } else {
        const text = (automation.dmMessageTemplate || automation.resource?.textContent || 'Here is your resource.')
          .replace(/\{\{username\}\}/g, resolvedCommenterUsername || 'there')
          .replace(/\{\{resource_url\}\}/g, automation.resource?.url || '');
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

    // Public replies are attempted only after a DM is accepted. A DM retry can
    // therefore never spam the same public comment with repeated replies.
    let publicReplyStatus = run.publicReplyStatus || 'SKIPPED';
    let publicReplyId = run.publicReplyId || undefined;
    if (automation.publicReplyEnabled && automation.publicReplyTemplates.length > 0 && publicReplyStatus !== 'SENT') {
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
        where: { instagramAccountId_igsid: { instagramAccountId: realIgAccountId, igsid: resolvedCommenterId } },
        create: {
          instagramAccountId: realIgAccountId,
          igsid: resolvedCommenterId,
          username: resolvedCommenterUsername,
          followGateStatus: automation.followGateEnabled ? 'NEW' : 'DELIVERED',
          lastAutomationId: automation.id,
          promptSentAt: automation.followGateEnabled ? undefined : new Date(),
        },
        update: {
          username: resolvedCommenterUsername,
          lastInteraction: new Date(),
          totalInteractions: { increment: 1 },
          lastAutomationId: automation.id,
          followGateStatus: automation.followGateEnabled ? 'NEW' : 'DELIVERED',
          ...(automation.followGateEnabled
            ? { promptSentAt: null, claimedFollowAt: null }
            : { promptSentAt: new Date() }),
        },
      }),
      prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), errorDetails: null, nextRetryAt: null, processingStartedAt: null },
      }),
    ]);
    return { status: 'PROCESSED', message: automation.followGateEnabled ? 'Access welcome sent' : 'Private reply accepted by Meta', automationRunId: run.id };
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
    return { status: 'FAILED', message, automationRunId: runId };
  }

  public static async processMessagingPostback(payload: {
    instagramAccountId: string;
    senderId: string;
    postbackPayload: string;
    interactionType?: 'POSTBACK' | 'QUICK_REPLY' | 'TEXT';
    rawPayload: unknown;
  }): Promise<Result> {
    let auditUserId: string | null = null;
    let auditAutomationId: string | null = null;
    let auditAction = 'UNKNOWN';
    const finish = async (result: Result): Promise<Result> => {
      try {
        await prisma.auditLog.create({
          data: {
            userId: auditUserId,
            action: `MESSAGING_${result.status}`,
            details: {
              automationId: auditAutomationId,
              instagramAccountId: payload.instagramAccountId,
              senderId: payload.senderId,
              interactionType: payload.interactionType || 'TEXT',
              action: auditAction,
              payload: String(payload.postbackPayload || '').slice(0, 160),
              outcome: result.message,
            },
          },
        });
      } catch (auditError) {
        console.error('Unable to write messaging audit log:', auditError);
      }
      return result;
    };

    try {
      const { instagramAccountId, senderId } = payload;
      const interactionType = payload.interactionType || 'TEXT';
      const cleanPayload = (payload.postbackPayload || '').trim();
      if (!cleanPayload) return finish({ status: 'IGNORED', message: 'Empty messaging payload' });

      // Button tokens typed manually are plain text, not trusted postbacks.
      const button = parseButtonPayload(cleanPayload);
      if (interactionType === 'TEXT' && button.action !== 'UNKNOWN') {
        return finish({ status: 'IGNORED', message: 'Button tokens are accepted only from signed postback events' });
      }
      const parsed = button;
      const isTextConfirm = interactionType === 'TEXT' && isFollowRetryText(cleanPayload);
      const isAccessText = interactionType === 'TEXT' && /^(access|send me the access)$/i.test(cleanPayload);
      const isDeliverText = interactionType === 'TEXT' && /^(resource|send|unlock|link)$/i.test(cleanPayload);
      const resolvedAction = parsed.action === 'UNKNOWN'
        ? (isTextConfirm ? 'CONFIRM' : isAccessText ? 'GET_ACCESS' : isDeliverText ? 'DELIVER' : 'UNKNOWN')
        : parsed.action;
      auditAction = resolvedAction;
      if (resolvedAction === 'UNKNOWN') {
        return finish({ status: 'IGNORED', message: 'Messaging event is not a follow-gate action' });
      }

      const connection = await prisma.metaConnection.findFirst({
        where: { OR: [{ instagramAccountId }, { facebookPageId: instagramAccountId }] },
      });
      if (!connection || connection.connectionStatus !== 'CONNECTED') {
        return finish({ status: 'IGNORED', message: 'No connected Instagram account' });
      }
      if (connection.expiresAt && connection.expiresAt <= new Date()) {
        await prisma.metaConnection.update({ where: { id: connection.id }, data: { connectionStatus: 'TOKEN_EXPIRED' } });
        return finish({ status: 'IGNORED', message: 'Instagram access token expired; reconnect the account' });
      }

      auditUserId = connection.userId;
      const realInstagramAccountId = connection.instagramAccountId;
      const accessToken = decryptToken(connection.accessTokenEncrypted);
      const igUsername = connection.instagramUsername || 'instagram';
      const contactHint = await prisma.contact.findUnique({
        where: { instagramAccountId_igsid: { instagramAccountId: realInstagramAccountId, igsid: senderId } },
      });

      let automation = parsed.automationId
        ? await prisma.automation.findFirst({
            where: { id: parsed.automationId, instagramAccountId: realInstagramAccountId },
            include: { resource: true },
          })
        : null;
      if (!automation && contactHint?.lastAutomationId) {
        automation = await prisma.automation.findFirst({
          where: { id: contactHint.lastAutomationId, instagramAccountId: realInstagramAccountId },
          include: { resource: true },
        });
      }
      if (automation) {
        auditUserId = automation.userId;
        auditAutomationId = automation.id;
      }
      if (!automation || automation.status !== 'ACTIVE') {
        return finish({ status: 'IGNORED', message: 'Automation not found or inactive' });
      }
      if (interactionType === 'TEXT' && (!contactHint || contactHint.lastAutomationId !== automation.id)) {
        return finish({ status: 'IGNORED', message: 'No active follow-gate conversation for this message' });
      }

      const quota = await assertDmQuota(automation.userId);
      if (!quota.ok) return finish({ status: 'IGNORED', message: quota.message });

      if (automation.oneDeliveryPerUser && contactHint?.promptSentAt && contactHint.lastAutomationId === automation.id) {
        return finish({ status: 'IGNORED', message: 'Resource already delivered to this user for this flow' });
      }
      const contact = await FollowGateService.upsertContact({
        instagramAccountId: realInstagramAccountId,
        igsid: senderId,
        lastAutomationId: automation.id,
      });
      const profile = await InstagramMessagingService.getUserProfile(senderId, accessToken);
      const username = profile?.username || contact.username || 'there';
      const followsNow = profile?.isUserFollowingBusiness === true;

      const sendFollowPrompt = async (): Promise<Result> => {
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
        if (!dm.success) return finish({ status: 'FAILED', message: dm.errorMessage || 'Follow prompt failed' });
        await FollowGateService.upsertContact({
          instagramAccountId: realInstagramAccountId,
          igsid: senderId,
          username,
          followGateStatus: 'FOLLOW_ASKED',
          lastAutomationId: automation.id,
        });
        return finish({ status: 'PROCESSED', message: 'Follow not detected; follow prompt sent' });
      };

      const deliverResource = async (): Promise<Result> => {
        if (automation.followGateEnabled) {
          const deliveryClaim = await prisma.contact.updateMany({
            where: {
              id: contact.id,
              followGateStatus: { in: ['NEW', 'FOLLOW_ASKED', 'UNLOCKED'] },
              promptSentAt: null,
            },
            data: { followGateStatus: 'CLAIMED', claimedFollowAt: new Date() },
          });
          if (deliveryClaim.count !== 1) {
            return finish({ status: 'IGNORED', message: 'Resource delivery is already processing or complete' });
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
          if (automation.followGateEnabled) {
            await prisma.contact.updateMany({
              where: { id: contact.id, followGateStatus: 'CLAIMED', promptSentAt: null },
              data: { followGateStatus: 'FOLLOW_ASKED' },
            });
          }
          await prisma.automation.update({ where: { id: automation.id }, data: { totalFailed: { increment: 1 } } });
          return finish({ status: 'FAILED', message: dm.errorMessage || 'Resource DM failed' });
        }
        await FollowGateService.upsertContact({
          instagramAccountId: realInstagramAccountId,
          igsid: senderId,
          username,
          followGateStatus: 'DELIVERED',
          lastAutomationId: automation.id,
          followed: automation.followGateEnabled,
          delivered: true,
        });
        await prisma.automation.update({ where: { id: automation.id }, data: { totalSuccess: { increment: 1 } } });
        if (automation.followGateEnabled) {
          await prisma.auditLog.create({
            data: {
              userId: automation.userId,
              action: 'FOLLOW_GATE_VERIFIED',
              details: { igsid: senderId, automationId: automation.id, method: isTextConfirm ? 'text' : 'button' },
            },
          });
        }
        return finish({ status: 'PROCESSED', message: 'Live follow verified; resource delivered' });
      };

      if (!automation.followGateEnabled) return deliverResource();

      if (resolvedAction === 'GET_ACCESS' || resolvedAction === 'CONFIRM' || resolvedAction === 'DELIVER') {
        return followsNow ? deliverResource() : sendFollowPrompt();
      }

      return finish({ status: 'IGNORED', message: 'Unsupported follow-gate action' });
    } catch (error) {
      return finish({ status: 'FAILED', message: error instanceof Error ? error.message : 'Error processing messaging action' });
    }
  }
}
