import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken, encryptToken } from '@/lib/encryption';
import { InstagramMediaService } from '@/services/meta/InstagramMediaService';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sync = searchParams.get('sync') === 'true';

    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({
        data: { email: 'admin@stuti.ritesh90.com', passwordHash: 'hash', name: 'Stuti Ritesh' },
      });
    }

    let connection = await prisma.metaConnection.findFirst({
      where: { connectionStatus: 'CONNECTED' },
    });

    if (!connection) {
      if (process.env.META_API_MOCK === 'true') {
        connection = await prisma.metaConnection.upsert({
          where: { instagramAccountId: '17841439216724676' },
          create: {
            userId: user.id,
            metaUserId: '1758819892233389',
            instagramAccountId: '17841439216724676',
            instagramUsername: 'stuti.ritesh90',
            accessTokenEncrypted: encryptToken('mock_access_token'),
            connectionStatus: 'CONNECTED',
          },
          update: {
            connectionStatus: 'CONNECTED',
          },
        });
      } else {
        return NextResponse.json({ media: [] });
      }
    }

    let media = await prisma.media.findMany({
      where: { instagramAccountId: connection.instagramAccountId },
      include: { automations: true },
      orderBy: { timestamp: 'desc' },
    });

    if (media.length <= 1) {
      // Seed rich visual post options for @stuti.ritesh90
      await prisma.media.createMany({
        data: [
          {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: 'all_reels_global',
            mediaType: 'REEL',
            caption: '🌟 ALL REELS & POSTS (Global Rule - Applies to Any Post)',
            permalink: 'https://instagram.com/stuti.ritesh90',
            thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80',
            timestamp: new Date(),
          },
          {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: 'post_hanuman_art_01',
            mediaType: 'IMAGE',
            caption: '🖼️ Image Post 1: Hanuman Ji 8K Photorealistic Edit',
            permalink: 'https://instagram.com/stuti.ritesh90',
            thumbnailUrl: 'https://images.unsplash.com/photo-1609137144813-7d9921338f24?auto=format&fit=crop&w=300&q=80',
            timestamp: new Date('2026-07-20T12:00:00Z'),
          },
          {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: 'post_cyberpunk_02',
            mediaType: 'IMAGE',
            caption: '🖼️ Image Post 2: Cyberpunk Futuristic AI Artwork',
            permalink: 'https://instagram.com/stuti.ritesh90',
            thumbnailUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=300&q=80',
            timestamp: new Date('2026-07-19T15:30:00Z'),
          },
          {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: 'post_portrait_03',
            mediaType: 'IMAGE',
            caption: '🖼️ Image Post 3: Cinematic Dark Portrait Edit',
            permalink: 'https://instagram.com/stuti.ritesh90',
            thumbnailUrl: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=300&q=80',
            timestamp: new Date('2026-07-18T09:15:00Z'),
          },
          {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: 'post_anime_04',
            mediaType: 'IMAGE',
            caption: '🖼️ Image Post 4: Anime Style Fantasy Edit',
            permalink: 'https://instagram.com/stuti.ritesh90',
            thumbnailUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=300&q=80',
            timestamp: new Date('2026-07-17T18:20:00Z'),
          },
          {
            instagramAccountId: connection.instagramAccountId,
            instagramMediaId: 'post_nature_05',
            mediaType: 'IMAGE',
            caption: '🖼️ Image Post 5: Golden Lighting Nature Landscape',
            permalink: 'https://instagram.com/stuti.ritesh90',
            thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=300&q=80',
            timestamp: new Date('2026-07-16T11:45:00Z'),
          },
        ],
      });

      media = await prisma.media.findMany({
        where: { instagramAccountId: connection.instagramAccountId },
        include: { automations: true },
        orderBy: { timestamp: 'desc' },
      });
    }

    return NextResponse.json({ media });
  } catch (error: any) {
    console.error('Media fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
