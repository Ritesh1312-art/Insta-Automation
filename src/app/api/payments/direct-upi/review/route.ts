import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAuthError, requireAdmin } from '@/lib/require-admin';
import { normalizePlanId } from '@/lib/plans';
import { applyApprovedPlan } from '@/lib/quota';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const payments = await prisma.directUpiPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return NextResponse.json({ payments });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ error: 'Unable to load payments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    const decision = body.decision === 'REJECTED' ? 'REJECTED' : body.decision === 'VERIFIED' ? 'VERIFIED' : null;
    const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim().slice(0, 500) : '';

    if (!paymentId || !decision) {
      return NextResponse.json({ error: 'paymentId and decision are required' }, { status: 400 });
    }

    const payment = await prisma.directUpiPayment.findUnique({ where: { id: paymentId } });
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (payment.status !== 'PENDING_REVIEW') {
      return NextResponse.json({ error: 'This payment was already reviewed' }, { status: 409 });
    }

    if (decision === 'REJECTED') {
      await prisma.$transaction([
        prisma.directUpiPayment.update({
          where: { id: payment.id },
          data: { status: 'REJECTED', reviewedBy: admin.userId, reviewNote, approvedAt: null },
        }),
        prisma.user.update({
          where: { id: payment.userId },
          data: { subscriptionStatus: 'INACTIVE' },
        }),
        prisma.auditLog.create({
          data: {
            userId: payment.userId,
            action: 'UPI_PAYMENT_REJECTED',
            details: { paymentId: payment.id, reviewNote, adminId: admin.userId },
          },
        }),
      ]);
      return NextResponse.json({ success: true, status: 'REJECTED' });
    }

    const planId = normalizePlanId(payment.planType);
    if (!planId || planId === 'FREE') {
      return NextResponse.json({ error: 'Payment has an invalid plan' }, { status: 400 });
    }

    await applyApprovedPlan(payment.userId, planId);
    await prisma.directUpiPayment.update({
      where: { id: payment.id },
      data: { status: 'VERIFIED', reviewedBy: admin.userId, reviewNote, approvedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        userId: payment.userId,
        action: 'UPI_PAYMENT_VERIFIED',
        details: { paymentId: payment.id, planType: planId, amount: payment.amount, adminId: admin.userId },
      },
    });

    return NextResponse.json({ success: true, status: 'VERIFIED' });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ error: 'Unable to review payment' }, { status: 500 });
  }
}
