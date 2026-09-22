import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/auth';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { encryptToken } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { InstagramMediaService, normalizeMediaType, resolveDisplayUrls } from '@/services/meta/InstagramMediaService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let appUrl = process.env.APP_URL;
  if (!appUrl || !appUrl.startsWith('https://')) {
    appUrl = new URL(req.url).origin;
  }
  let userId: string | null = null;
  try {
    const params = new URL(req.url).searchParams;
    userId = params.get('state') ? await verifyOAuthState(params.get('state')!) : null;
    const code = params.get('code');
    if (!userId || !code) throw new Error('Invalid or expired Meta authorization response');
    const redirectUri = `${appUrl}/api/auth/meta/callback`;
    const account = await MetaAuthService.handleOAuthCallback(code, redirectUri);
    const existingConnection = await prisma.metaConnection.findUnique({ where: { instagramAccountId: account.instagramAccountId } });
    if (existingConnection && existingConnection.userId !== userId) throw new Error('This Instagram account is already connected to another workspace user');
    const expiresAt = account.expiresInSeconds ? new Date(Date.now() + account.expiresInSeconds * 1000) : null;
    await prisma.metaConnection.upsert({
      where: { instagramAccountId: account.instagramAccountId },
      create: { userId, metaUserId: account.metaUserId, instagramAccountId: account.instagramAccountId, facebookPageId: account.facebookPageId, instagramUsername: account.instagramUsername, profilePictureUrl: account.profilePictureUrl, accessTokenEncrypted: encryptToken(account.accessToken), scopes: ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_show_list', 'pages_read_engagement', 'business_management'], expiresAt, connectionStatus: 'CONNECTED' },
      update: { userId, metaUserId: account.metaUserId, facebookPageId: account.facebookPageId, instagramUsername: account.instagramUsername, profilePictureUrl: account.profilePictureUrl, accessTokenEncrypted: encryptToken(account.accessToken), expiresAt, connectionStatus: 'CONNECTED' },
    });
    // The connection itself is already saved above. A media-sync failure must NOT
    // roll the user back to "meta_connection_failed" — that previously discarded a
    // perfectly valid new token and left the account looking unconnected.
    let syncedCount = 0;
    try {
      const media = await InstagramMediaService.fetchMedia(account.instagramAccountId, account.accessToken);
      for (const item of media) {
        const { mediaUrl, thumbnailUrl } = resolveDisplayUrls(item);
        const fields = {
          mediaType: normalizeMediaType(item),
          caption: item.caption || null,
          permalink: item.permalink || null,
          mediaUrl,
          thumbnailUrl,
          timestamp: new Date(item.timestamp),
        };
        await prisma.media.upsert({
          where: { instagramMediaId: item.id },
          create: { instagramAccountId: account.instagramAccountId, instagramMediaId: item.id, ...fields },
          update: fields,
        });
      }
      syncedCount = media.length;
    } catch (mediaError) {
      console.error('Initial Instagram media sync after connect failed:', mediaError);
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'META_INITIAL_SYNC_FAILED',
          details: { message: mediaError instanceof Error ? mediaError.message.slice(0, 300) : 'Unknown error' },
        },
      }).catch(() => undefined);
    }
    return NextResponse.redirect(`${appUrl}/dashboard?connected=true&synced=${syncedCount}`);
  } catch (error) {
    console.error('Meta OAuth callback failed:', error);
    if (userId) await prisma.auditLog.create({ data: { userId, action: 'META_AUTH_CALLBACK_ERROR', details: { message: error instanceof Error ? error.message : 'Unknown error' } } }).catch(() => undefined);
    const destination = appUrl?.startsWith('https://') ? `${appUrl}/dashboard?error=meta_connection_failed` : new URL('/dashboard?error=meta_connection_failed', req.url).toString();
    return NextResponse.redirect(destination);
  }
}
