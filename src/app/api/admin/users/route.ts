import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePlanId } from '@/lib/plans';
import { applyApprovedPlan, resetQuotaIfNeeded } from '@/lib/quota';
import { isAuthError, requireAdmin } from '@/lib/require-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
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
        createdAt: true,
        _count: { select: { automations: true, directUpiPayments: true } },
      },
      take: 500,
    });
    return NextResponse.json({ users });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ error: 'Unable to load users' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const action = body.action === 'APPLY_PLAN' || body.action === 'RESET_QUOTA' ? body.action : null;
    if (!userId || !action) return NextResponse.json({ error: 'userId and a valid action are required' }, { status: 400 });

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (action === 'APPLY_PLAN') {
      const planId = normalizePlanId(body.planId);
      if (!planId) return NextResponse.json({ error: 'Select a valid plan' }, { status: 400 });
      const user = await applyApprovedPlan(target.id, planId);
      await prisma.auditLog.create({
        data: {
          userId: target.id,
          action: 'ADMIN_PLAN_APPLIED',
          details: { adminId: admin.userId, previousPlan: target.plan, planId },
        },
      });
      return NextResponse.json({ success: true, user });
    }

    // Apply expiry first. A quota reset never extends a paid plan's 30-day term.
    const current = await resetQuotaIfNeeded(target.id);
    if (!current) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const user = await prisma.user.update({
      where: { id: target.id },
      data: { dmsUsedThisMonth: 0 },
    });
    await prisma.auditLog.create({
      data: {
        userId: target.id,
        action: 'ADMIN_QUOTA_RESET',
        details: { adminId: admin.userId, plan: user.plan },
      },
    });
    return NextResponse.json({ success: true, user });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    console.error('Admin user action failed:', error);
    return NextResponse.json({ error: 'Unable to update user' }, { status: 500 });
  }
}
