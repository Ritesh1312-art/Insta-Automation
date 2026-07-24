import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/contacts/mark-followed
// Body: { igsid: string, instagramAccountId: string }
// Used by: webhook when user clicks Follow button
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { igsid, instagramAccountId } = body;

    if (!igsid || !instagramAccountId) {
      return NextResponse.json({ error: 'igsid and instagramAccountId required' }, { status: 400 });
    }

    const contact = await prisma.contact.upsert({
      where: { instagramAccountId_igsid: { instagramAccountId, igsid } },
      create: {
        instagramAccountId,
        igsid,
        followedAt: new Date(),
      },
      update: {
        followedAt: new Date(),
        lastInteraction: new Date(),
      },
    });

    return NextResponse.json({ success: true, contact });
  } catch (error: any) {
    console.error('mark-followed error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/contacts/mark-followed?igsid=xxx&instagramAccountId=yyy
// Check if user has followed
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const igsid = searchParams.get('igsid');
    const instagramAccountId = searchParams.get('instagramAccountId');

    if (!igsid || !instagramAccountId) {
      return NextResponse.json({ error: 'igsid and instagramAccountId required' }, { status: 400 });
    }

    const contact = await prisma.contact.findUnique({
      where: { instagramAccountId_igsid: { instagramAccountId, igsid } },
      select: { followedAt: true, promptSentAt: true, username: true },
    });

    return NextResponse.json({
      hasFollowed: contact?.followedAt != null,
      promptSent: contact?.promptSentAt != null,
      followedAt: contact?.followedAt,
      username: contact?.username,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
