import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { RazorpayService } from '@/services/payments/RazorpayService';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { email, planType, razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = await req.json();

    if (!email || !planType || !razorpay_payment_id || !razorpay_subscription_id) {
      return NextResponse.json({ error: 'Missing required payment parameters' }, { status: 400 });
    }

    const isValid = RazorpayService.verifyPaymentSignature({
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature: razorpay_signature || '',
    });

    // Update user plan and set DM quota (30 for Free, 1000 for Pro, 999999 for VIP)
    const monthlyDmQuota = planType === 'VIP_UNLIMITED' ? 999999 : 1000;

    await prisma.user.update({
      where: { email },
      data: {
        plan: planType,
        monthlyDmQuota,
        subscriptionStatus: 'ACTIVE',
        razorpaySubscriptionId: razorpay_subscription_id,
      },
    });

    return NextResponse.json({ success: true, message: `Successfully upgraded to ${planType} plan!` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Payment verification failed' }, { status: 500 });
  }
}
