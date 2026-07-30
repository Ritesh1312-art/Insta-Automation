import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { email, planType, utrNumber } = await req.json();

    if (!email || !planType || !utrNumber) {
      return NextResponse.json({ error: 'Email, Plan Type, and 12-digit UTR Number are required' }, { status: 400 });
    }

    const cleanUtr = String(utrNumber).trim();
    if (!/^\d{12}$/.test(cleanUtr)) {
      return NextResponse.json({ error: 'Invalid UTR Number. Must be exactly 12 digits (e.g. 420192019201)' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'User account not found' }, { status: 404 });
    }

    const amount = planType === 'VIP_UNLIMITED' ? 699 : 299;
    const monthlyDmQuota = planType === 'VIP_UNLIMITED' ? 999999 : 1000;

    // Create Direct UPI payment submission & activate plan
    const payment = await prisma.directUpiPayment.create({
      data: {
        userId: user.id,
        userEmail: user.email,
        planType,
        amount,
        utrNumber: cleanUtr,
        status: 'VERIFIED',
      },
    });

    await prisma.user.update({
      where: { email },
      data: {
        plan: planType,
        monthlyDmQuota,
        subscriptionStatus: 'ACTIVE',
      },
    });

    return NextResponse.json({
      success: true,
      message: `🎉 Success! UTR ${cleanUtr} verified. Your ${planType} plan is active!`,
      paymentId: payment.id,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to submit Direct UPI payment' }, { status: 500 });
  }
}
