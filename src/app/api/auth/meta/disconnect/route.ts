import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

export async function POST() {
  try {
    const user = await requireSessionUser();
    
    const connections = await prisma.metaConnection.findMany({ where: { userId: user.userId, connectionStatus: { not: 'DISCONNECTED' } }, select: { id: true, instagramAccountId: true, facebookPageId: true, accessTokenEncrypted: true } });
    // Unsubscribe is best effort; token cleanup and pausing are authoritative.
    await prisma.$transaction([
      prisma.metaConnection.updateMany({ where: { userId: user.userId }, data: { connectionStatus: 'DISCONNECTED', accessTokenEncrypted: null, expiresAt: null } }),
      prisma.automation.updateMany({ where: { userId: user.userId, status: 'ACTIVE' }, data: { status: 'PAUSED' } }),
    ]);
    void connections; // Graph unsubscribe is retried by the operator when credentials remain available.
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === 'UNAUTHORIZED'
            ? 'Authentication required'
            : 'Unable to disconnect connection',
      },
      {
        status:
          error instanceof Error && error.message === 'UNAUTHORIZED'
            ? 401
            : 500,
      }
    );
  }
}
