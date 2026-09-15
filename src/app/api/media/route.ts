import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { requireSessionUser } from '@/lib/auth';
import { InstagramMediaService } from '@/services/meta/InstagramMediaService';

export const dynamic = 'force-dynamic';
function unauthorized(error: unknown) { return error instanceof Error && error.message === 'UNAUTHORIZED'; }

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const sync = new URL(req.url).searchParams.get('sync') === 'true';
    const connection = await prisma.metaConnection.findFirst({
      where: { userId: user.userId, connectionStatus: 'CONNECTED' },
    });
    if (!connection) return NextResponse.json({ media: [], connectionRequired: true, syncError: null });

    let syncError: string | null = null;
    if (sync) {
      try {
        const token = decryptToken(connection.accessTokenEncrypted);
        const remoteMedia = await InstagramMediaService.fetchMedia(connection.instagramAccountId, token);
        await Promise.all(remoteMedia.map((item) => prisma.media.upsert({
          where: { instagramMediaId: item.id },
          create: {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: item.id,
            mediaType: item.media_type,
            caption: item.caption || null,
            permalink: item.permalink || null,
            mediaUrl: item.media_url || null,
            thumbnailUrl: item.thumbnail_url || null,
            timestamp: new Date(item.timestamp),
          },
          update: {
            mediaType: item.media_type,
            caption: item.caption || null,
            permalink: item.permalink || null,
            mediaUrl: item.media_url || null,
            thumbnailUrl: item.thumbnail_url || null,
            timestamp: new Date(item.timestamp),
          },
        })));
      } catch (error) {
        console.error('Instagram media sync failed; serving cache:', error);
        syncError = (error instanceof Error ? error.message : 'Instagram sync failed').slice(0, 300);
      }
    }

    const media = await prisma.media.findMany({
      where: { instagramAccountId: connection.instagramAccountId },
      include: { automations: true },
      orderBy: { timestamp: 'desc' },
    });
    return NextResponse.json({ media, syncError, cached: Boolean(syncError) });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    console.error('Media fetch error:', error);
    return NextResponse.json({ error: 'Unable to load cached Instagram media.' }, { status: 502 });
  }
}
