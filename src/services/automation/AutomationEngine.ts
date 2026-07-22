import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { KeywordMatcher } from './KeywordMatcher';
import { InstagramMessagingService } from '@/services/meta/InstagramMessagingService';

export interface CommentEventPayload {
  instagramAccountId: string;
  mediaId: string;
  commentId: string;
  commenterId: string;
  commenterUsername: string;
  commentText: string;
  rawPayload: any;
}

export class AutomationEngine {
  public static async processCommentEvent(payload: CommentEventPayload): Promise<{
    status: 'PROCESSED' | 'IGNORED' | 'FAILED';
    message: string;
    automationRunId?: string;
  }> {
    const { instagramAccountId, mediaId, commentId, commenterId, commenterUsername, commentText } = payload;

    // 1. Fetch Instagram MetaConnection details
    const connection = await prisma.metaConnection.findUnique({
      where: { instagramAccountId },
    });

    if (!connection) {
      return {
        status: 'IGNORED',
        message: `No active MetaConnection found for Instagram Account ID ${instagramAccountId}`,
      };
    }

    if (connection.connectionStatus !== 'CONNECTED') {
      return {
        status: 'IGNORED',
        message: `MetaConnection is in ${connection.connectionStatus} state`,
      };
    }

    // 2. Find Media item in DB (or auto-create if new comment on recent post)
    let media = await prisma.media.findFirst({
      where: {
        instagramAccountId,
        instagramMediaId: mediaId,
      },
    });

    if (!media) {
      media = await prisma.media.create({
        data: {
          instagramAccountId,
          instagramMediaId: mediaId,
          mediaType: 'REEL',
          caption: 'Instagram Post / Reel',
          permalink: `https://instagram.com`,
          timestamp: new Date(),
        },
      });
    }

    // 3. Find ACTIVE automations mapped specifically to this media ID OR global automations (mediaId: null)
    const automations = await prisma.automation.findMany({
      where: {
        instagramAccountId,
        OR: [{ mediaId: media.id }, { mediaId: null }],
        status: 'ACTIVE',
      },
      include: {
        resource: true,
      },
    });

    if (automations.length === 0) {
      return {
        status: 'IGNORED',
        message: `No active automations mapped to media ID ${media.id}`,
      };
    }

    // 4. Determine matching automation with priority: Specific KEYWORD > ANY_COMMENT
    let matchedAutomation: (typeof automations)[0] | null = null;
    let matchedKeyword = '';

    const keywordAutomations = automations.filter((a) => a.triggerType === 'KEYWORD');
    for (const auto of keywordAutomations) {
      const match = KeywordMatcher.isMatch(
        commentText,
        auto.keywords,
        auto.matchingMode as any,
        'KEYWORD'
      );
      if (match.matched) {
        matchedAutomation = auto;
        matchedKeyword = match.matchedKeyword || '';
        break;
      }
    }

    if (!matchedAutomation) {
      const anyCommentAutomation = automations.find((a) => a.triggerType === 'ANY_COMMENT');
      if (anyCommentAutomation) {
        matchedAutomation = anyCommentAutomation;
        matchedKeyword = 'ANY_COMMENT';
      }
    }

    if (!matchedAutomation) {
      return {
        status: 'IGNORED',
        message: `Comment "${commentText}" did not match any keyword triggers`,
      };
    }

    // 5. Exclude owner comments if configured
    if (matchedAutomation.ignoreOwnerComments && commenterUsername === connection.instagramUsername) {
      return {
        status: 'IGNORED',
        message: `Ignored comment made by account owner @${commenterUsername}`,
      };
    }

    // 6. Check Idempotency composite key: instagramAccountId + commentId + automationId
    const idempotencyKey = `${instagramAccountId}:${commentId}:${matchedAutomation.id}`;

    const existingRun = await prisma.automationRun.findUnique({
      where: { idempotencyKey },
    });

    if (existingRun) {
      return {
        status: 'IGNORED',
        message: `Idempotency check: Comment ${commentId} has already been processed for automation ${matchedAutomation.name}`,
        automationRunId: existingRun.id,
      };
    }

    // 7. Store Webhook Event and create QUEUED Automation Run transactionally
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        instagramAccountId,
        eventType: 'comments',
        commentId,
        mediaId,
        commenterId,
        commenterUsername,
        commentText,
        rawPayload: payload.rawPayload,
        status: 'PROCESSING',
      },
    });

    const run = await prisma.automationRun.create({
      data: {
        automationId: matchedAutomation.id,
        webhookEventId: webhookEvent.id,
        idempotencyKey,
        status: 'PROCESSING',
      },
    });

    // 8. Prepare dynamic template message
    const resourceUrl = matchedAutomation.resource?.url || matchedAutomation.resource?.textContent || '';
    const dmContent = matchedAutomation.dmMessageTemplate
      .replace(/\{\{username\}\}/g, commenterUsername || 'there')
      .replace(/\{\{comment_text\}\}/g, commentText)
      .replace(/\{\{post_caption\}\}/g, media.caption || '')
      .replace(/\{\{resource_url\}\}/g, resourceUrl)
      .replace(/\{\{keyword\}\}/g, matchedKeyword);

    const decryptedAccessToken = decryptToken(connection.accessTokenEncrypted);

    // 9. Dispatch official Meta Private Reply DM
    const dmResult = await InstagramMessagingService.sendPrivateReply({
      commentId,
      messageText: dmContent,
      accessToken: decryptedAccessToken,
    });

    // 10. Optional Public Comment Auto-Reply
    let publicReplyStatus = 'SKIPPED';
    let publicReplyId: string | undefined = undefined;

    if (matchedAutomation.publicReplyEnabled && matchedAutomation.publicReplyTemplates.length > 0) {
      const templates = matchedAutomation.publicReplyTemplates;
      const randomReply = templates[Math.floor(Math.random() * templates.length)];
      const publicReplyResult = await InstagramMessagingService.sendPublicReply({
        commentId,
        messageText: randomReply,
        accessToken: decryptedAccessToken,
      });

      publicReplyStatus = publicReplyResult.success ? 'SENT' : 'FAILED';
      publicReplyId = publicReplyResult.responseId;
    }

    // 11. Update Run & Automation Analytics
    if (dmResult.success) {
      await prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: 'API_ACCEPTED',
          dmStatus: 'SENT',
          dmResponseId: dmResult.responseId,
          publicReplyStatus,
          publicReplyId,
          executedAt: new Date(),
        },
      });

      await prisma.automation.update({
        where: { id: matchedAutomation.id },
        data: {
          totalTriggers: { increment: 1 },
          totalSuccess: { increment: 1 },
          lastTriggeredAt: new Date(),
        },
      });

      // Update Contact interaction history
      await prisma.contact.upsert({
        where: {
          instagramAccountId_igsid: {
            instagramAccountId,
            igsid: commenterId,
          },
        },
        create: {
          instagramAccountId,
          igsid: commenterId,
          username: commenterUsername,
          firstInteraction: new Date(),
          lastInteraction: new Date(),
          totalInteractions: 1,
        },
        update: {
          username: commenterUsername,
          lastInteraction: new Date(),
          totalInteractions: { increment: 1 },
        },
      });

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      return {
        status: 'PROCESSED',
        message: `Successfully executed private reply for comment ${commentId}`,
        automationRunId: run.id,
      };
    } else {
      await prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          dmStatus: 'FAILED',
          errorCategory: dmResult.errorCategory,
          errorMessage: dmResult.errorMessage,
        },
      });

      await prisma.automation.update({
        where: { id: matchedAutomation.id },
        data: {
          totalTriggers: { increment: 1 },
          totalFailed: { increment: 1 },
          lastTriggeredAt: new Date(),
        },
      });

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', errorDetails: dmResult.errorMessage },
      });

      return {
        status: 'FAILED',
        message: `Failed to send private reply: ${dmResult.errorMessage}`,
        automationRunId: run.id,
      };
    }
  }
}
