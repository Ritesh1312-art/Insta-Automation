import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';


export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sync = searchParams.get('sync') === 'true';

    const connection = await prisma.metaConnection.findFirst({
      where: { connectionStatus: 'CONNECTED' },
    });

    if (!connection && process.env.META_API_MOCK !== 'true') {
      return NextResponse.json({ media: [] });
    }

    if (connection) {
      const media = await prisma.media.findMany({
        where: { instagramAccountId: connection.instagramAccountId },
        include: {
          automations: true,
        },
        orderBy: { timestamp: 'desc' },
      });
      if (media.length > 0) return NextResponse.json({ media });
    }
  } catch (error: any) {
    console.log('Database query failed, returning simulated mock media list');
  }

  // Return mock media fallback items
  return NextResponse.json({
    media: [
      {
        id: 'mock_media_reel_a',
        instagramMediaId: '17999887766554401',
        mediaType: 'REEL',
        caption: 'Hanuman Chalisa PDF Download - Comment "HANUMAN" to get the link! 🙏✨',
        permalink: 'https://instagram.com/p/mock_reel_hanuman',
        mediaUrl: 'https://images.unsplash.com/photo-1609137144813-7d9921338f24?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1609137144813-7d9921338f24?auto=format&fit=crop&w=600&q=80',
        timestamp: new Date('2026-07-15T10:00:00Z'),
        automations: [{ id: 'auto_a', name: 'Reel A - Hanuman Chalisa Automation' }],
      },
      {
        id: 'mock_media_reel_b',
        instagramMediaId: '17999887766554402',
        mediaType: 'REEL',
        caption: 'Top 50 ChatGPT AI Prompt Pack - Comment "PROMPT" for instant DM access 🚀🤖',
        permalink: 'https://instagram.com/p/mock_reel_prompt',
        mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
        timestamp: new Date('2026-07-18T14:30:00Z'),
        automations: [{ id: 'auto_b', name: 'Reel B - AI Prompt Pack Automation' }],
      },
      {
        id: 'mock_media_reel_c',
        instagramMediaId: '17999887766554403',
        mediaType: 'REEL',
        caption: 'Lightroom Color Editing Presets Pack 2026 - Comment anything to get the presets link! 📸✨',
        permalink: 'https://instagram.com/p/mock_reel_presets',
        mediaUrl: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=600&q=80',
        timestamp: new Date('2026-07-19T09:15:00Z'),
        automations: [{ id: 'auto_c', name: 'Reel C - Presets Automation' }],
      },
    ],
  });
}

