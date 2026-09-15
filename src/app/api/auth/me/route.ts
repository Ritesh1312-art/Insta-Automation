import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPlan } from '@/lib/plans';
import { resetQuotaIfNeeded } from '@/lib/quota';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ user: null }, { status: 401 });

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
}
