import { Prisma } from '@/generated/prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { getPlan } from '@/lib/plans';

const statuses = new Set(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const triggerTypes = new Set(['KEYWORD', 'ANY_COMMENT']);
const matchingModes = new Set(['EXACT', 'CONTAINS', 'STARTS_WITH', 'CASE_SENSITIVE']);

function unauthorized(error: unknown) {
  return error instanceof Error && error.message === 'UNAUTHORIZED';
}

class AutomationLimitError extends Error {}

async function assertAutomationLimit(
  tx: Prisma.TransactionClient,
  userId: string,
  role: string,
  excludeId?: string,
) {
  if (role === 'ADMIN') return;
  const owner = await tx.user.findUnique({ where: { id: userId }, select: { plan: true } });
  const plan = getPlan(owner?.plan);
  if (plan.activeAutomationLimit === null) return;
  const active = await tx.automation.count({
    where: { userId, status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (active >= plan.activeAutomationLimit) {
    throw new AutomationLimitError(`${plan.name} supports ${plan.activeAutomationLimit} active automation${plan.activeAutomationLimit === 1 ? '' : 's'}. Pause one or upgrade your plan.`);
  }
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
    const keywords = Array.isArray(body.keywords)
      ? body.keywords
        .filter((keyword: unknown): keyword is string => typeof keyword === 'string' && Boolean(keyword.trim()))
        .map((keyword: string) => keyword.trim().slice(0, 100))
        .slice(0, 25)
      : [];
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
    const automation = await prisma.$transaction(async (tx) => {
      if (status === 'ACTIVE') await assertAutomationLimit(tx, user.userId, user.role);
      return tx.automation.create({
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
          ignoreOwnerComments: body.ignoreOwnerComments !== false,
          oneDeliveryPerUser: body.oneDeliveryPerUser !== false,
          // Meta permits only one private reply per comment; this cannot safely be disabled.
          oneDeliveryPerComment: true,
          followGateEnabled: body.followGateEnabled !== false,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (error instanceof AutomationLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ error: 'Automation changed concurrently. Please try again.' }, { status: 409 });
    }
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
    const automation = await prisma.$transaction(async (tx) => {
      const owned = await tx.automation.findFirst({ where: { id, userId: user.userId } });
      if (!owned) return null;
      if (status === 'ACTIVE' && owned.status !== 'ACTIVE') {
        await assertAutomationLimit(tx, user.userId, user.role, id);
      }
      return tx.automation.update({ where: { id }, data: { status } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    return NextResponse.json({ automation });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (error instanceof AutomationLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ error: 'Automation changed concurrently. Please try again.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to update automation' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Automation ID is required' }, { status: 400 });

    const owned = await prisma.automation.findFirst({ where: { id, userId: user.userId }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

    // AutomationRun rows cascade only after ownership has been verified.
    await prisma.automation.delete({ where: { id: owned.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to delete automation' }, { status: 500 });
  }
}
