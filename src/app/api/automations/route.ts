import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

const statuses = new Set(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const triggerTypes = new Set(['KEYWORD', 'ANY_COMMENT']);
const matchingModes = new Set(['EXACT', 'CONTAINS', 'STARTS_WITH', 'CASE_SENSITIVE']);

function unauthorized(error: unknown) {
  return error instanceof Error && error.message === 'UNAUTHORIZED';
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const automations = await prisma.automation.findMany({
      where: { userId: user.userId },
      include: { media: true, resource: true, metaConnection: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ automations });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to load automations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter((keyword: unknown): keyword is string => typeof keyword === 'string' && Boolean(keyword.trim())).map((keyword: string) => keyword.trim()) : [];
    const status = typeof body.status === 'string' ? body.status : 'ACTIVE';
    const triggerType = typeof body.triggerType === 'string' ? body.triggerType : 'KEYWORD';
    const matchingMode = typeof body.matchingMode === 'string' ? body.matchingMode : 'EXACT';

    if (!name || name.length > 120 || !statuses.has(status) || !triggerTypes.has(triggerType) || !matchingModes.has(matchingMode)) {
      return NextResponse.json({ error: 'Invalid automation configuration' }, { status: 400 });
    }
    if (triggerType === 'KEYWORD' && keywords.length === 0) {
      return NextResponse.json({ error: 'At least one keyword is required' }, { status: 400 });
    }
    if (typeof body.dmMessageTemplate !== 'string' || !body.dmMessageTemplate.trim() || body.dmMessageTemplate.length > 1000) {
      return NextResponse.json({ error: 'A DM message template is required' }, { status: 400 });
    }

    const connection = await prisma.metaConnection.findFirst({
      where: { userId: user.userId, connectionStatus: 'CONNECTED' },
      orderBy: { createdAt: 'asc' },
    });
    if (!connection) return NextResponse.json({ error: 'Connect an Instagram account first' }, { status: 400 });

    let mediaId: string | null = body.mediaId || null;
    if (mediaId) {
      const media = await prisma.media.findFirst({ where: { id: mediaId, instagramAccountId: connection.instagramAccountId } });
      if (!media) return NextResponse.json({ error: 'Selected media does not belong to your connected account' }, { status: 400 });
    }
    if (body.customPostUrl) return NextResponse.json({ error: 'Select a synced Instagram post; custom URLs are not supported' }, { status: 400 });

    const resourceId = body.resourceId || null;
    if (resourceId) {
      const resource = await prisma.resource.findFirst({ where: { id: resourceId, userId: user.userId } });
      if (!resource) return NextResponse.json({ error: 'Selected resource does not belong to you' }, { status: 400 });
    }

    const publicReplyTemplates = Array.isArray(body.publicReplyTemplates)
      ? body.publicReplyTemplates.filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())).map((value: string) => value.trim().slice(0, 1000))
      : [];
    const automation = await prisma.automation.create({
      data: {
        userId: user.userId,
        instagramAccountId: connection.instagramAccountId,
        mediaId,
        resourceId,
        name,
        status,
        triggerType,
        matchingMode,
        keywords,
        dmMessageTemplate: body.dmMessageTemplate.trim(),
        publicReplyEnabled: Boolean(body.publicReplyEnabled) && publicReplyTemplates.length > 0,
        publicReplyTemplates,
        ignoreOwnerComments: Boolean(body.ignoreOwnerComments),
        oneDeliveryPerUser: Boolean(body.oneDeliveryPerUser),
        oneDeliveryPerComment: Boolean(body.oneDeliveryPerComment),
      },
    });
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    console.error('Automation creation error:', error);
    return NextResponse.json({ error: 'Unable to create automation' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { id, status } = await req.json();
    if (typeof id !== 'string' || typeof status !== 'string' || !statuses.has(status)) {
      return NextResponse.json({ error: 'Invalid automation update' }, { status: 400 });
    }
    const result = await prisma.automation.updateMany({ where: { id, userId: user.userId }, data: { status } });
    if (result.count === 0) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    const automation = await prisma.automation.findUnique({ where: { id } });
    return NextResponse.json({ automation });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to update automation' }, { status: 500 });
  }
}
