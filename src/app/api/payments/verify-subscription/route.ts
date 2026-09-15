import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { normalizePlanId } from '@/lib/plans';
import { applyApprovedPlan } from '@/lib/quota';
import { RazorpayService } from '@/services/payments/RazorpayService';

export async function POST(req: Request) {
  try {
    // Activation is always for the signed-in user. A body-supplied email is never trusted.
    const session = await requireSessionUser();
    const body = await req.json();

    const planType = normalizePlanId(body.planType);
    const razorpay_payment_id = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
    const razorpay_subscription_id = typeof body.razorpay_subscription_id === 'string' ? body.razorpay_subscription_id : '';
    const razorpay_order_id = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
    const razorpay_signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';

    if (!planType || planType === 'FREE') {
      return NextResponse.json({ error: 'Select a paid plan' }, { status: 400 });
    }
    if (!razorpay_payment_id || (!razorpay_subscription_id && !razorpay_order_id)) {
      return NextResponse.json({ error: 'Missing required payment parameters' }, { status: 400 });
    }

    // A valid Razorpay HMAC signature is mandatory. No activation without it.
    const signatureValid = RazorpayService.verifyPaymentSignature({
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_order_id,
      razorpay_signature,
    });
    if (!signatureValid) {
      return NextResponse.json({ error: 'Payment signature verification failed' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: 'User account not found' }, { status: 404 });

    await applyApprovedPlan(user.id, planType);
    await prisma.user.update({
      where: { id: user.id },
      data: { razorpaySubscriptionId: razorpay_subscription_id || razorpay_order_id },
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'RAZORPAY_PAYMENT_VERIFIED',
        details: {
          planType,
          razorpay_payment_id,
          razorpay_subscription_id: razorpay_subscription_id || null,
          razorpay_order_id: razorpay_order_id || null,
        },
      },
    });

    return NextResponse.json({ success: true, message: `Successfully upgraded to ${planType} plan!` });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || 'Payment verification failed' }, { status: 500 });
  }
}
