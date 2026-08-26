import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { normalizePlanId, getPlan } from '@/lib/plans';
import { RazorpayService } from '@/services/payments/RazorpayService';

export async function POST(req: Request) {
  try {
    const session = await requireSessionUser();
    const body = await req.json();
    const planType = normalizePlanId(body.planType);
    if (!planType || planType === 'FREE') {
      return NextResponse.json({ error: 'Select a paid plan' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const plan = getPlan(planType);
    const amountInPaise = plan.priceInr * 100;
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpaySecret) {
      return NextResponse.json({
        error: 'Razorpay is not configured. Use Direct UPI verification instead.',
      }, { status: 501 });
    }

    let subscriptionId = '';
    let isOrderFallback = false;

    try {
      const planId = process.env[`RAZORPAY_PLAN_${planType}`];
      if (planId) {
        const result = await RazorpayService.createSubscription({
          planId,
          customerEmail: user.email,
          customerName: user.name || 'InstaDM user',
        });
        if (result.success && result.subscription) subscriptionId = result.subscription.id;
      }
    } catch {
      // Fall through to one-time order
    }

    if (!subscriptionId) {
      const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpaySecret}`).toString('base64'),
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `rcpt_${Date.now()}`,
          notes: { email: user.email, planType, app: 'InstaDM' },
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
      where: { id: user.id },
      data: { razorpaySubscriptionId: subscriptionId },
    });

    return NextResponse.json({
      success: true,
      subscriptionId,
      isOrder: isOrderFallback,
      amount: amountInPaise,
      keyId: razorpayKeyId,
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
