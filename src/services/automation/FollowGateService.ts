import { prisma } from '@/lib/prisma';
import { incrementDmUsage } from '@/lib/quota';
import { InstagramMessagingService, type ApiResponse } from '@/services/meta/InstagramMessagingService';

export type GateStatus = 'NEW' | 'FOLLOW_ASKED' | 'CLAIMED' | 'UNLOCKED' | 'DELIVERED';

const CONFIRM_PHRASES = [
  'done',
  'i followed',
  'followed',
  'confirm',
  'im following',
  'i am following',
  'i m following',
  'following',
  'ho gaya',
  'hogaya',
  'follow kar diya',
];

export function parseButtonPayload(raw: string): { action: 'GET_ACCESS' | 'CONFIRM' | 'DELIVER' | 'UNKNOWN'; automationId?: string } {
  const payload = (raw || '').trim();
  const prefixes: Array<{ prefix: string; action: 'GET_ACCESS' | 'CONFIRM' | 'DELIVER' }> = [
    { prefix: 'DELIVER_RESOURCE_', action: 'DELIVER' },
    { prefix: 'CONFIRM_FOLLOW_', action: 'CONFIRM' },
    { prefix: 'GET_ACCESS_', action: 'GET_ACCESS' },
  ];
  for (const item of prefixes) {
    if (payload.startsWith(item.prefix)) {
      return { action: item.action, automationId: payload.slice(item.prefix.length) };
    }
  }
  return { action: 'UNKNOWN' };
}

export function isHonorFollowConfirm(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
  return CONFIRM_PHRASES.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

function genericCard(title: string, subtitle: string, buttons: Array<Record<string, string>>) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{ title: title.slice(0, 80), subtitle: subtitle.slice(0, 80), buttons: buttons.slice(0, 3) }],
      },
    },
  };
}

function renderTemplate(template: string, username: string, resourceUrl?: string | null) {
  return template
    .replace(/\{\{username\}\}/g, username)
    .replace(/\{\{resource_url\}\}/g, resourceUrl || '');
}

export class FollowGateService {
  public static async sendFollowAsk(params: {
    mode: 'comment' | 'direct';
    commentId?: string;
    recipientId?: string;
    instagramAccountId: string;
    accessToken: string;
    igUsername: string;
    commenterUsername?: string | null;
    automationId: string;
    userId: string;
  }): Promise<ApiResponse> {
    const handle = params.commenterUsername ? `@${params.commenterUsername}` : 'there';
    const profileUrl = `https://www.instagram.com/${params.igUsername}/`;
    const title = `Hey ${handle}! Follow to unlock`;
    const subtitle = `Instagram cannot notify us of follows. Follow @${params.igUsername}, then tap I Followed.`;
    const template = genericCard(title, subtitle, [
      { type: 'web_url', url: profileUrl, title: 'Follow profile' },
      { type: 'postback', title: 'I Followed', payload: `CONFIRM_FOLLOW_${params.automationId}` },
    ]);
    const fallback =
      `Hey ${handle}!\n\n` +
      `To unlock access:\n` +
      `1) Follow @${params.igUsername}: ${profileUrl}\n` +
      `2) Reply DONE or tap I Followed.\n\n` +
      `We cannot detect follows automatically. Confirm only after you follow.`;

    const result = await this.dispatch({
      mode: params.mode,
      commentId: params.commentId,
      recipientId: params.recipientId,
      instagramAccountId: params.instagramAccountId,
      accessToken: params.accessToken,
      template,
      fallback,
    });
    if (result.success) await incrementDmUsage(params.userId);
    return result;
  }

  public static async sendUnlockCard(params: {
    recipientId: string;
    instagramAccountId: string;
    accessToken: string;
    automationId: string;
    userId: string;
    username?: string | null;
  }): Promise<ApiResponse> {
    const name = params.username || 'there';
    const template = genericCard(
      'Access unlocked',
      `Thanks ${name}. Tap below to receive your resource.`,
      [{ type: 'postback', title: 'Send my resource', payload: `DELIVER_RESOURCE_${params.automationId}` }]
    );
    const fallback = `Access unlocked, ${name}. Reply RESOURCE or tap the button to receive your content.`;
    const result = await this.dispatch({
      mode: 'direct',
      recipientId: params.recipientId,
      instagramAccountId: params.instagramAccountId,
      accessToken: params.accessToken,
      template,
      fallback,
    });
    if (result.success) await incrementDmUsage(params.userId);
    return result;
  }

