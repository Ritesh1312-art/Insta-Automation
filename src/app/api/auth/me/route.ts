import { NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPlan } from '@/lib/plans';
import { resetQuotaIfNeeded } from '@/lib/quota';
import { logAuthFailure } from '@/lib/auth-logging';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // requireSessionUser() is the central session check: it rejects a missing,
    // expired, forged, or revoked token (including every token issued before a
    // password reset, which bumps the account's sessionVersion). A signature-only
    // check would keep serving account data to a session the user already reset.
    const session = await requireSessionUser();

    await resetQuotaIfNeeded(session.userId);
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        monthlyDmQuota: true,
        dmsUsedThisMonth: true,
        quotaResetAt: true,
        subscriptionStatus: true,
        planActivatedAt: true,
      },
    });
    if (!user) return NextResponse.json({ user: null }, { status: 401 });

    const plan = getPlan(user.plan);
    return NextResponse.json({
      user: {
        ...user,
        planName: plan.name,
        quotaLabel: plan.quotaLabel,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    logAuthFailure('session_lookup', error);
    return NextResponse.json({ error: 'Unable to load account' }, { status: 500 });
  }
}
