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

    // Calculate amount for Razorpay Order fallback (₹299 or ₹699)
    const amountInPaise = planType === 'VIP_UNLIMITED' ? 69900 : 29900;

    let subscriptionId = '';
    let isOrderFallback = false;

    try {
      const planId = planType === 'VIP_UNLIMITED'
        ? (process.env.RAZORPAY_PLAN_VIP_699 || 'plan_vip_699_test')
        : (process.env.RAZORPAY_PLAN_PRO_299 || 'plan_pro_299_test');

      const result = await RazorpayService.createSubscription({
        planId,
        customerEmail: user.email,
        customerName: user.name || 'InstaPulse User',
      });

      if (result.success && result.subscription) {
        subscriptionId = result.subscription.id;
      }
    } catch {
      // Fallback if plan_id does not exist in Razorpay Dashboard
    }

    // If subscription creation was not successful (e.g. test plan_id doesn't exist), create a direct Razorpay Order!
    if (!subscriptionId) {
      const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_TIzWrtxCNfmOku';
      const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || 'emPG3RcKxByW0V111UceBqUh';

      const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(razorpayKeyId + ':' + razorpaySecret).toString('base64'),
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `rcpt_${Date.now()}`,
          notes: { email: user.email, planType, app: 'InstaPulse' },
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok || !orderData.id) {
        return NextResponse.json({ error: orderData.error?.description || 'Razorpay payment creation failed' }, { status: 500 });
      }

      subscriptionId = orderData.id;
      isOrderFallback = true;
    }

    await prisma.user.update({
      where: { email },
      data: { razorpaySubscriptionId: subscriptionId },
    });

    return NextResponse.json({
      success: true,
      subscriptionId,
      isOrder: isOrderFallback,
      amount: amountInPaise,
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_TIzWrtxCNfmOku',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
