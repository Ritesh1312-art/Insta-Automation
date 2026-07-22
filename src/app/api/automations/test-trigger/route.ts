import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { mediaId } = await req.json();
    if (typeof mediaId !== 'string') return NextResponse.json({ error: 'Select a post to validate' }, { status: 400 });
    const media = await prisma.media.findFirst({ where: { id: mediaId, metaConnection: { userId: user.userId, connectionStatus: 'CONNECTED' } } });
    if (!media) return NextResponse.json({ error: 'Selected post is unavailable for your connected account' }, { status: 404 });
    const automations = await prisma.automation.findMany({ where: { userId: user.userId, status: 'ACTIVE', OR: [{ mediaId }, { mediaId: null }] }, include: { resource: true } });
    const blockers = automations.flatMap((automation) => [
      ...(automation.triggerType === 'KEYWORD' && automation.keywords.length === 0 ? [`${automation.name}: no keywords`] : []),
      ...(automation.dmMessageTemplate.includes('{{resource_url}}') && !automation.resource?.url && !automation.resource?.textContent ? [`${automation.name}: resource is missing`] : []),
    ]);
    return NextResponse.json({ ready: automations.length > 0 && blockers.length === 0, automationCount: automations.length, blockers, message: 'Configuration only; no Instagram comment or message was created.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to validate configuration' }, { status: 500 });
  }
}
