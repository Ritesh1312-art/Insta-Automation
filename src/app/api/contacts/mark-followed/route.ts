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
      previouslyVerifiedFollow: contact?.followedAt != null,
      promptSent: contact?.promptSentAt != null,
      lastVerifiedFollowAt: contact?.followedAt,
      username: contact?.username,
      followGateStatus: contact?.followGateStatus || 'NEW',
      note: 'Historical contact data is not proof of the current follow relationship.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Unable to load contact status' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Follow status cannot be set manually. It is checked live through Meta when the Instagram user requests access.' },
    { status: 405 }
  );
}
