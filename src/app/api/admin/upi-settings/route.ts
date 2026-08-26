import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidUpiId } from '@/lib/upi';
import { resolveCheckoutUpi } from '@/lib/upi-server';
import { isAuthError, requireAdmin } from '@/lib/require-admin';

export async function GET() {
  try {
    const checkout = await resolveCheckoutUpi();
    return NextResponse.json({
      adminUpiId: checkout.upiId,
      adminQrCodeUrl: checkout.customQrUrl,
      payeeName: checkout.payeeName,
      autoQr: Boolean(checkout.upiId) && !checkout.customQrUrl,
      source: checkout.source,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch Admin UPI settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { adminUpiId, adminQrCodeUrl } = await req.json();
    const upiId = String(adminUpiId || '').trim();

    if (!upiId || !isValidUpiId(upiId)) {
      return NextResponse.json({ error: 'A valid Admin UPI ID is required (example: name@okaxis)' }, { status: 400 });
    }

    await prisma.user.updateMany({
      where: { role: 'ADMIN' },
      data: { adminUpiId: upiId, adminQrCodeUrl: adminQrCodeUrl ? String(adminQrCodeUrl).trim() : '' },
    });

    return NextResponse.json({
      success: true,
      message: 'UPI ID saved. Checkout QR is generated automatically from this ID and the plan amount.',
    });
  } catch (error: any) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ error: error.message || 'Failed to save Admin UPI settings' }, { status: 500 });
  }
}
