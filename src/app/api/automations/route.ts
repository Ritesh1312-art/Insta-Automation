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
    const keywords: string[] = Array.isArray(body.keywords)
      ? [...new Set<string>(body.keywords
          .filter((keyword: unknown): keyword is string => typeof keyword === 'string' && Boolean(keyword.trim()))
          .map((keyword: string) => keyword.trim().slice(0, 60)))]
          .slice(0, 20)
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
      orderBy: { createdAt: 'desc' },
    });
    if (!connection) return NextResponse.json({ error: 'Connect an Instagram account first' }, { status: 400 });

    const automationId = typeof body.automationId === 'string' && body.automationId ? body.automationId : null;
    const existingAutomation = automationId
      ? await prisma.automation.findFirst({
          where: { id: automationId, userId: user.userId, instagramAccountId: connection.instagramAccountId },
        })
      : null;
    if (automationId && !existingAutomation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    }

    const mediaId: string | null = typeof body.mediaId === 'string' && body.mediaId ? body.mediaId : null;
    if (mediaId) {
      const media = await prisma.media.findFirst({ where: { id: mediaId, instagramAccountId: connection.instagramAccountId } });
      if (!media) return NextResponse.json({ error: 'Selected media does not belong to your connected account' }, { status: 400 });
    }
    if (body.customPostUrl) return NextResponse.json({ error: 'Select a synced Instagram post; custom URLs are not supported' }, { status: 400 });

    const resourceId = typeof body.resourceId === 'string' && body.resourceId ? body.resourceId : null;
    if (resourceId) {
      const resource = await prisma.resource.findFirst({ where: { id: resourceId, userId: user.userId } });
      if (!resource) return NextResponse.json({ error: 'Selected resource does not belong to you' }, { status: 400 });
    }

    const publicReplyTemplates = Array.isArray(body.publicReplyTemplates)
      ? body.publicReplyTemplates
          .filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
          .map((value: string) => value.trim().slice(0, 1000))
          .slice(0, 10)
      : [];
    if (status === 'ACTIVE' && existingAutomation?.status !== 'ACTIVE') {
      const owner = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { plan: true, role: true },
      });
      if (!owner) return NextResponse.json({ error: 'Workspace owner not found' }, { status: 404 });
      const limit = getPlan(owner.plan).activeAutomationLimit;
      if (owner.role !== 'ADMIN' && limit !== null) {
        const activeCount = await prisma.automation.count({ where: { userId: user.userId, status: 'ACTIVE' } });
        if (activeCount >= limit) {
          return NextResponse.json({ error: `Your plan allows ${limit} active automation${limit === 1 ? '' : 's'}. Pause one or upgrade.` }, { status: 409 });
        }
      }
    }

    const configuration = {
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
      oneDeliveryPerComment: body.oneDeliveryPerComment !== false,
      followGateEnabled: body.followGateEnabled !== false,
    };
    const automation = existingAutomation
      ? await prisma.automation.update({ where: { id: existingAutomation.id }, data: configuration })
      : await prisma.automation.create({
          data: {
            userId: user.userId,
            instagramAccountId: connection.instagramAccountId,
            ...configuration,
          },
        });
    return NextResponse.json({ automation }, { status: existingAutomation ? 200 : 201 });
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
    if (status === 'ACTIVE') {
      const [owner, target] = await Promise.all([
        prisma.user.findUnique({ where: { id: user.userId }, select: { plan: true, role: true } }),
        prisma.automation.findFirst({ where: { id, userId: user.userId }, select: { status: true } }),
      ]);
      if (!target) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
      const limit = getPlan(owner?.plan).activeAutomationLimit;
      if (target.status !== 'ACTIVE' && owner?.role !== 'ADMIN' && limit !== null) {
        const activeCount = await prisma.automation.count({ where: { userId: user.userId, status: 'ACTIVE' } });
        if (activeCount >= limit) {
          return NextResponse.json({ error: `Your plan allows ${limit} active automation${limit === 1 ? '' : 's'}.` }, { status: 409 });
        }
      }
    }
    const result = await prisma.automation.updateMany({ where: { id, userId: user.userId }, data: { status } });
    if (result.count === 0) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    const automation = await prisma.automation.findUnique({ where: { id } });
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

    // Ownership is enforced on the parent delete. Related runs cascade from the
    // schema, so another user's run history can never be touched by a guessed ID.
    const result = await prisma.automation.deleteMany({ where: { id, userId: user.userId } });

    // AutomationRun rows cascade only after ownership has been verified.
    await prisma.automation.delete({ where: { id: owned.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to delete automation' }, { status: 500 });
  }
}
