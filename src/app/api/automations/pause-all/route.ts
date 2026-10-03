import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { activeUserFlowsWhere } from '@/lib/flow-scope';
import { privateJson } from '@/lib/http-cache';

export async function POST() {
  try {
    const user = await requireSessionUser();
    const result = await prisma.automation.updateMany({ where: activeUserFlowsWhere(user.userId), data: { status: 'PAUSED' } });
    return privateJson({ paused: result.count });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'UNAUTHORIZED';
    return privateJson({ error: unauthorized ? 'Authentication required' : 'Unable to pause automations' }, { status: unauthorized ? 401 : 500 });
  }
}
