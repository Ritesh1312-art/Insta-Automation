import { prisma } from '@/lib/prisma';
import { releaseDmQuota, reserveDmQuota } from '@/lib/quota';
import { InstagramMessagingService, type ApiResponse } from '@/services/meta/InstagramMessagingService';
import { renderTemplate } from './template';

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

export function isFollowRetryText(text: string): boolean {
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

export class FollowGateService {
  public static async sendAccessWelcome(params: {
    mode: 'comment' | 'direct';
    commentId?: string;
    recipientId?: string;
    instagramAccountId: string;
    accessToken: string;
    automationId: string;
    userId: string;
    commenterUsername?: string | null;
  }): Promise<ApiResponse> {
    const name = params.commenterUsername ? `@${params.commenterUsername}` : 'there';
    const template = genericCard(
      `Hey ${name}! Your access is ready`,
      'Tap below and we will check your follow status before sending it.',
      [{ type: 'postback', title: 'Send me the Access', payload: `GET_ACCESS_${params.automationId}` }],
    );
    const fallback = `Hey ${name}! Reply ACCESS and we will check your follow status before sending your content.`;
    return this.meteredDispatch(params.userId, {
      mode: params.mode,
      commentId: params.commentId,
      recipientId: params.recipientId,
      instagramAccountId: params.instagramAccountId,
      accessToken: params.accessToken,
      template,
      fallback,
    });
  }

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
    const subtitle = `Follow @${params.igUsername}, then tap I've followed. We will verify your current follow status.`;
    const template = genericCard(title, subtitle, [
      { type: 'web_url', url: profileUrl, title: 'Follow Me' },
      { type: 'postback', title: "I've followed", payload: `CONFIRM_FOLLOW_${params.automationId}` },
    ]);
    const fallback =
      `Hey ${handle}!\n\n` +
      `To unlock access:\n` +
      `1) Follow @${params.igUsername}: ${profileUrl}\n` +
      `2) Reply DONE after following.\n\n` +
      `We will verify your current follow status before sending the content.`;

    return this.meteredDispatch(params.userId, {
      mode: params.mode,
      commentId: params.commentId,
      recipientId: params.recipientId,
      instagramAccountId: params.instagramAccountId,
      accessToken: params.accessToken,
      template,
      fallback,
    });
  }

  public static async sendResource(params: {
    recipientId: string;
    instagramAccountId: string;
    accessToken: string;
    userId: string;
    username?: string | null;
    messageTemplate: string;
    resourceUrl?: string | null;
    resourceName?: string | null;
    igUsername?: string | null;
    resourceText?: string | null;
  }): Promise<ApiResponse> {
    const username = params.username || 'there';
    const templateVars = {
      username,
      resourceUrl: params.resourceUrl,
      resourceName: params.resourceName,
      igUsername: params.igUsername,
    };
    const message = renderTemplate(params.messageTemplate || 'Here is your resource.', templateVars);
    const resourceText = params.resourceText
      ? renderTemplate(params.resourceText, templateVars)
      : '';
    const body = resourceText && resourceText !== message ? `${message}\n\n${resourceText}` : message;
    const buttons = params.resourceUrl
      ? [{ type: 'web_url', url: params.resourceUrl, title: 'Open resource' }]
      : [];
    const template = buttons.length
      ? genericCard('Your resource is ready', body.slice(0, 80), buttons)
      : null;
    return this.meteredDispatch(params.userId, {
      mode: 'direct',
      recipientId: params.recipientId,
      instagramAccountId: params.instagramAccountId,
      accessToken: params.accessToken,
      template,
      fallback: body,
    });
  }

  /**
   * Live follow-relationship check against the Instagram Graph API
   * (`is_user_follow_business`). The result is a gate status, not an assertion
   * about a stored flag: `UNLOCKED` means the account followed at this instant,
   * `FOLLOW_ASKED` means it had not and must be prompted.
   *
   * `unavailable` is true when the Graph API could not be read (network error,
   * non-200, missing field); callers then keep the current state rather than
   * pretending the check passed.
   */
  public static async resolveFollowGateStatus(params: {
    igsid: string;
    accessToken: string;
  }): Promise<{ following: boolean; status: GateStatus; unavailable: boolean; username?: string }> {
    const profile = await InstagramMessagingService.getUserProfile(params.igsid, params.accessToken);
    if (!profile) return { following: false, status: 'FOLLOW_ASKED', unavailable: true };
    const following = profile.isUserFollowingBusiness === true;
    return { following, status: following ? 'UNLOCKED' : 'FOLLOW_ASKED', unavailable: false, username: profile.username };
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

  private static async meteredDispatch(userId: string, params: {
    mode: 'comment' | 'direct';
    commentId?: string;
    recipientId?: string;
    instagramAccountId: string;
    accessToken: string;
    template: any;
    fallback: string;
  }): Promise<ApiResponse> {
    const reservation = await reserveDmQuota(userId);
    if (!reservation.ok) {
      return { success: false, errorCategory: 'VALIDATION', errorMessage: reservation.message };
    }
    const result = await this.dispatch(params);
    if (!result.success) await releaseDmQuota(userId, reservation);
    return result;
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