  public static async sendResource(params: {
    recipientId: string;
    instagramAccountId: string;
    accessToken: string;
    userId: string;
    username?: string | null;
    messageTemplate: string;
    resourceUrl?: string | null;
    resourceText?: string | null;
  }): Promise<ApiResponse> {
    const username = params.username || 'there';
    const body = renderTemplate(params.messageTemplate || params.resourceText || 'Here is your resource.', username, params.resourceUrl);
    const buttons = params.resourceUrl
      ? [{ type: 'web_url', url: params.resourceUrl, title: 'Open resource' }]
      : [];
    const template = buttons.length
      ? genericCard('Your resource is ready', body.slice(0, 80), buttons)
      : null;
    const result = await this.dispatch({
      mode: 'direct',
      recipientId: params.recipientId,
      instagramAccountId: params.instagramAccountId,
      accessToken: params.accessToken,
      template,
      fallback: body,
    });
    if (result.success) await incrementDmUsage(params.userId);
    return result;
  }

  public static async upsertContact(params: {
    instagramAccountId: string;
    igsid: string;
    username?: string | null;
    followGateStatus?: GateStatus;
    lastAutomationId?: string;
    followed?: boolean;
    delivered?: boolean;
  }) {
    const existing = await prisma.contact.findUnique({
      where: { instagramAccountId_igsid: { instagramAccountId: params.instagramAccountId, igsid: params.igsid } },
    });
    return prisma.contact.upsert({
      where: { instagramAccountId_igsid: { instagramAccountId: params.instagramAccountId, igsid: params.igsid } },
      create: {
        instagramAccountId: params.instagramAccountId,
        igsid: params.igsid,
        username: params.username || undefined,
        followGateStatus: params.followGateStatus || 'NEW',
        lastAutomationId: params.lastAutomationId,
        followedAt: params.followed ? new Date() : undefined,
        claimedFollowAt: params.followed ? new Date() : undefined,
        promptSentAt: params.delivered ? new Date() : undefined,
        lastGateMessageAt: new Date(),
      },
      update: {
        username: params.username || existing?.username,
        lastInteraction: new Date(),
        totalInteractions: { increment: 1 },
        ...(params.followGateStatus ? { followGateStatus: params.followGateStatus } : {}),
        ...(params.lastAutomationId ? { lastAutomationId: params.lastAutomationId } : {}),
        ...(params.followed ? { followedAt: new Date(), claimedFollowAt: new Date() } : {}),
        ...(params.delivered ? { promptSentAt: new Date() } : {}),
        lastGateMessageAt: new Date(),
      },
    });
  }

  private static async dispatch(params: {
    mode: 'comment' | 'direct';
    commentId?: string;
    recipientId?: string;
    instagramAccountId: string;
    accessToken: string;
    template: any;
    fallback: string;
  }): Promise<ApiResponse> {
    if (params.mode === 'comment' && params.commentId) {
      if (params.template) {
        const templated = await InstagramMessagingService.sendPrivateTemplateReply({
          instagramAccountId: params.instagramAccountId,
          commentId: params.commentId,
          templatePayload: params.template,
          accessToken: params.accessToken,
        });
        if (templated.success) return templated;
      }
      return InstagramMessagingService.sendPrivateReply({
        instagramAccountId: params.instagramAccountId,
        commentId: params.commentId,
        messageText: params.fallback,
        accessToken: params.accessToken,
      });
    }

    if (!params.recipientId) {
      return { success: false, errorCategory: 'VALIDATION', errorMessage: 'Missing recipient IGSID' };
    }

    if (params.template) {
      const templated = await InstagramMessagingService.sendDirectTemplate({
        recipientId: params.recipientId,
        templatePayload: params.template,
        accessToken: params.accessToken,
        instagramAccountId: params.instagramAccountId,
      });
      if (templated.success) return templated;
    }

    return InstagramMessagingService.sendDirectMessage({
      recipientId: params.recipientId,
      messageText: params.fallback,
      accessToken: params.accessToken,
      instagramAccountId: params.instagramAccountId,
    });
  }
}
