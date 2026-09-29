import { Prisma } from '@/generated/prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { normalizePlanId, getPlan } from '@/lib/plans';
import { isValidUpiId, isValidUtr } from '@/lib/upi';
import { sendPaymentSubmittedEmail } from '@/lib/mailer';
import { notifyTelegramPaymentSubmitted } from '@/lib/telegram';

class PaymentSubmitError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSessionUser();
    const body = await req.json();
    const planType = normalizePlanId(body.planType);
    const payerName = typeof body.payerName === 'string' ? body.payerName.trim().slice(0, 80) : '';
    const payerUpiId = typeof body.payerUpiId === 'string' ? body.payerUpiId.trim() : '';
    const utrNumber = typeof body.utrNumber === 'string' ? body.utrNumber.trim().toUpperCase() : '';

    if (!planType || planType === 'FREE') return NextResponse.json({ error: 'Select a paid plan' }, { status: 400 });
    if (payerName.length < 2) return NextResponse.json({ error: 'Enter the name used on the UPI payment' }, { status: 400 });
    if (!isValidUpiId(payerUpiId)) return NextResponse.json({ error: 'Enter a valid UPI ID such as name@oksbi' }, { status: 400 });
    if (!isValidUtr(utrNumber)) {
      return NextResponse.json({ error: 'Enter the 12–22 character UTR / UPI reference from your receipt' }, { status: 400 });
    }

    const plan = getPlan(planType);
    const payment = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (!user) throw new PaymentSubmitError('User account not found', 404);

      const duplicate = await tx.directUpiPayment.findUnique({ where: { utrNumber } });
      if (duplicate) throw new PaymentSubmitError('This UTR is already submitted. Wait for review or use a new payment.', 409);
      const pending = await tx.directUpiPayment.findFirst({ where: { userId: user.id, status: 'PENDING_REVIEW' } });
      if (pending) throw new PaymentSubmitError('You already have a payment waiting for review. Do not pay again.', 409);

      const created = await tx.directUpiPayment.create({
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
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'UPI_PAYMENT_SUBMITTED',
          details: { paymentId: created.id, planType: plan.id, amount: plan.priceInr, utrNumber },
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Notifications are best-effort and never change payment state.
    await Promise.all([
      sendPaymentSubmittedEmail(payment.userEmail, plan.id, plan.priceInr, utrNumber),
      notifyTelegramPaymentSubmitted(payment),
    ]);

    return NextResponse.json({
      success: true,
      status: 'PENDING_REVIEW',
      paymentId: payment.id,
      message: `Payment submitted for ${plan.name}. Plan activates after admin verifies the UTR in the bank app. Do not pay again.`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sign in to submit a payment' }, { status: 401 });
    }
    if (error instanceof PaymentSubmitError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return NextResponse.json({ error: 'This UTR is already submitted.' }, { status: 409 });
      if (error.code === 'P2034') return NextResponse.json({ error: 'Payment changed concurrently. Please try again.' }, { status: 409 });
    }
    console.error('Direct UPI submission failed:', error);
    return NextResponse.json({ error: 'Failed to submit Direct UPI payment' }, { status: 500 });
  }
}
