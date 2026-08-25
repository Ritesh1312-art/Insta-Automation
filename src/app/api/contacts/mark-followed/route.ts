import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionUser();
    const { searchParams } = new URL(req.url);
    const igsid = searchParams.get('igsid');
    const instagramAccountId = searchParams.get('instagramAccountId');

    if (!igsid || !instagramAccountId) {
      return NextResponse.json({ error: 'igsid and instagramAccountId required' }, { status: 400 });
    }

    const owned = await prisma.metaConnection.findFirst({
      where: { userId: session.userId, instagramAccountId },
    });
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const contact = await prisma.contact.findUnique({
      where: { instagramAccountId_igsid: { instagramAccountId, igsid } },
      select: { followedAt: true, promptSentAt: true, username: true, followGateStatus: true },
    });

    return NextResponse.json({
      hasFollowed: contact?.followedAt != null,
      promptSent: contact?.promptSentAt != null,
      followedAt: contact?.followedAt,
      username: contact?.username,
      followGateStatus: contact?.followGateStatus || 'NEW',
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Follow status can only be claimed by the Instagram user via the I Followed button or DONE reply.' },
    { status: 405 }
  );
}
