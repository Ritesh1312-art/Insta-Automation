import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/auth';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { encryptToken } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { InstagramMediaService } from '@/services/meta/InstagramMediaService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL;
  let userId: string | null = null;
  try {
    const params = new URL(req.url).searchParams;
    userId = params.get('state') ? await verifyOAuthState(params.get('state')!) : null;
    const code = params.get('code');
    if (!appUrl?.startsWith('https://') || !userId || !code) throw new Error('Invalid or expired Meta authorization response');
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
    const media = await InstagramMediaService.fetchMedia(account.instagramAccountId, account.accessToken);
    await Promise.all(media.map((item) => prisma.media.upsert({
      where: { instagramMediaId: item.id },
      create: { instagramAccountId: account.instagramAccountId, instagramMediaId: item.id, mediaType: item.media_type, caption: item.caption || null, permalink: item.permalink || null, mediaUrl: item.media_url || null, thumbnailUrl: item.thumbnail_url || null, timestamp: new Date(item.timestamp) },
      update: { mediaType: item.media_type, caption: item.caption || null, permalink: item.permalink || null, mediaUrl: item.media_url || null, thumbnailUrl: item.thumbnail_url || null, timestamp: new Date(item.timestamp) },
    })));
    return NextResponse.redirect(`${appUrl}/dashboard?connected=true`);
  } catch (error) {
    console.error('Meta OAuth callback failed:', error);
    if (userId) await prisma.auditLog.create({ data: { userId, action: 'META_AUTH_CALLBACK_ERROR', details: { message: error instanceof Error ? error.message : 'Unknown error' } } }).catch(() => undefined);
    const destination = appUrl?.startsWith('https://') ? `${appUrl}/dashboard?error=meta_connection_failed` : new URL('/dashboard?error=meta_connection_failed', req.url).toString();
    return NextResponse.redirect(destination);
  }
}
