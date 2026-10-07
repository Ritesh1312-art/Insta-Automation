import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/auth';
import { metaRedirectUri, publicAppUrl } from '@/lib/app-url';
import { MetaAuthService, META_OAUTH_SCOPES, type ConnectedInstagramAccount } from '@/services/meta/MetaAuthService';
import { encryptToken } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { InstagramMediaService, normalizeMediaType, resolveDisplayUrls } from '@/services/meta/InstagramMediaService';
import { logAuthFailure } from '@/lib/auth-logging';
import { describeWebhookSubscription, webhookSetupIncomplete } from '@/lib/meta-webhook-status';
import { redactSecrets } from '@/lib/safe-error';

export const dynamic = 'force-dynamic';

/**
 * A successful token exchange says nothing about whether Meta accepted the
 * `subscribed_apps` calls. Only the rejected attempts are reported by the
 * service, so a missing per-target result is reconstructed from the failure
 * count (one warning → one target missing, two → both).
 */
function subscriptionTargets(account: ConnectedInstagramAccount) {
  if (account.webhookSubscription) return account.webhookSubscription;
  const failures = account.webhookSubscriptionWarnings?.length ?? 0;
  return { page: failures === 0, instagram: failures < 2 };
}

export async function GET(req: NextRequest) {
  let appUrl: string;
  try {
    appUrl = publicAppUrl(req.url);
  } catch {
    appUrl = new URL(req.url).origin;
  }

  let userId: string | null = null;
  try {
    const params = new URL(req.url).searchParams;
    const state = params.get('state');
    userId = state ? await verifyOAuthState(state) : null;
    const code = params.get('code');
    if (!userId || !code) throw new Error('Invalid or expired Meta authorization response');

    const account = await MetaAuthService.handleOAuthCallback(code, metaRedirectUri(req.url));
    const existingConnection = await prisma.metaConnection.findUnique({
      where: { instagramAccountId: account.instagramAccountId },
    });
    if (existingConnection && existingConnection.userId !== userId) {
      throw new Error('This Instagram account is already connected to another workspace user');
    }

    const expiresAt = account.expiresInSeconds
      ? new Date(Date.now() + account.expiresInSeconds * 1000)
      : null;
    const targets = subscriptionTargets(account);
    const webhookSubscription = describeWebhookSubscription(targets.page, targets.instagram);
    // The token exchange above succeeded, so the connection itself is healthy.
    // Webhook-subscription gaps are stored separately and must not turn this
    // into a token-expired/reconnect state on the dashboard.
    await prisma.metaConnection.upsert({
      where: { instagramAccountId: account.instagramAccountId },
      create: {
        userId,
        metaUserId: account.metaUserId,
        instagramAccountId: account.instagramAccountId,
        facebookPageId: account.facebookPageId,
        instagramUsername: account.instagramUsername,
        profilePictureUrl: account.profilePictureUrl,
        accessTokenEncrypted: encryptToken(account.accessToken),
        scopes: [...META_OAUTH_SCOPES],
        expiresAt,
        connectionStatus: 'CONNECTED',
        webhookStatus: webhookSubscription.status,
      },
      update: {
        userId,
        metaUserId: account.metaUserId,
        facebookPageId: account.facebookPageId,
        instagramUsername: account.instagramUsername,
        profilePictureUrl: account.profilePictureUrl,
        accessTokenEncrypted: encryptToken(account.accessToken),
        scopes: [...META_OAUTH_SCOPES],
        expiresAt,
        connectionStatus: 'CONNECTED',
        webhookStatus: webhookSubscription.status,
      },
    });

    if (webhookSetupIncomplete(webhookSubscription.status)) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'META_WEBHOOK_SUBSCRIPTION_WARNING',
          details: {
            status: webhookSubscription.status,
            warnings: (account.webhookSubscriptionWarnings ?? []).slice(0, 2).map((warning) => redactSecrets(warning)),
          },
        },
      }).catch(() => undefined);
    }

    let syncedCount = 0;
    try {
      const media = await InstagramMediaService.fetchMedia(account.instagramAccountId, account.accessToken);
      for (const item of media) {
        const timestamp = new Date(item.timestamp);
        if (Number.isNaN(timestamp.getTime())) continue;
        const { mediaUrl, thumbnailUrl } = resolveDisplayUrls(item);
        const fields = {
          mediaType: normalizeMediaType(item),
          caption: item.caption || null,
          permalink: item.permalink || null,
          mediaUrl,
          thumbnailUrl,
          timestamp,
        };
        await prisma.media.upsert({
          where: { instagramMediaId: item.id },
          create: { instagramAccountId: account.instagramAccountId, instagramMediaId: item.id, ...fields },
          update: fields,
        });
        syncedCount += 1;
      }
    } catch (mediaError) {
      logAuthFailure('meta_media_sync', mediaError);
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'META_INITIAL_SYNC_FAILED',
          details: { reason: 'initial_media_sync_failed' },
        },
      }).catch(() => undefined);
    }

    const destination = new URL('/dashboard', appUrl);
    destination.searchParams.set('connected', 'true');
    destination.searchParams.set('synced', String(syncedCount));
    if (webhookSetupIncomplete(webhookSubscription.status)) destination.searchParams.set('webhookWarning', 'true');
    return NextResponse.redirect(destination);
  } catch (error) {
    logAuthFailure('meta_oauth_callback', error);
    if (userId) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'META_AUTH_CALLBACK_ERROR',
          details: { reason: 'meta_oauth_callback_failed' },
        },
      }).catch(() => undefined);
    }
    return NextResponse.redirect(new URL('/dashboard?error=meta_connection_failed', appUrl));
  }
}
