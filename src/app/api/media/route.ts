import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { requireSessionUser } from '@/lib/auth';
import { InstagramMediaService, normalizeMediaType, resolveDisplayUrls } from '@/services/meta/InstagramMediaService';
import { describeMetaError, metaErrorRequiresReauthorization } from '@/lib/meta-errors';

export const dynamic = 'force-dynamic';
function unauthorized(error: unknown) { return error instanceof Error && error.message === 'UNAUTHORIZED'; }

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const sync = new URL(req.url).searchParams.get('sync') === 'true';

    // A connection whose token died is flagged TOKEN_EXPIRED rather than deleted,
    // so it must still be found here to keep serving cached media and to tell the
    // dashboard that re-authorization is what is needed.
    const connection = await prisma.metaConnection.findFirst({
      where: { userId: user.userId, connectionStatus: { in: ['CONNECTED', 'TOKEN_EXPIRING', 'TOKEN_EXPIRED', 'ERROR'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!connection) {
      return NextResponse.json({ media: [], connectionRequired: true, syncError: null, reauthorizationRequired: false });
    }

    let syncError: string | null = null;
    let reauthorizationRequired = connection.connectionStatus === 'TOKEN_EXPIRED';
    let syncedCount = 0;

    if (sync) {
      try {
        const token = decryptToken(connection.accessTokenEncrypted);
        const remoteMedia = await InstagramMediaService.fetchMedia(connection.instagramAccountId, token);
        for (const item of remoteMedia) {
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
            create: {
              instagramAccountId: connection.instagramAccountId,
              instagramMediaId: item.id,
              ...fields,
            },
            update: fields,
          });
        }
        syncedCount = remoteMedia.length;

        // A successful sync proves the token is alive again — clear any earlier
        // failure state so the reconnect banner disappears without a manual step.
        if (connection.connectionStatus !== 'CONNECTED') {
          await prisma.metaConnection.update({
            where: { id: connection.id },
            data: { connectionStatus: 'CONNECTED' },
          });
        }
        reauthorizationRequired = false;
      } catch (error) {
        // Soft-fail is intentional and preserved: cached media is still served below.
        console.error('Instagram media sync failed; serving cache:', error);
        syncError = describeMetaError(error);

        if (metaErrorRequiresReauthorization(error)) {
          reauthorizationRequired = true;
          // Persist the dead-token state so every surface (and the next request)
          // knows OAuth must be re-run, instead of re-hitting Meta forever.
          if (connection.connectionStatus !== 'TOKEN_EXPIRED') {
            await prisma.metaConnection.update({
              where: { id: connection.id },
              data: { connectionStatus: 'TOKEN_EXPIRED' },
            }).catch(() => undefined);
            await prisma.auditLog.create({
              data: {
                userId: user.userId,
                action: 'META_TOKEN_INVALIDATED',
                details: { instagramUsername: connection.instagramUsername, reason: syncError },
              },
            }).catch(() => undefined);
          }
        }
      }
    }

    const media = await prisma.media.findMany({
      where: { instagramAccountId: connection.instagramAccountId },
      include: { automations: true },
      orderBy: { timestamp: 'desc' },
    });

    return NextResponse.json({
      media,
      syncError,
      cached: Boolean(syncError),
      syncedCount,
      reauthorizationRequired,
      connectionStatus: reauthorizationRequired ? 'TOKEN_EXPIRED' : connection.connectionStatus,
      instagramUsername: connection.instagramUsername,
    });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    console.error('Media fetch error:', error);
    return NextResponse.json({ error: 'Unable to load cached Instagram media.' }, { status: 502 });
  }
}
