import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { getPlan } from '@/lib/plans';
import { advisoryLockKeys, withTransactionAdvisoryLock, type TransactionClient } from '@/lib/advisory-lock';
import { ACTIVE_FLOW_STATUS, activeUserFlowsWhere, userFlowsWhere } from '@/lib/flow-scope';
import { privateJson } from '@/lib/http-cache';
import { safeErrorMessage } from '@/lib/safe-error';

const statuses = new Set(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const triggerTypes = new Set(['KEYWORD', 'ANY_COMMENT']);
const matchingModes = new Set(['EXACT', 'CONTAINS', 'STARTS_WITH', 'CASE_SENSITIVE']);

function unauthorized(error: unknown) {
  return error instanceof Error && error.message === 'UNAUTHORIZED';
}

/** Non-secret connection fields; the encrypted access token never leaves the server. */
const SAFE_CONNECTION_SELECT = {
  id: true,
  instagramAccountId: true,
  instagramUsername: true,
  connectionStatus: true,
} as const;

type PlanOwner = { plan: string; role: string } | null;

/**
 * Returns the plan-limit error for activating one more flow, or null. Must run
 * inside the owner's automation-limit lock so two concurrent activations cannot
 * both observe a count below the limit.
 */
async function activeLimitError(tx: TransactionClient, userId: string, owner: PlanOwner, suffix: string) {
  const limit = getPlan(owner?.plan).activeAutomationLimit;
  if (owner?.role === 'ADMIN' || limit === null) return null;
  const activeCount = await tx.automation.count({ where: activeUserFlowsWhere(userId) });
  return activeCount >= limit ? `Your plan allows ${limit} active automation${limit === 1 ? '' : 's'}.${suffix}` : null;
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const automations = await prisma.automation.findMany({
      where: userFlowsWhere(user.userId),
      include: { media: true, resource: true, metaConnection: { select: SAFE_CONNECTION_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    return privateJson({ automations });
  } catch (error) {
    if (unauthorized(error)) return privateJson({ error: 'Authentication required' }, { status: 401 });
    return privateJson({ error: 'Unable to load automations' }, { status: 500 });
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
      return privateJson({ error: 'Invalid automation configuration' }, { status: 400 });
    }
    if (triggerType === 'KEYWORD' && keywords.length === 0) {
      return privateJson({ error: 'At least one keyword is required' }, { status: 400 });
    }
    if (typeof body.dmMessageTemplate !== 'string' || !body.dmMessageTemplate.trim() || body.dmMessageTemplate.length > 1000) {
      return privateJson({ error: 'A DM message template is required' }, { status: 400 });
    }

    const connection = await prisma.metaConnection.findFirst({
      where: { userId: user.userId, connectionStatus: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!connection) return privateJson({ error: 'Connect an Instagram account first' }, { status: 400 });

    const automationId = typeof body.automationId === 'string' && body.automationId ? body.automationId : null;
    const existingAutomation = automationId
      ? await prisma.automation.findFirst({
          where: { id: automationId, userId: user.userId, instagramAccountId: connection.instagramAccountId },
        })
      : null;
    if (automationId && !existingAutomation) {
      return privateJson({ error: 'Automation not found' }, { status: 404 });
    }

    const mediaId: string | null = typeof body.mediaId === 'string' && body.mediaId ? body.mediaId : null;
    if (mediaId) {
      const media = await prisma.media.findFirst({ where: { id: mediaId, instagramAccountId: connection.instagramAccountId } });
      if (!media) return privateJson({ error: 'Selected media does not belong to your connected account' }, { status: 400 });
    }
    if (body.customPostUrl) return privateJson({ error: 'Select a synced Instagram post; custom URLs are not supported' }, { status: 400 });

    const resourceId = typeof body.resourceId === 'string' && body.resourceId ? body.resourceId : null;
    if (resourceId) {
      const resource = await prisma.resource.findFirst({ where: { id: resourceId, userId: user.userId } });
      if (!resource) return privateJson({ error: 'Selected resource does not belong to you' }, { status: 400 });
    }

    const publicReplyTemplates = Array.isArray(body.publicReplyTemplates)
      ? body.publicReplyTemplates
          .filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
          .map((value: string) => value.trim().slice(0, 1000))
          .slice(0, 10)
      : [];
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
    const saveAutomation = (db: Pick<TransactionClient, 'automation'>) => existingAutomation
      ? db.automation.update({ where: { id: existingAutomation.id }, data: configuration })
      : db.automation.create({
          data: {
            userId: user.userId,
            instagramAccountId: connection.instagramAccountId,
            ...configuration,
          },
        });
    const savedStatus = existingAutomation ? 200 : 201;

    if (status !== ACTIVE_FLOW_STATUS) {
      return privateJson({ automation: await saveAutomation(prisma) }, { status: savedStatus });
    }

    const owner = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { plan: true, role: true },
    });
    if (!owner) return privateJson({ error: 'Workspace owner not found' }, { status: 404 });

    // Limit check and write are one locked transaction, so parallel saves
    // cannot both take the last active slot.
    const outcome = await withTransactionAdvisoryLock(prisma, advisoryLockKeys.automationLimit(user.userId), async (tx) => {
      if (existingAutomation) {
        // Re-read under the lock: only a transition into ACTIVE consumes a slot.
        const current = await tx.automation.findFirst({
          where: { id: existingAutomation.id, userId: user.userId },
          select: { status: true },
        });
        if (!current) return { kind: 'not-found' as const };
        if (current.status === ACTIVE_FLOW_STATUS) return { kind: 'saved' as const, automation: await saveAutomation(tx) };
      }
      const limitError = await activeLimitError(tx, user.userId, owner, ' Pause one or upgrade.');
      if (limitError) return { kind: 'limit' as const, message: limitError };
      return { kind: 'saved' as const, automation: await saveAutomation(tx) };
    });
    if (outcome.kind === 'not-found') return privateJson({ error: 'Automation not found' }, { status: 404 });
    if (outcome.kind === 'limit') return privateJson({ error: outcome.message }, { status: 409 });
    return privateJson({ automation: outcome.automation }, { status: savedStatus });
  } catch (error) {
    if (unauthorized(error)) return privateJson({ error: 'Authentication required' }, { status: 401 });
    console.error('Automation creation error:', safeErrorMessage(error));
    return privateJson({ error: 'Unable to create automation' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { id, status } = await req.json();
    if (typeof id !== 'string' || typeof status !== 'string' || !statuses.has(status)) {
      return privateJson({ error: 'Invalid automation update' }, { status: 400 });
    }
    if (status === ACTIVE_FLOW_STATUS) {
      const owner = await prisma.user.findUnique({ where: { id: user.userId }, select: { plan: true, role: true } });
      const outcome = await withTransactionAdvisoryLock(prisma, advisoryLockKeys.automationLimit(user.userId), async (tx) => {
        const target = await tx.automation.findFirst({ where: { id, userId: user.userId }, select: { status: true } });
        if (!target) return { kind: 'not-found' as const };
        if (target.status !== ACTIVE_FLOW_STATUS) {
          const limitError = await activeLimitError(tx, user.userId, owner, '');
          if (limitError) return { kind: 'limit' as const, message: limitError };
        }
        const result = await tx.automation.updateMany({ where: { id, userId: user.userId }, data: { status } });
        return result.count === 0 ? { kind: 'not-found' as const } : { kind: 'updated' as const };
      });
      if (outcome.kind === 'not-found') return privateJson({ error: 'Automation not found' }, { status: 404 });
      if (outcome.kind === 'limit') return privateJson({ error: outcome.message }, { status: 409 });
    } else {
      const result = await prisma.automation.updateMany({ where: { id, userId: user.userId }, data: { status } });
      if (result.count === 0) return privateJson({ error: 'Automation not found' }, { status: 404 });
    }
    const automation = await prisma.automation.findUnique({ where: { id } });
    return privateJson({ automation });
  } catch (error) {
    if (unauthorized(error)) return privateJson({ error: 'Authentication required' }, { status: 401 });
    return privateJson({ error: 'Unable to update automation' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return privateJson({ error: 'Automation ID is required' }, { status: 400 });

    // Ownership is enforced on the parent delete. Related runs cascade from the
    // schema, so another user's run history can never be touched by a guessed ID.
    const result = await prisma.automation.deleteMany({ where: { id, userId: user.userId } });

    if (result.count === 0) return privateJson({ error: 'Automation not found' }, { status: 404 });
    return privateJson({ success: true });
  } catch (error) {
    if (unauthorized(error)) return privateJson({ error: 'Authentication required' }, { status: 401 });
    return privateJson({ error: 'Unable to delete automation' }, { status: 500 });
  }
}
