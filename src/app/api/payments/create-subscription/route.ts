import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { RazorpayService } from '@/services/payments/RazorpayService';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { email, planType } = await req.json();

    if (!email || !planType) {
      return NextResponse.json({ error: 'Email and planType are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Plan IDs for Razorpay (Pro ₹299 vs VIP ₹699)
    const planId = planType === 'VIP_UNLIMITED'
      ? (process.env.RAZORPAY_PLAN_VIP_699 || 'plan_vip_699_test')
      : (process.env.RAZORPAY_PLAN_PRO_299 || 'plan_pro_299_test');

    const result = await RazorpayService.createSubscription({
      planId,
      customerEmail: user.email,
      customerName: user.name || 'InstaPulse User',
    });

    if (!result.success || !result.subscription) {
      return NextResponse.json({ error: result.error || 'Failed to create subscription' }, { status: 500 });
    }

    await prisma.user.update({
      where: { email },
      data: { razorpaySubscriptionId: result.subscription.id },
    });

    return NextResponse.json({
      success: true,
      subscriptionId: result.subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
