import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

export async function POST() {
  try {
    const user = await requireSessionUser();
    
    // Update all connected connections for this user to DISCONNECTED
    await prisma.metaConnection.updateMany({
      where: { userId: user.userId, connectionStatus: 'CONNECTED' },
      data: { connectionStatus: 'DISCONNECTED' },
    });
    
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
