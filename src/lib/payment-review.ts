import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getPlan, normalizePlanId } from '@/lib/plans';
import { planAssignmentData } from '@/lib/quota';
import { sendPaymentRejectedEmail, sendPlanActivatedEmail } from '@/lib/mailer';

export type PaymentDecision = 'VERIFIED' | 'REJECTED';

export class PaymentReviewError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'PaymentReviewError';
  }
}

export async function reviewDirectUpiPayment(params: {
  paymentId: string;
  decision: PaymentDecision;
  reviewedBy: string;
  reviewNote?: string;
  source: 'DASHBOARD' | 'TELEGRAM';
}) {
  const reviewNote = (params.reviewNote || '').trim().slice(0, 500);
  const existing = await prisma.directUpiPayment.findUnique({ where: { id: params.paymentId } });
  if (!existing) throw new PaymentReviewError('Payment not found', 404);
  if (existing.status !== 'PENDING_REVIEW') {
    throw new PaymentReviewError(`Payment was already ${existing.status.toLowerCase()}`, 409);
  }

  const planId = normalizePlanId(existing.planType);
  if (params.decision === 'VERIFIED' && (!planId || planId === 'FREE')) {
    throw new PaymentReviewError('Payment has an invalid plan', 400);
  }

  const reviewed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // The conditional write makes dashboard and Telegram button clicks idempotent.
    const claimed = await tx.directUpiPayment.updateMany({
      where: { id: existing.id, status: 'PENDING_REVIEW' },
      data: {
        status: params.decision,
        reviewedBy: params.reviewedBy,
        reviewNote,
        approvedAt: params.decision === 'VERIFIED' ? new Date() : null,
      },
    });
    if (claimed.count !== 1) throw new PaymentReviewError('Payment was already reviewed', 409);

    if (params.decision === 'VERIFIED' && planId) {
      await tx.user.update({
        where: { id: existing.userId },
        data: planAssignmentData(planId),
      });
    } else {
      await tx.user.update({
        where: { id: existing.userId },
        data: { subscriptionStatus: 'INACTIVE' },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: existing.userId,
        action: params.decision === 'VERIFIED' ? 'UPI_PAYMENT_VERIFIED' : 'UPI_PAYMENT_REJECTED',
        details: {
          paymentId: existing.id,
          planType: existing.planType,
          amount: existing.amount,
          reviewNote,
          reviewedBy: params.reviewedBy,
          source: params.source,
        },
      },
    });

    return tx.directUpiPayment.findUniqueOrThrow({ where: { id: existing.id } });
  });

  if (params.decision === 'VERIFIED' && planId) {
    const plan = getPlan(planId);
    await sendPlanActivatedEmail(existing.userEmail, planId, plan.dmQuota);
  } else {
    await sendPaymentRejectedEmail(existing.userEmail, existing.planType, reviewNote);
  }

  return reviewed;
}
