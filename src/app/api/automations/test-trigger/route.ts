import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

export async function POST(req: NextRequest) {
  try {
    const { mediaId, commentText, commenterUsername } = await req.json();

    const connection = await prisma.metaConnection.findFirst({
      where: { connectionStatus: 'CONNECTED' },
    });

    if (!connection) {
      return NextResponse.json({ error: 'No Instagram account connected' }, { status: 400 });
    }

    const media = await prisma.media.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      return NextResponse.json({ error: 'Selected media/reel not found' }, { status: 404 });
    }

    const mockCommentId = `test_cmt_${Date.now()}`;
    const mockCommenterId = `igsid_tester_${Math.floor(Math.random() * 899999 + 100000)}`;

    const eventPayload = {
      instagramAccountId: connection.instagramAccountId,
      mediaId: media.instagramMediaId,
      commentId: mockCommentId,
      commenterId: mockCommenterId,
      commenterUsername: commenterUsername || 'test_user_fan',
      commentText: commentText || 'HANUMAN',
      rawPayload: {
        entry: [
          {
            id: connection.instagramAccountId,
            changes: [
              {
                field: 'comments',
                value: {
                  id: mockCommentId,
                  text: commentText,
                  media: { id: media.instagramMediaId },
                  from: { id: mockCommenterId, username: commenterUsername || 'test_user_fan' },
                },
              },
            ],
          },
        ],
      },
    };

    const result = await AutomationEngine.processCommentEvent(eventPayload);

    return NextResponse.json({
      success: result.status === 'PROCESSED',
      result,
      simulatedEvent: eventPayload,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
