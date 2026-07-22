import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
export async function POST() {
  try {
    const user = await requireSessionUser();
    const result = await prisma.automation.updateMany({ where: { userId: user.userId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    return NextResponse.json({ paused: result.count });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === 'UNAUTHORIZED' ? 'Authentication required' : 'Unable to pause automations' }, { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 500 });
  }
}
