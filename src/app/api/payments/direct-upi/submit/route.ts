import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { normalizePlanId } from '@/lib/plans';
import { isValidUpiId, isValidUtr } from '@/lib/upi';

export async function POST(req: Request) {
  try {
    const session = await requireSessionUser();
    const body = await req.json();
    const planType = normalizePlanId(body.planType);
    const payerName = typeof body.payerName === 'string' ? body.payerName.trim().slice(0, 80) : '';
    const payerUpiId = typeof body.payerUpiId === 'string' ? body.payerUpiId.trim() : '';
    const utrNumber = typeof body.utrNumber === 'string' ? body.utrNumber.trim().toUpperCase() : '';

    if (!planType || planType === 'FREE') {
      return NextResponse.json({ error: 'Select a paid plan' }, { status: 400 });
    }
    if (payerName.length < 2) {
      return NextResponse.json({ error: 'Enter the name used on the UPI payment' }, { status: 400 });
    }
    if (!isValidUpiId(payerUpiId)) {
      return NextResponse.json({ error: 'Enter a valid UPI ID such as name@oksbi' }, { status: 400 });
    }
    if (!isValidUtr(utrNumber)) {
      return NextResponse.json({ error: 'Enter the 12–22 character UTR / UPI reference from your receipt' }, { status: 400 });
    }

    const { getPlan } = await import('@/lib/plans');
    const plan = getPlan(planType);
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: 'User account not found' }, { status: 404 });

    const duplicate = await prisma.directUpiPayment.findUnique({ where: { utrNumber } });
    if (duplicate) {
      return NextResponse.json({ error: 'This UTR is already submitted. Wait for review or use a new payment.' }, { status: 409 });
    }

    const pending = await prisma.directUpiPayment.findFirst({
      where: { userId: user.id, status: 'PENDING_REVIEW' },
    });
    if (pending) {
      return NextResponse.json({ error: 'You already have a payment waiting for review. Do not pay again.' }, { status: 409 });
    }

    const payment = await prisma.directUpiPayment.create({
      data: {
        userId: user.id,
        userEmail: user.email,
        payerName,
        payerUpiId,
        planType: plan.id,
        amount: plan.priceInr,
        utrNumber,
        status: 'PENDING_REVIEW',
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { subscriptionStatus: 'PENDING_PAYMENT' },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'UPI_PAYMENT_SUBMITTED',
        details: { paymentId: payment.id, planType: plan.id, amount: plan.priceInr, utrNumber },
      },
    });

    return NextResponse.json({
      success: true,
      status: 'PENDING_REVIEW',
      paymentId: payment.id,
      message: `Payment submitted for ${plan.name}. Plan activates after admin verifies the UTR in the bank app. Do not pay again.`,
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sign in to submit a payment' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || 'Failed to submit Direct UPI payment' }, { status: 500 });
  }
}
