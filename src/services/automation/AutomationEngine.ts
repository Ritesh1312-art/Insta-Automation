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

    const connection = await prisma.metaConnection.findFirst({
      where: {
        OR: [
          { instagramAccountId: event.instagramAccountId },
          { facebookPageId: event.instagramAccountId },
        ],
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
      where: { instagramAccountId: realIgAccountId, status: 'ACTIVE', OR: [{ mediaId: media.id }, { mediaId: null }] }, include: { resource: true },
    });
    let automation = automations.find((candidate) => KeywordMatcher.isMatch(event.commentText || '', candidate.keywords, candidate.matchingMode as any, candidate.triggerType as any).matched);
    let matchedKeyword = automation ? KeywordMatcher.isMatch(event.commentText || '', automation.keywords, automation.matchingMode as any, automation.triggerType as any).matchedKeyword || '' : '';
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
    
    // Format DM message text and prepare 2-Button Interactive Template
    const resourceValue = automation.resource?.url || automation.resource?.textContent || '';
    const igUsername = connection.instagramUsername || 'stuti.ritesh90';

    // Build Meta Generic Card Template with 2 Interactive Buttons
    const templatePayload = {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            {
              title: `Hey @${event.commenterUsername || 'follower'}! 🎁`,
              subtitle: `Follow @${igUsername} to unlock your prompt link below! 🚀`,
              buttons: [
                {
                  type: 'web_url',
                  url: `https://instagram.com/${igUsername}`,
                  title: '👉 Follow Profile',
                },
                {
                  type: 'postback',
                  title: '✨ Get Prompt',
                  payload: `GET_PROMPT_POSTBACK_${automation.id}`,
                },
              ],
            },
          ],
        },
      },
    };

    // Send 2-Button Interactive Card via Private Reply API
    let dm = await InstagramMessagingService.sendPrivateTemplateReply({
      instagramAccountId: event.instagramAccountId,
      commentId: event.commentId,
      templatePayload,
      accessToken: decryptToken(connection.accessTokenEncrypted),
    });

    // Fallback to text Private Reply if template is not supported
    if (!dm.success) {
      const dmText = automation.dmMessageTemplate
        .replace(/\{\{username\}\}/g, event.commenterUsername || 'there')
        .replace(/\{\{resource_url\}\}/g, resourceValue);
      dm = await InstagramMessagingService.sendPrivateReply({
        instagramAccountId: event.instagramAccountId,
        commentId: event.commentId,
        messageText: dmText,
        accessToken: decryptToken(connection.accessTokenEncrypted),
      });
    }

    // 2. Send Public Comment Reply if enabled
    let publicReplyStatus = 'SKIPPED';
    let publicReplyId: string | undefined;
    if (automation.publicReplyEnabled && automation.publicReplyTemplates.length > 0) {
      const reply = automation.publicReplyTemplates[Math.floor(Math.random() * automation.publicReplyTemplates.length)];
      const publicReply = await InstagramMessagingService.sendPublicReply({
        commentId: event.commentId,
        messageText: reply,
        accessToken: decryptToken(connection.accessTokenEncrypted),
      });
      publicReplyStatus = publicReply.success ? 'SENT' : 'FAILED';
      publicReplyId = publicReply.responseId;
    }

    if (!dm.success) {
      return this.failRun(event, run.id, automation.id, dm.errorCategory, dm.errorMessage || 'Private reply failed');
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

  public static async processMessagingPostback(payload: { instagramAccountId: string; senderId: string; postbackPayload: string; rawPayload: any }): Promise<Result> {
    try {
      const { instagramAccountId, senderId, postbackPayload } = payload;

      // CASE 1: Follow URL click tracking
      // When user clicks "👉 Follow Profile" web_url button, Meta fires a "web_url" referral
      // We track this in DB so we know user has indicated intent to follow
      if (postbackPayload === 'FOLLOW_CLICKED' || postbackPayload.includes('FOLLOW_PROFILE')) {
        // Mark user as having clicked the follow button
        const conn = await prisma.metaConnection.findFirst({
          where: { OR: [{ instagramAccountId }, { facebookPageId: instagramAccountId }] },
        });
        if (conn) {
          await prisma.contact.upsert({
            where: { instagramAccountId_igsid: { instagramAccountId: conn.instagramAccountId, igsid: senderId } },
            create: { instagramAccountId: conn.instagramAccountId, igsid: senderId, followedAt: new Date() },
            update: { followedAt: new Date(), lastInteraction: new Date() },
          });
        }
        return { status: 'PROCESSED', message: 'Follow click tracked in DB' };
      }

      // CASE 2: Get Prompt button click
      const cleanPayload = (postbackPayload || '').trim();
      const isPromptClick = cleanPayload.startsWith('GET_PROMPT_POSTBACK_') || cleanPayload.toLowerCase().includes('get prompt') || cleanPayload.toLowerCase() === '✨ get prompt';

      if (!isPromptClick) {
        return { status: 'IGNORED', message: 'Not a prompt button click' };
      }

      let automationId = '';
      if (cleanPayload.startsWith('GET_PROMPT_POSTBACK_')) {
        automationId = cleanPayload.replace('GET_PROMPT_POSTBACK_', '');
      }

      // Find automation — by ID first, then fallback to latest ACTIVE
      let automation = automationId
        ? await prisma.automation.findUnique({ where: { id: automationId }, include: { resource: true } })
        : null;

      if (!automation) {
        automation = await prisma.automation.findFirst({
          where: { OR: [{ instagramAccountId }, { instagramAccountId: { not: '' } }], status: 'ACTIVE' },
          orderBy: { updatedAt: 'desc' },
          include: { resource: true },
        });
      }

      if (!automation || automation.status !== 'ACTIVE') {
        return { status: 'IGNORED', message: 'Automation not found or inactive' };
      }

      const connection = await prisma.metaConnection.findFirst({
        where: { OR: [{ instagramAccountId }, { facebookPageId: instagramAccountId }, { instagramAccountId: automation.instagramAccountId }] },
      });
      if (!connection || connection.connectionStatus !== 'CONNECTED') {
        return { status: 'IGNORED', message: 'No connected Instagram account' };
      }

      const accessToken = decryptToken(connection.accessTokenEncrypted);
      const realInstagramAccountId = connection.instagramAccountId;

      // CHECK FOLLOW STATUS in DB
      const contact = await prisma.contact.findUnique({
        where: { instagramAccountId_igsid: { instagramAccountId: realInstagramAccountId, igsid: senderId } },
      });

      const hasFollowed = contact?.followedAt != null;

      if (!hasFollowed) {
        // User has NOT clicked Follow yet — gate the prompt, send reminder
        const warningText = `❌ Aapne abhi tak @${connection.instagramUsername} ko follow nahi kiya!\n\n` +
          `Please pehle:\n1️⃣ "👉 Follow Profile" button dabao\n2️⃣ Follow karo\n3️⃣ Phir "✨ Get Prompt" click karo\n\nFollow karte hi prompt unlock ho jayega! 🔓`;
        await InstagramMessagingService.sendDirectMessage({ recipientId: senderId, messageText: warningText, accessToken });
        return { status: 'PROCESSED', message: 'Follow gate enforced: user has not followed yet' };
      }

      // User HAS followed — deliver the prompt
      const resourceValue = automation.resource?.url || automation.resource?.textContent || '';
      if (!resourceValue) {
        // No resource configured — send informational error
        await InstagramMessagingService.sendDirectMessage({
          recipientId: senderId,
          messageText: `Hi! Aapne follow kiya, thank you! 🎉\n\nPrompt abhi set ho raha hai, thoda wait karein. Hum jald hi bhejenge! ⏳`,
          accessToken,
        });
        return { status: 'PROCESSED', message: 'Prompt delivered but resource not configured' };
      }

      const profile = await InstagramMessagingService.getUserProfile(senderId, accessToken);
      const username = profile?.username || contact?.username || 'follower';

      const messageText = (automation.dmMessageTemplate || 'Hi {{username}}! Aapka prompt yahan hai:\n\n{{resource_url}}')
        .replace(/\{\{username\}\}/g, username)
        .replace(/\{\{resource_url\}\}/g, resourceValue);

      const dm = await InstagramMessagingService.sendDirectMessage({ recipientId: senderId, messageText, accessToken });
      if (dm.success) {
        // Mark prompt as sent in DB
        await prisma.$transaction([
          prisma.automation.update({ where: { id: automation.id }, data: { totalSuccess: { increment: 1 } } }),
          prisma.contact.update({
            where: { instagramAccountId_igsid: { instagramAccountId: realInstagramAccountId, igsid: senderId } },
            data: { promptSentAt: new Date(), lastInteraction: new Date() },
          }),
        ]);
        return { status: 'PROCESSED', message: 'Prompt delivered to follower successfully' };
      } else {
        await prisma.automation.update({ where: { id: automation.id }, data: { totalFailed: { increment: 1 } } });
        return { status: 'FAILED', message: `DM send failed: ${dm.errorMessage}` };
      }
    } catch (error: any) {
      return { status: 'FAILED', message: error.message || 'Error processing postback click' };
    }
  }
}
