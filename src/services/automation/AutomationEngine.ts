import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { KeywordMatcher } from './KeywordMatcher';
import { InstagramMessagingService } from '@/services/meta/InstagramMessagingService';

export interface CommentEventPayload {
  instagramAccountId: string; mediaId: string; commentId: string; commenterId: string;
  commenterUsername: string; commentText: string; rawPayload: unknown;
}
type Result = { status: 'PROCESSED' | 'IGNORED' | 'FAILED'; message: string; automationRunId?: string };

function retryAt(retryCount: number) { return new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** retryCount)); }

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
    const claimed = await prisma.webhookEvent.updateMany({ where: { id: eventId, status: { in: ['RECEIVED', 'RETRYING', 'PROCESSING'] }, OR: [{ status: { in: ['RECEIVED', 'RETRYING'] } }, { processingStartedAt: { lte: new Date(Date.now() - 10 * 60 * 1000) } }] }, data: { status: 'PROCESSING', processingStartedAt: new Date() } });
    if (claimed.count === 0) return { status: 'IGNORED', message: 'Webhook event is already being processed or completed' };
    const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event?.instagramAccountId || !event.mediaId || !event.commentId || !event.commenterId || event.commentText === null) return this.finishEvent(eventId, 'IGNORED', 'Incomplete comment event');

    const connection = await prisma.metaConnection.findUnique({ where: { instagramAccountId: event.instagramAccountId } });
    if (!connection || connection.connectionStatus !== 'CONNECTED') return this.finishEvent(eventId, 'IGNORED', 'No connected Instagram account for this event');
    if (connection.expiresAt && connection.expiresAt <= new Date()) {
      await prisma.metaConnection.update({ where: { id: connection.id }, data: { connectionStatus: 'TOKEN_EXPIRED' } });
      return this.finishEvent(eventId, 'IGNORED', 'Instagram access token has expired; reconnect the account');
    }

    const media = await prisma.media.upsert({
      where: { instagramMediaId: event.mediaId },
      create: { instagramAccountId: event.instagramAccountId, instagramMediaId: event.mediaId, mediaType: 'REEL', caption: null, permalink: null, timestamp: new Date() },
      update: {},
    });
    const automations = await prisma.automation.findMany({
      where: { instagramAccountId: event.instagramAccountId, status: 'ACTIVE', OR: [{ mediaId: media.id }, { mediaId: null }] }, include: { resource: true },
    });
    let automation = automations.find((candidate) => candidate.triggerType === 'KEYWORD' && KeywordMatcher.isMatch(event.commentText || '', candidate.keywords, candidate.matchingMode as any, 'KEYWORD').matched);
    let matchedKeyword = automation ? KeywordMatcher.isMatch(event.commentText || '', automation.keywords, automation.matchingMode as any, 'KEYWORD').matchedKeyword || '' : '';
    if (!automation) { automation = automations.find((candidate) => candidate.triggerType === 'ANY_COMMENT'); matchedKeyword = automation ? 'ANY_COMMENT' : ''; }
    if (!automation) return this.finishEvent(eventId, 'IGNORED', 'No active automation matched this comment');
    if (automation.ignoreOwnerComments && event.commenterUsername === connection.instagramUsername) return this.finishEvent(eventId, 'IGNORED', 'Owner comment ignored');

    if (automation.oneDeliveryPerUser) {
      const priorDelivery = await prisma.automationRun.findFirst({ where: { automationId: automation.id, status: 'API_ACCEPTED', webhookEvent: { commenterId: event.commenterId } } });
      if (priorDelivery) return this.finishEvent(eventId, 'IGNORED', 'One delivery per user is enabled');
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
    const resourceValue = automation.resource?.url || automation.resource?.textContent || '';
    const message = automation.dmMessageTemplate
      .replace(/\{\{username\}\}/g, event.commenterUsername || 'there')
      .replace(/\{\{comment_text\}\}/g, event.commentText || '')
      .replace(/\{\{post_caption\}\}/g, media.caption || '')
      .replace(/\{\{resource_url\}\}/g, resourceValue)
      .replace(/\{\{keyword\}\}/g, matchedKeyword);
    const dm = await InstagramMessagingService.sendPrivateReply({ instagramAccountId: event.instagramAccountId, commentId: event.commentId, messageText: message, accessToken: decryptToken(connection.accessTokenEncrypted) });
    if (!dm.success) return this.failRun(event, run.id, automation.id, dm.errorCategory, dm.errorMessage || 'Private reply failed');

    let publicReplyStatus = 'SKIPPED'; let publicReplyId: string | undefined;
    if (automation.publicReplyEnabled && automation.publicReplyTemplates.length) {
      const reply = automation.publicReplyTemplates[Math.floor(Math.random() * automation.publicReplyTemplates.length)];
      const publicReply = await InstagramMessagingService.sendPublicReply({ commentId: event.commentId, messageText: reply, accessToken: decryptToken(connection.accessTokenEncrypted) });
      publicReplyStatus = publicReply.success ? 'SENT' : 'FAILED'; publicReplyId = publicReply.responseId;
    }
    await prisma.$transaction([
      prisma.automationRun.update({ where: { id: run.id }, data: { status: 'API_ACCEPTED', dmStatus: 'SENT', dmResponseId: dm.responseId, publicReplyStatus, publicReplyId, executedAt: new Date() } }),
      prisma.automation.update({ where: { id: automation.id }, data: { totalSuccess: { increment: 1 }, lastTriggeredAt: new Date() } }),
      prisma.contact.upsert({ where: { instagramAccountId_igsid: { instagramAccountId: event.instagramAccountId, igsid: event.commenterId } }, create: { instagramAccountId: event.instagramAccountId, igsid: event.commenterId, username: event.commenterUsername }, update: { username: event.commenterUsername, lastInteraction: new Date(), totalInteractions: { increment: 1 } } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), errorDetails: null, nextRetryAt: null, processingStartedAt: null } }),
    ]);
    return { status: 'PROCESSED', message: 'Private reply accepted by Meta', automationRunId: run.id };
  }

  public static async processDueEvents(limit = 25) {
    const now = new Date();
    const events = await prisma.webhookEvent.findMany({ where: { OR: [{ status: 'RECEIVED' }, { status: 'RETRYING', nextRetryAt: { lte: now } }, { status: 'PROCESSING', processingStartedAt: { lte: new Date(now.getTime() - 10 * 60 * 1000) } }] }, orderBy: { createdAt: 'asc' }, take: limit });
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
      prisma.automationRun.update({ where: { id: runId }, data: { status: retriesLeft ? 'RETRYING' : 'FAILED', dmStatus: 'FAILED', errorCategory: category, errorMessage: message, retryCount, nextRetryAt: retriesLeft ? retryAt(retryCount) : null } }),
      ...(retriesLeft ? [] : [prisma.automation.update({ where: { id: automationId }, data: { totalFailed: { increment: 1 }, lastTriggeredAt: new Date() } })]),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { status: retriesLeft ? 'RETRYING' : 'FAILED', errorDetails: message, retryCount, nextRetryAt: retriesLeft ? retryAt(retryCount) : null, processedAt: retriesLeft ? null : new Date(), processingStartedAt: null } }),
    ]);
    return { status: 'FAILED', message, automationRunId: runId };
  }
}
