import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAuthError, requireAdmin } from '@/lib/require-admin';
import { PaymentReviewError, reviewDirectUpiPayment } from '@/lib/payment-review';

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
    const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote : '';
    if (!paymentId || !decision) {
      return NextResponse.json({ error: 'paymentId and decision are required' }, { status: 400 });
    }

    const payment = await reviewDirectUpiPayment({
      paymentId,
      decision,
      reviewedBy: admin.userId,
      reviewNote,
      source: 'DASHBOARD',
    });
    return NextResponse.json({ success: true, status: payment.status });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    if (error instanceof PaymentReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Payment review failed:', error);
    return NextResponse.json({ error: 'Unable to review payment' }, { status: 500 });
  }
}
