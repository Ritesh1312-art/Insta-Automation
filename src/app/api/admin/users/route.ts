import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePlanId } from '@/lib/plans';
import { applyApprovedPlan, resetDmUsage } from '@/lib/quota';
import { resetUserAnalytics } from '@/lib/analytics-reset';
import { isAuthError, requireAdmin } from '@/lib/require-admin';
import { privateJson } from '@/lib/http-cache';
import { safeErrorMessage } from '@/lib/safe-error';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['APPLY_PLAN', 'RESET_QUOTA', 'RESET_ANALYTICS']);
type AdminUserAction = 'APPLY_PLAN' | 'RESET_QUOTA' | 'RESET_ANALYTICS';

/** Fields an admin client may see. Password hashes and encrypted tokens are never returned. */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  plan: true,
  monthlyDmQuota: true,
  dmsUsedThisMonth: true,
  quotaResetAt: true,
  planActivatedAt: true,
  subscriptionStatus: true,
  totalCommentsReceived: true,
  createdAt: true,
} as const;

function adminUserView(user: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(ADMIN_USER_SELECT).map((key) => [key, user[key]]));
}

function authErrorResponse(error: unknown) {
  if (isAuthError(error, 'UNAUTHORIZED')) return privateJson({ error: 'Authentication required' }, { status: 401 });
  if (isAuthError(error, 'FORBIDDEN')) return privateJson({ error: 'Admin only' }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        ...ADMIN_USER_SELECT,
        _count: { select: { automations: true, directUpiPayments: true } },
      },
      take: 500,
    });
    return privateJson({ users });
  } catch (error) {
    return authErrorResponse(error) ?? privateJson({ error: 'Unable to load users' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Role is re-read from the database on every call (not trusted from the JWT).
    const admin = await requireAdmin();
    const body: unknown = await req.json().catch(() => null);
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const userId = typeof input.userId === 'string' && input.userId.length <= 191 ? input.userId.trim() : '';
    const action = typeof input.action === 'string' && ACTIONS.has(input.action) ? input.action as AdminUserAction : null;
    if (!userId || !action) return privateJson({ error: 'userId and a valid action are required' }, { status: 400 });

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, plan: true } });
    if (!target) return privateJson({ error: 'User not found' }, { status: 404 });

    if (action === 'APPLY_PLAN') {
      const planId = normalizePlanId(input.planId);
      if (!planId) return privateJson({ error: 'Select a valid plan' }, { status: 400 });
      const user = await applyApprovedPlan(target.id, planId);
      await prisma.auditLog.create({
        data: {
          userId: target.id,
          action: 'ADMIN_PLAN_APPLIED',
          details: { adminId: admin.userId, previousPlan: target.plan, planId },
        },
      });
      return privateJson({ success: true, user: adminUserView(user) });
    }

    if (action === 'RESET_ANALYTICS') {
      const result = await resetUserAnalytics({ adminId: admin.userId, targetUserId: target.id });
      if (!result) return privateJson({ error: 'User not found' }, { status: 404 });
      return privateJson({
        success: true,
        analytics: { previous: result.previous, automationsReset: result.automationsReset },
      });
    }

    // RESET_QUOTA. Expiry is applied first, under the quota lock: a usage
    // reset never extends a paid plan's 30-day term.
    const user = await resetDmUsage(target.id);
    if (!user) return privateJson({ error: 'User not found' }, { status: 404 });
    await prisma.auditLog.create({
      data: {
        userId: target.id,
        action: 'ADMIN_QUOTA_RESET',
        details: { adminId: admin.userId, plan: user.plan },
      },
    });
    return privateJson({ success: true, user: adminUserView(user) });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Admin user action failed:', safeErrorMessage(error));
    return privateJson({ error: 'Unable to update user' }, { status: 500 });
  }
}
